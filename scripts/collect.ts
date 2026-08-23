import '../load-env';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  FEATURE_COLUMNS,
  changeRequests,
  extractions,
  grades,
  models,
  specDocuments,
  specSources,
} from '@/db/schema';
import { buildPdfUrl, isStale } from '@/lib/spec-url';
import { applyChangeRequest } from '@/pipeline/apply';
import { decideApproval } from '@/pipeline/approval-rules';
import { createQpdfDecryptor, ensureDecrypted, type Decryptor } from '@/pipeline/decrypt';
import {
  computeChanges,
  gradeKey,
  normalizeGrades,
  type ExistingGrade,
} from '@/pipeline/diff';
import {
  EXTRACTION_MODEL,
  createAnthropicClient,
  extractSpec,
  type ExtractionClient,
} from '@/pipeline/extract';
import { fetchAndValidate, findLatestMonth } from '@/pipeline/fetch';
import { createFetchHttp, type Http } from '@/pipeline/http';
import { countPdfPages } from '@/pipeline/pdf';

/** 設計書8章。ここに達したら取得不能として人間に上げる */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** last_error の先頭に置く印。承認キューと同じく人間の判断を待つもの */
export const NEEDS_ATTENTION = '【要確認】';

export const DEFAULT_STORAGE_DIR = 'storage/pdfs';

export interface CollectDeps {
  http: Http;
  /** dry-run では抽出まで到達しないため null でよい */
  extraction: ExtractionClient | null;
  /** 諸元表は編集制限で暗号化されている。LLMに渡す前に外す */
  decryptor: Decryptor;
  countPages: (bytes: Uint8Array) => Promise<number>;
  /** 'YYYY-MM'。年月探索と鮮度判定の基準 */
  now: string;
  dryRun: boolean;
  storageDir: string;
  log: (message: string) => void;
}

export interface CollectSummary {
  sources: number;
  unchanged: number;
  extracted: number;
  failed: number;
  changesCreated: number;
  autoApplied: number;
  needsAttention: number;
}

/**
 * 週1回の収集本体。
 *
 * 1件の失敗が他を止めないよう、spec_source ごとに try/catch で囲む。
 * 数十件を回すので、1件のサイト構成変更で全部が止まると収集そのものが破綻する。
 */
export async function collect(deps: CollectDeps): Promise<CollectSummary> {
  const summary: CollectSummary = {
    sources: 0,
    unchanged: 0,
    extracted: 0,
    failed: 0,
    changesCreated: 0,
    autoApplied: 0,
    needsAttention: 0,
  };

  const sources = await db
    .select({
      id: specSources.id,
      modelId: specSources.modelId,
      pdfBaseUrl: specSources.pdfBaseUrl,
      knownMonth: specSources.knownMonth,
      consecutiveFailures: specSources.consecutiveFailures,
      manufacturer: models.manufacturer,
      modelName: models.name,
    })
    .from(specSources)
    .innerJoin(models, eq(specSources.modelId, models.id));

  if (sources.length === 0) {
    deps.log('spec_sources に登録がありません');
    return summary;
  }

  for (const source of sources) {
    summary.sources += 1;
    const label = `${source.manufacturer} ${source.modelName}`;
    try {
      const outcome = await collectOne(source, deps, label);
      if (outcome === 'unchanged') summary.unchanged += 1;
      if (outcome === 'needs_attention') summary.needsAttention += 1;
      if (typeof outcome === 'object') {
        summary.extracted += 1;
        summary.changesCreated += outcome.changesCreated;
        summary.autoApplied += outcome.autoApplied;
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`  失敗: ${label} — ${message}`);
      if (!deps.dryRun) {
        const escalated = await recordFailure(source.id, source.consecutiveFailures, message);
        if (escalated) summary.needsAttention += 1;
      }
    }
  }

  return summary;
}

type SourceRow = {
  id: string;
  modelId: string;
  pdfBaseUrl: string;
  knownMonth: string | null;
  consecutiveFailures: number;
};

type OneOutcome = 'unchanged' | 'needs_attention' | { changesCreated: number; autoApplied: number };

