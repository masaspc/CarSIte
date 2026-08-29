import '../load-env';
import { readFileSync } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
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
import { ExtractedSpecSchema } from '@/pipeline/extraction-schema';
import { computeChanges, normalizeGrades, type ExistingGrade } from '@/pipeline/diff';
import { decideApproval } from '@/pipeline/approval-rules';

/**
 * 人が諸元表を読んで書いたJSONを取り込む。
 *
 * 週次ジョブ（scripts/collect.ts）はPDFが変わったことを spec_documents に
 * 記録するところまでしか行わない。そこから先、諸元を読み取る工程は
 * 対話セッションの Claude が行い、結果をこのスクリプトに渡す（設計書6.0.2）。
 *
 * 差分・承認・冪等な適用は既存の経路をそのまま通る。変わるのは
 * ExtractedSpec の生産者だけである。
 */
export class IngestError extends Error {}

export interface IngestResult {
  modelName: string;
  specDocumentId: string;
  /** 新しく積んだ change_requests の件数 */
  created: number;
  /** 既に同じものが積まれていて飛ばした件数 */
  skipped: number;
}

/**
 * 諸元表には車両本体価格も装備の色分けも載っていないため比較しない。
 * 載っていないものを null として比較すると、毎回・全グレードに
 * 空振りの変更が立つ（設計書6.0.3）。
 */
const COMPARE_OPTIONS = { comparePrice: false, compareFeatures: false } as const;

export async function ingestSpec(modelSlug: string, spec: unknown): Promise<IngestResult> {
  const found = await db
    .select({ id: models.id, name: models.name, manufacturer: models.manufacturer })
    .from(models)
    .where(eq(models.slug, modelSlug));

  if (found.length === 0) {
    throw new IngestError(`slug "${modelSlug}" の車種が見つかりません`);
  }
  if (found.length > 1) {
    throw new IngestError(
      `slug "${modelSlug}" が複数の車種に一致します。models.slug はメーカー内でしか一意でないため絞り込めません`,
    );
  }
  const model = found[0];

  // 最新の spec_document に紐づける。change_requests.spec_document_id は NOT NULL
  const [document] = await db
    .select({ id: specDocuments.id, documentMonth: specDocuments.documentMonth })
    .from(specDocuments)
    .innerJoin(specSources, eq(specDocuments.specSourceId, specSources.id))
    .where(eq(specSources.modelId, model.id))
    .orderBy(desc(specDocuments.documentMonth), desc(specDocuments.fetchedAt))
    .limit(1);

  if (!document) {
    throw new IngestError(
      `${model.manufacturer} ${model.name} の諸元表がまだ取得されていません。` +
        '先に npm run collect を実行してください',
    );
  }

  // 検証に落ちたら何も書かない。半分正しいデータは全部間違っているより見つけにくい
  const parsed = ExtractedSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new IngestError(
      `諸元データの検証に失敗しました: ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }

  const existing = await loadExistingGrades(model.id);
  const drafts = computeChanges(existing, normalizeGrades(parsed.data), COMPARE_OPTIONS);

  await db.insert(extractions).values({
    specDocumentId: document.id,
    // LLM経由と区別できるようにする。監査証跡の形は揃える
    modelIdUsed: 'manual',
    rawOutput: parsed.data as never,
    inputTokens: null,
    outputTokens: null,
    succeeded: true,
    error: null,
  });

  let created = 0;
  let skipped = 0;

  for (const draft of drafts) {
    const decision = decideApproval(draft, {
      totalGrades: existing.length,
      priceChangeCount: 0,
    });

    const [row] = await db
      .insert(changeRequests)
      .values({
        specDocumentId: document.id,
        kind: draft.kind,
        targetKey: draft.targetKey,
        diff: draft.diff,
        status: decision.auto ? 'approved' : 'pending',
        reason: decision.auto ? null : decision.reason,
        decidedBy: decision.auto ? 'system' : null,
        decidedAt: decision.auto ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: changeRequests.id });

    if (row) created += 1;
    else skipped += 1;
  }

  return { modelName: model.name, specDocumentId: document.id, created, skipped };
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

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelSlug = args['model-slug'];
  if (!modelSlug) {
    throw new IngestError(
      '使い方: npm run ingest-spec -- --model-slug <slug> [--file <path>]',
    );
  }

  // 既定の置き場所。tests/fixtures に置くのは、テストからも参照して
  // 「何をどう読んだか」を検証できるようにするため
  const file = args.file ?? `tests/fixtures/${modelSlug}.spec.json`;
  const spec = JSON.parse(readFileSync(file, 'utf8'));

  const result = await ingestSpec(modelSlug, spec);

  console.log(
    `${result.modelName}: 変更 ${result.created} 件を積みました（重複で飛ばした分 ${result.skipped} 件）`,
  );
  if (result.created > 0) {
    console.log('/admin/changes で内容を確認して承認してください');
  }
}

if (process.argv[1]?.includes('ingest-spec')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
