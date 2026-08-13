import { asc, eq } from 'drizzle-orm';
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