async function collectOne(
  source: SourceRow,
  deps: CollectDeps,
  label: string,
): Promise<OneOutcome> {
  // 1. 最新の年月を突き止める
  const found = await findLatestMonth(
    { pdfBaseUrl: source.pdfBaseUrl, knownMonth: source.knownMonth },
    deps.http,
    deps.now,
  );

  if ('deadBaseUrl' in found) {
    const message = `ベースパスが見つかりません（サイト構成が変わった可能性）: ${source.pdfBaseUrl}`;
    deps.log(`  ${label}: ${message}`);
    if (deps.dryRun) return 'needs_attention';
    const escalated = await recordFailure(source.id, source.consecutiveFailures, message);
    return escalated ? 'needs_attention' : 'unchanged';
  }

  const month = found.found;
  const url = buildPdfUrl(source.pdfBaseUrl, month);

  // 見つかった年月が古すぎる。別セクションIDに移った可能性がある
  if (isStale(month, deps.now)) {
    const message = `${NEEDS_ATTENTION} 最新の諸元表が ${month} で止まっています（別のセクションIDに移った可能性）`;
    deps.log(`  ${label}: ${message}`);
    if (!deps.dryRun) {
      await db.update(specSources).set({ lastError: message }).where(eq(specSources.id, source.id));
    }
    return 'needs_attention';
  }

  // 2. 取得して検査する
  const pdf = await fetchAndValidate(url, deps.http, deps.countPages);

  const [duplicate] = await db
    .select({ id: specDocuments.id })
    .from(specDocuments)
    .where(and(eq(specDocuments.specSourceId, source.id), eq(specDocuments.sha256, pdf.sha256)))
    .limit(1);

  if (duplicate) {
    // 中身が変わっていない。ここでLLMを呼ばないことが費用の要
    deps.log(`  ${label}: ${month} は前回と同じ内容（LLMは呼ばない）`);
    if (!deps.dryRun) {
      await db
        .update(specSources)
        .set({ lastCheckedAt: new Date(), consecutiveFailures: 0, lastError: null })
        .where(eq(specSources.id, source.id));
    }
    return 'unchanged';
  }

  if (deps.dryRun) {
    deps.log(`  ${label}: ${month} を取得して抽出する（${pdf.byteSize} バイト / ${pdf.pageCount} ページ）`);
    return 'unchanged';
  }

  // 3. 書類として記録し、原本を残す
  const storedPath = path.join(deps.storageDir, `${pdf.sha256}.pdf`);
  await mkdir(deps.storageDir, { recursive: true });
  await writeFile(storedPath, pdf.bytes);

  const [document] = await db
    .insert(specDocuments)
    .values({
      specSourceId: source.id,
      pdfUrl: url,
      documentMonth: month,
      sha256: pdf.sha256,
      byteSize: pdf.byteSize,
      pageCount: pdf.pageCount,
      storedPath,
    })
    .returning({ id: specDocuments.id });

  // 4. 抽出する。成否にかかわらず記録する（唯一の実コストなので捨てない）
  if (!deps.extraction) {
    throw new Error('ExtractionClient がありません。ANTHROPIC_API_KEY を設定してください');
  }
  /*
   * 暗号化を外してから渡す。sha256 と stored_path は原本のままにする —
   * 復号は qpdf の版で出力バイトが変わりうるので、変更検知の基準にはできない。
   */
  const forExtraction = await ensureDecrypted(pdf.bytes, deps.decryptor);
  const result = await extractSpec(forExtraction, deps.extraction);

  await db.insert(extractions).values({
    specDocumentId: document.id,
    modelIdUsed: EXTRACTION_MODEL,
    rawOutput: result.raw as never,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    succeeded: result.succeeded,
    error: result.succeeded ? null : result.error,
  });

  if (!result.succeeded) {
    throw new Error(`抽出に失敗しました: ${result.error}`);
  }

  // 5-6. 差分を出して承認キューに積む
  const existing = await loadExistingGrades(source.modelId);
  const drafts = computeChanges(existing, normalizeGrades(result.spec));
  const priceChangeCount = drafts.filter((draft) => draft.kind === 'price_change').length;

  let changesCreated = 0;
  let autoApplied = 0;

  for (const draft of drafts) {
    const decision = decideApproval(draft, {
      totalGrades: existing.length,
      priceChangeCount,
    });

    const [created] = await db
      .insert(changeRequests)
      .values({
        specDocumentId: document.id,
        kind: draft.kind,
        targetKey: draft.targetKey,
        diff: draft.diff,
        status: decision.auto ? 'approved' : 'pending',
        // 判定した本人がその場で書き残す。後から復元すると当時の文脈が失われる
        reason: decision.auto ? null : decision.reason,
        decidedBy: decision.auto ? 'system' : null,
        decidedAt: decision.auto ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: changeRequests.id });

    if (!created) continue;
    changesCreated += 1;

    if (decision.auto) {
      const applied = await applyChangeRequest(created.id, 'system');
      if (applied === 'applied') autoApplied += 1;
      else deps.log(`  ${label}: 自動適用が ${applied} になりました（${draft.targetKey}）`);
    }
  }

  // 7. 成功したので失敗の記録を消し、既知の年月を進める
  await db
    .update(specSources)
    .set({
      knownMonth: month,
      lastCheckedAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
    })
    .where(eq(specSources.id, source.id));

  deps.log(`  ${label}: ${month} から変更 ${changesCreated} 件（うち自動適用 ${autoApplied} 件）`);
  return { changesCreated, autoApplied };
}

