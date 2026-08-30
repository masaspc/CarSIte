import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, grades, models, specDocuments, specSources } from '@/db/schema';
import type { ChangeKind, ChangeStatus } from '@/db/schema';
import { decideApproval } from '@/pipeline/approval-rules';

/**
 * draft を含む全件。管理画面からのみ使う。
 * db/queries.ts は published のみを返す公開APIなので、ここを混ぜない。
 */
export async function listAllGrades() {
  return db
    .select({
      grade: grades,
      modelName: models.name,
      modelSlug: models.slug,
      manufacturer: models.manufacturer,
      manufacturerSlug: models.manufacturerSlug,
      bodyType: models.bodyType,
      /** 親の車種が未検証ならグレードは公開できない（app/actions/cars.ts のゲート） */
      modelVerifiedAt: models.verifiedAt,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .orderBy(asc(models.manufacturer), asc(models.name), asc(grades.name));
}

export type AdminGrade = Awaited<ReturnType<typeof listAllGrades>>[number];

/** publicationStatus を問わず1件取得する。管理画面の編集フォーム用。 */
export async function findAdminGrade(id: string) {
  const [row] = await db
    .select({
      grade: grades,
      modelName: models.name,
      manufacturer: models.manufacturer,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(eq(grades.id, id))
    .limit(1);
  return row ?? null;
}

/** CarForm のモデル選択に使う。UUID を手入力させないための一覧。 */
export async function listModels() {
  return db
    .select({
      id: models.id,
      manufacturer: models.manufacturer,
      name: models.name,
      bodyType: models.bodyType,
    })
    .from(models)
    .orderBy(asc(models.manufacturer), asc(models.name));
}

export type ModelOption = Awaited<ReturnType<typeof listModels>>[number];

/**
 * 車種の検証状態の一覧。管理画面から検証済みにするための画面に使う。
 * 未検証の車種を先頭に出す（公開を止めているのはそこなので、探す手間を省く）。
 */
export async function listModelsWithVerification() {
  return db
    .select({
      id: models.id,
      manufacturer: models.manufacturer,
      name: models.name,
      bodyType: models.bodyType,
      description: models.description,
      officialUrl: models.officialUrl,
      verifiedAt: models.verifiedAt,
      verifiedBy: models.verifiedBy,
      gradeCount: sql<number>`count(${grades.id})::int`,
    })
    .from(models)
    .leftJoin(grades, eq(grades.modelId, models.id))
    .groupBy(models.id)
    // 未検証（NULL）を先頭に。Postgres の ASC は既定で NULLS LAST になる
    .orderBy(sql`${models.verifiedAt} ASC NULLS FIRST`, asc(models.manufacturer), asc(models.name));
}

export type ModelVerificationRow = Awaited<ReturnType<typeof listModelsWithVerification>>[number];

/**
 * 承認待ちの変更を書類（＝PDF1つ）ごとにまとめて返す。
 * 承認の粒度は車種単位＝諸元表1つである（設計書7.2）。
 */
export interface PendingChange {
  id: string;
  kind: ChangeKind;
  /** pending / approved / blocked のいずれか。承認と適用が別操作なので状態を出す */
  status: ChangeStatus;
  targetKey: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  /** 自動承認されなかった理由。列に持っていないので decideApproval で引き直す */
  reason: string;
  createdAt: Date;
}

export interface GroupedChangeRequests {
  specDocumentId: string;
  documentMonth: string;
  pdfUrl: string;
  modelId: string;
  manufacturer: string;
  modelName: string;
  changes: PendingChange[];
}

export async function listPendingChangeRequests(): Promise<GroupedChangeRequests[]> {
  const rows = await db
    .select({
      id: changeRequests.id,
      kind: changeRequests.kind,
      targetKey: changeRequests.targetKey,
      diff: changeRequests.diff,
      status: changeRequests.status,
      reason: changeRequests.reason,
      createdAt: changeRequests.createdAt,
      specDocumentId: specDocuments.id,
      documentMonth: specDocuments.documentMonth,
      pdfUrl: specDocuments.pdfUrl,
      modelId: models.id,
      manufacturer: models.manufacturer,
      modelName: models.name,
    })
    .from(changeRequests)
    .innerJoin(specDocuments, eq(changeRequests.specDocumentId, specDocuments.id))
    .innerJoin(specSources, eq(specDocuments.specSourceId, specSources.id))
    .innerJoin(models, eq(specSources.modelId, models.id))
    /*
     * pending だけでなく approved と blocked も出す。承認と適用が別操作なので、
     * approved を隠すと「適用」ボタンの対象が画面から消えてしまう。
     * blocked は「値が欠けていて適用できなかった」もので、人間の対応を待っている。
     * applied / rejected / stale は決着済みなので出さない。
     */
    .where(inArray(changeRequests.status, ['pending', 'approved', 'blocked']))
    .orderBy(asc(models.manufacturer), asc(models.name), asc(changeRequests.createdAt));

  if (rows.length === 0) return [];

  // decideApproval は「この諸元表のグレード総数」を見る。抽出結果は残っていないので
  // 親の車種の現在のグレード数で代用する。
  const gradeCounts = new Map<string, number>();
  for (const row of await db
    .select({ modelId: grades.modelId, value: count() })
    .from(grades)
    .groupBy(grades.modelId)) {
    gradeCounts.set(row.modelId, row.value);
  }

  const priceChangeCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'price_change') continue;
    priceChangeCounts.set(row.specDocumentId, (priceChangeCounts.get(row.specDocumentId) ?? 0) + 1);
  }

  const groups = new Map<string, GroupedChangeRequests>();
  for (const row of rows) {
    let group = groups.get(row.specDocumentId);
    if (!group) {
      group = {
        specDocumentId: row.specDocumentId,
        documentMonth: row.documentMonth,
        pdfUrl: row.pdfUrl,
        modelId: row.modelId,
        manufacturer: row.manufacturer,
        modelName: row.modelName,
        changes: [],
      };
      groups.set(row.specDocumentId, group);
    }

    const diff = (row.diff ?? {}) as PendingChange['diff'];

    group.changes.push({
      id: row.id,
      kind: row.kind,
      status: row.status,
      targetKey: row.targetKey,
      diff,
      // 収集時に判定した本人が書き残した理由が正。無い行だけ復元にまわす
      reason: row.reason ?? recoverReason(row, gradeCounts, priceChangeCounts),
      createdAt: row.createdAt,
    });
  }

  return [...groups.values()];
}

/**
 * reason 列が入る前に積まれた行のための復元。
 *
 * decideApproval が見る「その諸元表のグレード総数」は当時の値が残っていないため、
 * 親の車種の現在のグレード数で代用する。近似でしかないので、reason 列がある行では
 * 使わない。
 */
function recoverReason(
  row: { kind: ChangeKind; targetKey: string; diff: unknown; modelId: string; specDocumentId: string },
  gradeCounts: Map<string, number>,
  priceChangeCounts: Map<string, number>,
): string {
  const decision = decideApproval(
    { kind: row.kind, targetKey: row.targetKey, diff: (row.diff ?? {}) as PendingChange['diff'] },
    {
      totalGrades: gradeCounts.get(row.modelId) ?? 0,
      priceChangeCount: priceChangeCounts.get(row.specDocumentId) ?? 0,
    },
  );
  return decision.auto
    ? '自動承認の条件は満たしていますが、未承認のまま残っています'
    : decision.reason;
}
