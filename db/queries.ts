import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { db } from '@/db';
import { dealers, grades, models, priceHistory, type FeatureColumn } from '@/db/schema';

const PUBLISHED = eq(grades.publicationStatus, 'published');

export interface GradeFilters {
  keyword?: string;
  manufacturers?: string[];
  bodyTypes?: string[];
  engineTypes?: string[];
  driveSystem?: string;
  priceMin?: number;
  priceMax?: number;
  fuelEfficiencyMin?: number;
  seatingMin?: number;
  /** 指定した装備が standard のものだけを返す。unknown はヒットさせない */
  features?: FeatureColumn[];
  sort?: 'price-asc' | 'price-desc' | 'fuel-desc' | 'date-desc' | 'date-asc';
  page?: number;
}

export const PAGE_SIZE = 24;

function buildConditions(filters: GradeFilters): SQL[] {
  const conditions: SQL[] = [PUBLISHED];

  if (filters.keyword) {
    const pattern = `%${filters.keyword}%`;
    conditions.push(
      sql`(${models.manufacturer} ILIKE ${pattern} OR ${models.name} ILIKE ${pattern} OR ${grades.name} ILIKE ${pattern})`,
    );
  }
  if (filters.manufacturers?.length) {
    conditions.push(inArray(models.manufacturer, filters.manufacturers));
  }
  if (filters.bodyTypes?.length) {
    conditions.push(sql`${models.bodyType}::text IN ${filters.bodyTypes}`);
  }
  if (filters.engineTypes?.length) {
    conditions.push(sql`${grades.engineType}::text IN ${filters.engineTypes}`);
  }
  if (filters.driveSystem) {
    conditions.push(sql`${grades.driveSystem}::text = ${filters.driveSystem}`);
  }
  if (filters.priceMin !== undefined) conditions.push(gte(grades.price, filters.priceMin));
  if (filters.priceMax !== undefined) conditions.push(lte(grades.price, filters.priceMax));
  if (filters.fuelEfficiencyMin !== undefined) {
    conditions.push(gte(grades.wltcMode, String(filters.fuelEfficiencyMin)));
  }
  if (filters.seatingMin !== undefined) conditions.push(gte(grades.seating, filters.seatingMin));

  for (const feature of filters.features ?? []) {
    conditions.push(sql`${grades[feature]} = 'standard'`);
  }

  return conditions;
}

function orderBy(sort: GradeFilters['sort']) {
  switch (sort) {
    case 'price-desc': return [desc(grades.price)];
    case 'fuel-desc': return [sql`${grades.wltcMode} DESC NULLS LAST`];
    case 'date-desc': return [sql`${grades.releaseDate} DESC NULLS LAST`];
    case 'date-asc': return [sql`${grades.releaseDate} ASC NULLS LAST`];
    default: return [asc(grades.price)];
  }
}

/**
 * published なグレードのみを返す。呼び出し側が publicationStatus を
 * 指定する余地はない — draft/archived を取得する公開APIは存在しない。
 */