/** 失敗を数える。上限に達したら last_error に印を付けて人間に上げる */
async function recordFailure(
  sourceId: string,
  current: number,
  message: string,
): Promise<boolean> {
  const failures = current + 1;
  const escalated = failures >= MAX_CONSECUTIVE_FAILURES;
  await db
    .update(specSources)
    .set({
      consecutiveFailures: failures,
      lastCheckedAt: new Date(),
      lastError: escalated ? `${NEEDS_ATTENTION} ${failures}回連続で失敗: ${message}` : message,
    })
    .where(eq(specSources.id, sourceId));
  return escalated;
}

async function loadExistingGrades(modelId: string): Promise<ExistingGrade[]> {
  const rows = await db.select().from(grades).where(eq(grades.modelId, modelId));

  return rows.map((row) => {
    const features: Record<string, string> = {};
    for (const column of FEATURE_COLUMNS) {
      features[column] = row[column];
    }
    return {
      id: row.id,
      typeDesignation: row.typeDesignation,
      name: row.name,
      powertrain: row.powertrain,
      driveSystem: row.driveSystem,
      price: row.price,
      seating: row.seating,
      weight: row.weight,
      displacement: row.displacement,
      wltcMode: row.wltcMode,
      engineType: row.engineType,
      transmission: row.transmission,
      discontinuedAt: row.discontinuedAt,
      features,
    };
  });
}

function currentMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (!dryRun && !apiKey.trim()) {
    throw new Error(
      'ANTHROPIC_API_KEY が設定されていません。--dry-run なら抽出まで到達しないので不要です',
    );
  }

  console.log(dryRun ? '収集（dry-run: 書き込みません）' : '収集を開始します');

  const summary = await collect({
    http: createFetchHttp(),
    extraction: dryRun ? null : createAnthropicClient(apiKey),
    decryptor: createQpdfDecryptor(),
    countPages: countPdfPages,
    now: currentMonth(),
    dryRun,
    storageDir: DEFAULT_STORAGE_DIR,
    log: (message) => console.log(message),
  });

  console.log(
    `対象 ${summary.sources} 件 / 変更なし ${summary.unchanged} / 抽出 ${summary.extracted} / ` +
      `失敗 ${summary.failed} / 変更 ${summary.changesCreated} 件（自動適用 ${summary.autoApplied}）/ ` +
      `要確認 ${summary.needsAttention}`,
  );

  if (summary.needsAttention > 0) {
    console.log(`${NEEDS_ATTENTION} 人間の確認が必要な取得元があります。spec_sources.last_error を見てください`);
  }
}

if (process.argv[1]?.includes('collect')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { currentMonth, gradeKey };
