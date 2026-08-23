import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { FEATURE_COLUMNS, changeRequests, extractions, models, specDocuments, specSources } from '@/db/schema';
import { parseMonthFromUrl } from '@/lib/spec-url';
import { countPdfPages } from '@/pipeline/pdf';
import type { Http } from '@/pipeline/http';
import type { ExtractionClient } from '@/pipeline/extract';
import { createQpdfDecryptor } from '@/pipeline/decrypt';
import { MAX_CONSECUTIVE_FAILURES, NEEDS_ATTENTION, collect } from '@/scripts/collect';

/** 本物の諸元表。事前検査を通る必要があるので実物を使う */
const GOLDEN_PDF = new Uint8Array(
  readFileSync(path.resolve(__dirname, '../fixtures/prius_spec_202607.pdf')),
);

const NOW = '2026-07';

const createdModels: string[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const id of createdModels.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function storageDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'collect-test-'));
  tempDirs.push(dir);
  return dir;
}

async function newSource(options: { available?: boolean } = {}) {
  const token = rand();
  const [model] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `テスト車種${token}`,
      slug: `model-${token}`,
      bodyType: 'セダン',
    })
    .returning();
  createdModels.push(model.id);

  const [source] = await db
    .insert(specSources)
    .values({
      modelId: model.id,
      pdfBaseUrl: `https://example.com/${token}${options.available === false ? '-dead' : ''}/spec_`,
    })
    .returning();

  return { model, source };
}

/** 指定した年月だけ 200 を返す偽のHTTP。`-dead` を含むURLは常に404 */
function fakeHttp(months: string[], counters: { gets: number }): Http {
  const available = new Set(months);
  return {
    async head(url) {
      if (url.includes('-dead')) return 404;
      const month = parseMonthFromUrl(url);
      return month && available.has(month) ? 200 : 404;
    },
    async get(url) {
      counters.gets += 1;
      if (url.includes('-dead')) return { status: 404, contentType: null, bytes: new Uint8Array() };
      return { status: 200, contentType: 'application/pdf', bytes: GOLDEN_PDF };
    },
  };
}

function features(): Record<string, string> {
  return Object.fromEntries(FEATURE_COLUMNS.map((column) => [column, 'unknown']));
}

/** 抽出結果を固定で返す偽のクライアント。呼ばれた回数を数える */
function fakeExtraction(counters: { calls: number }, price = 3_200_000): ExtractionClient {
  return {
    async extract() {
      counters.calls += 1;
      return {
        raw: {
          modelName: 'テスト車種',
          grades: [
            {
              name: 'Z',
              powertrain: '2.0L ハイブリッド車',
              driveSystemRaw: '2WD',
              typeDesignation: null,
              price,
              seating: 5,
              weight: 1_420,
              displacement: 1_986,
              wltcMode: 28.6,
              engineType: 'ハイブリッド',
              transmission: '電気式無段変速機',
              features: features(),
            },
          ],
        },
        inputTokens: 1_000,
        outputTokens: 500,
      };
    },
  };
}

async function run(overrides: Partial<Parameters<typeof collect>[0]> = {}) {
  const counters = { gets: 0 };
  return collect({
    http: fakeHttp([NOW], counters),
    extraction: fakeExtraction({ calls: 0 }),
    // 実物のPDFは暗号化されているので、本物の qpdf を通す
    decryptor: createQpdfDecryptor(),
    countPages: countPdfPages,
    now: NOW,
    dryRun: false,
    storageDir: await storageDir(),
    log: () => {},
    ...overrides,
  });
}

async function countRows(modelId: string) {
  const sources = await db.select({ id: specSources.id }).from(specSources).where(eq(specSources.modelId, modelId));
  const ids = sources.map((s) => s.id);
  const documents = ids.length
    ? await db.select({ id: specDocuments.id }).from(specDocuments).where(eq(specDocuments.specSourceId, ids[0]))
    : [];
  let extractionCount = 0;
  let changeCount = 0;
  for (const document of documents) {
    extractionCount += (
      await db.select({ id: extractions.id }).from(extractions).where(eq(extractions.specDocumentId, document.id))
    ).length;
    changeCount += (
      await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.specDocumentId, document.id))
    ).length;
  }
  return { documents: documents.length, extractions: extractionCount, changes: changeCount };
}

describe('collect — 同じPDFを二度処理しない', () => {
  it('2回目は extractions が増えない（LLMを呼んでいない）', async () => {
    const { model } = await newSource();
    const extractionCounter = { calls: 0 };
    const dir = await storageDir();

    const deps = {
      http: fakeHttp([NOW], { gets: 0 }),
      extraction: fakeExtraction(extractionCounter),
      decryptor: createQpdfDecryptor(),
      countPages: countPdfPages,
      now: NOW,
      dryRun: false,
      storageDir: dir,
      log: () => {},
    };

    await collect(deps);
    expect(extractionCounter.calls).toBe(1);
    const first = await countRows(model.id);
    expect(first.extractions).toBe(1);

    await collect(deps);
    expect(extractionCounter.calls).toBe(1);
    const second = await countRows(model.id);
    expect(second.extractions).toBe(1);
    expect(second.documents).toBe(1);
  });

  it('2回続けて走らせても change_requests が重複しない', async () => {
    const { model } = await newSource();
    const dir = await storageDir();
    const deps = {
      http: fakeHttp([NOW], { gets: 0 }),
      extraction: fakeExtraction({ calls: 0 }),
      decryptor: createQpdfDecryptor(),
      countPages: countPdfPages,
      now: NOW,
      dryRun: false,
      storageDir: dir,
      log: () => {},
    };

    await collect(deps);
    const first = await countRows(model.id);
    expect(first.changes).toBeGreaterThan(0);

    await collect(deps);
    const second = await countRows(model.id);
    expect(second.changes).toBe(first.changes);
  });
});

describe('collect — 1件の失敗が全体を止めない', () => {
  it('死んだ取得元があっても他の処理は続く', async () => {
    const dead = await newSource({ available: false });
    const alive = await newSource();

    const summary = await run();

    // 生きている方は抽出まで到達している
    expect(summary.sources).toBeGreaterThanOrEqual(2);
    expect(summary.extracted).toBeGreaterThanOrEqual(1);

    const aliveRows = await countRows(alive.model.id);
    expect(aliveRows.extractions).toBe(1);

    const deadRows = await countRows(dead.model.id);
    expect(deadRows.documents).toBe(0);
  });
});

describe('collect — 取得不能を人間に上げる', () => {
  it('consecutive_failures が上限に達したら last_error に印が付く', async () => {
    const { source } = await newSource({ available: false });

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
      await run();
    }

    const [after] = await db
      .select({ failures: specSources.consecutiveFailures, lastError: specSources.lastError })
      .from(specSources)
      .where(eq(specSources.id, source.id));

    expect(after.failures).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES);
    expect(after.lastError).toContain(NEEDS_ATTENTION);
  });
});

describe('collect — dry-run', () => {
  it('DBに何も書かない', async () => {
    const { model } = await newSource();

    const summary = await run({ dryRun: true, extraction: null });

    expect(summary.sources).toBeGreaterThanOrEqual(1);
    const rows = await countRows(model.id);
    expect(rows.documents).toBe(0);
    expect(rows.extractions).toBe(0);
    expect(rows.changes).toBe(0);
  });
});
