import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

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
