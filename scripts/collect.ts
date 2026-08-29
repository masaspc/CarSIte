import '../load-env';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { models, specDocuments, specSources } from '@/db/schema';
import { buildPdfUrl, isStale } from '@/lib/spec-url';
import { createQpdfDecryptor, type Decryptor } from '@/pipeline/decrypt';
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
  /** 諸元表は編集制限で暗号化されている。保存する原本は暗号化されたままにする */
  decryptor: Decryptor;
  countPages: (bytes: Uint8Array) => Promise<number>;
  /** 'YYYY-MM'。年月探索と鮮度判定の基準 */
  now: string;
  dryRun: boolean;
  storageDir: string;
  log: (message: string) => void;
  /**
   * 処理する spec_source を限定する。省略すると全件。
   *
   * 1件だけ再試行したいとき（取得元の構成変更を直した直後など）に使う。
   * 統合テストもこれで自分が作ったソースだけに絞る — 絞らないと
   * 本物の登録済みソースまで偽のHTTPで処理してしまい、実データを汚す。
   */
  sourceIds?: string[];
}

export interface CollectSummary {
  sources: number;
  /** 前回と同じ内容だったもの */
  unchanged: number;
  /** 内容が変わっていて spec_documents に記録したもの */
  detected: number;
  failed: number;
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
    detected: 0,
    failed: 0,
    needsAttention: 0,
  };

  const only = deps.sourceIds ? new Set(deps.sourceIds) : null;

  const all = await db
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

  const sources = only ? all.filter((source) => only.has(source.id)) : all;

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
      if (outcome === 'detected') summary.detected += 1;
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

type OneOutcome = 'unchanged' | 'needs_attention' | 'detected';

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
    // 中身が変わっていない
    deps.log(`  ${label}: ${month} は前回と同じ内容`);
    if (!deps.dryRun) {
      await db
        .update(specSources)
        .set({ lastCheckedAt: new Date(), consecutiveFailures: 0, lastError: null })
        .where(eq(specSources.id, source.id));
    }
    return 'unchanged';
  }

  if (deps.dryRun) {
    deps.log(`  ${label}: ${month} は前回と内容が違う（${pdf.byteSize} バイト / ${pdf.pageCount} ページ）`);
    return 'unchanged';
  }

  // 3. 書類として記録し、原本を残す
  const storedPath = path.join(deps.storageDir, `${pdf.sha256}.pdf`);
  await mkdir(deps.storageDir, { recursive: true });
  await writeFile(storedPath, pdf.bytes);

  await db
    .insert(specDocuments)
    .values({
      specSourceId: source.id,
      pdfUrl: url,
      documentMonth: month,
      sha256: pdf.sha256,
      byteSize: pdf.byteSize,
      pageCount: pdf.pageCount,
      storedPath,
    });

  /*
   * ここで止める。抽出はしない。
   *
   * 主要諸元表はテキストとして読めるのでLLMは要らず、装備一覧表は色で
   * 情報を表しているのでテキストでは読めない（設計書6.0）。無人で
   * できるのは「変わったことを記録して原本を残す」ところまでである。
   * 取り込みは scripts/ingest-spec.ts が有人で行う。
   */
  await db
    .update(specSources)
    .set({
      knownMonth: month,
      lastCheckedAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
    })
    .where(eq(specSources.id, source.id));

  deps.log(`  ${label}: ${month} は前回と内容が違う。取り込み待ち（npm run ingest-spec -- --model-slug <slug>）`);
  return 'detected';
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

function currentMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** `--source <uuid>` を複数回書ける。省略時は全件 */
function parseSourceIds(argv: string[]): string[] | undefined {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--source') continue;
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) ids.push(value);
  }
  return ids.length > 0 ? ids : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sourceIds = parseSourceIds(process.argv);

  console.log(dryRun ? '収集（dry-run: 書き込みません）' : 'PDFの変更を確認します');

  const summary = await collect({
    http: createFetchHttp(),
    decryptor: createQpdfDecryptor(),
    countPages: countPdfPages,
    now: currentMonth(),
    dryRun,
    storageDir: DEFAULT_STORAGE_DIR,
    log: (message) => console.log(message),
    sourceIds,
  });

  console.log(
    `対象 ${summary.sources} 件 / 変更なし ${summary.unchanged} / ` +
      `変更あり ${summary.detected} / 失敗 ${summary.failed} / 要確認 ${summary.needsAttention}`,
  );

  if (summary.detected > 0) {
    console.log('変更のあった車種は npm run ingest-spec で取り込んでください');
  }
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

export { currentMonth };