export async function listPublishedGrades(filters: GradeFilters) {
  const conditions = buildConditions(filters);
  const page = filters.page ?? 1;

  const rows = await db
    .select({
      id: grades.id,
      slug: grades.slug,
      name: grades.name,
      price: grades.price,
      wltcMode: grades.wltcMode,
      engineType: grades.engineType,
      driveSystem: grades.driveSystem,
      seating: grades.seating,
      publicationStatus: grades.publicationStatus,
      sunroof: grades.sunroof,
      images: grades.images,
      modelName: models.name,
      modelSlug: models.slug,
      manufacturer: models.manufacturer,
      manufacturerSlug: models.manufacturerSlug,
      bodyType: models.bodyType,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(and(...conditions))
    .orderBy(...orderBy(filters.sort))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(and(...conditions));

  return { rows, total };
}

export type GradeListItem = Awaited<ReturnType<typeof listPublishedGrades>>['rows'][number];

/**
 * `manufacturerSlug/modelSlug/gradeSlug` 形式の GradeRef から published なグレードの
 * 全カラムを解決する。お気に入り・比較リストは slug 参照だけを保存しているため、
 * 表示のたびにこれで実体へ解決する。壊れた形式・draft/archived になった参照は
 * 黙って結果から除外する（呼び出し側で例外にはしない）。
 */
export async function findPublishedGradesByRefs(refs: string[]) {
  const parsed = refs
    .map((ref) => ref.split('/'))
    .filter((parts): parts is [string, string, string] => parts.length === 3 && parts.every(Boolean));

  if (parsed.length === 0) return [];

  const refConditions = parsed.map(([manufacturerSlug, modelSlug, gradeSlug]) =>
    and(
      eq(models.manufacturerSlug, manufacturerSlug),
      eq(models.slug, modelSlug),
      eq(grades.slug, gradeSlug),
    ),
  );

  return db
    .select({
      grade: grades,
      manufacturer: models.manufacturer,
      manufacturerSlug: models.manufacturerSlug,
      modelName: models.name,
      modelSlug: models.slug,
      bodyType: models.bodyType,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(and(PUBLISHED, or(...refConditions)));
}

export type ComparisonRow = Awaited<ReturnType<typeof findPublishedGradesByRefs>>[number];

/** ComparisonRow を CarCard が受け取る GradeListItem の形へ整形する */
export function toGradeListItem(row: ComparisonRow): GradeListItem {
  return {
    id: row.grade.id,
    slug: row.grade.slug,
    name: row.grade.name,
    price: row.grade.price,
    wltcMode: row.grade.wltcMode,
    engineType: row.grade.engineType,
    driveSystem: row.grade.driveSystem,
    seating: row.grade.seating,
    publicationStatus: row.grade.publicationStatus,
    sunroof: row.grade.sunroof,
    images: row.grade.images,
    modelName: row.modelName,
    modelSlug: row.modelSlug,
    manufacturer: row.manufacturer,
    manufacturerSlug: row.manufacturerSlug,
    bodyType: row.bodyType,
  };
}

/**
 * published なグレードを1件以上持つ車種のみを返す。
 * 車種自体は見つかっても、公開グレードがなければ null を返す。
 */
export async function findPublishedModel(manufacturerSlug: string, modelSlug: string) {
  const [model] = await db
    .select()
    .from(models)
    .where(and(eq(models.manufacturerSlug, manufacturerSlug), eq(models.slug, modelSlug)))
    .limit(1);

  if (!model) return null;

  const modelGrades = await db
    .select()
    .from(grades)
    .where(and(eq(grades.modelId, model.id), PUBLISHED))
    .orderBy(asc(grades.price));

  if (modelGrades.length === 0) return null;

  const history = await db
    .select()
    .from(priceHistory)
    .where(inArray(priceHistory.gradeId, modelGrades.map((g) => g.id)))
    .orderBy(asc(priceHistory.date));

  return { model, grades: modelGrades, priceHistory: history };
}

export type ModelDetail = NonNullable<Awaited<ReturnType<typeof findPublishedModel>>>;

/**
 * Server Component からはこちらを使う。Neon の無料枠はアイドル時にサスペンドし
 * 初回接続に時間がかかるため、unstable_cache でほとんどのリクエストをDBに到達させない。
 * Task 12 の revalidateTag('cars') で無効化される。
 */
export const getPublishedGrades = (filters: GradeFilters) =>
  unstable_cache(
    () => listPublishedGrades(filters),
    ['published-grades', JSON.stringify(filters)],
    { tags: ['cars'] },
  )();

export const getPublishedModel = (manufacturerSlug: string, modelSlug: string) =>
  unstable_cache(
    () => findPublishedModel(manufacturerSlug, modelSlug),
    ['published-model', manufacturerSlug, modelSlug],
    { tags: ['cars', `model:${manufacturerSlug}/${modelSlug}`] },
  )();

/** ディーラーは公開/非公開の区別を持たない。全件が公開情報。 */
export async function listDealers() {
  return db.select().from(dealers).orderBy(asc(dealers.prefecture), asc(dealers.name));
}

export type DealerListItem = Awaited<ReturnType<typeof listDealers>>[number];

export const getDealers = () =>
  unstable_cache(() => listDealers(), ['dealers'], { tags: ['dealers'] })();

/** 公開中の車種を持つメーカーの一覧。絞り込みUIの選択肢に使う */
export async function listPublishedManufacturers(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ manufacturer: models.manufacturer })
    .from(models)
    .innerJoin(grades, eq(grades.modelId, models.id))
    .where(eq(grades.publicationStatus, 'published'))
    .orderBy(asc(models.manufacturer));
  return rows.map((r) => r.manufacturer);
}

export const getPublishedManufacturers = () =>
  unstable_cache(() => listPublishedManufacturers(), ['published-manufacturers'], {
    tags: ['cars'],
  })();

/** 管理画面用。公開状態を問わず全グレードを返す。 */
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
