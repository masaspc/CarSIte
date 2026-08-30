import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';
import { findPublishedModel, listPublishedGrades } from '@/db/queries';

const rand = () => Math.random().toString(36).slice(2, 10);

let publishedSlug: { manufacturer: string; model: string };
const createdModelIds: string[] = [];

/*
 * 以前は `db.select().from(grades).limit(1)` で ORDER BY 無しに本番の行を1件掴み、
 * afterAll でその1件を元の publicationStatus に戻していた。これは
 * tests/integration/publication.test.ts で実際に本番データを壊した事故と同じ形
 * （ORDER BY 無しの limit(1) で任意の本番行を掴み、publicationStatus を書き換える）。
 *
 * 本番の行を一切掴まないよう、テスト用の車種とグレードをここで作成し、
 * afterAll で models を削除する（grades は cascade で消える）。
 */
beforeAll(async () => {
  const token = rand();
  const [model] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `__test_車種${token}`,
      slug: `model-${token}`,
      bodyType: 'SUV',
    })
    .returning();
  createdModelIds.push(model.id);

  await db.insert(grades).values({
    modelId: model.id,
    name: `__test_Z`,
    slug: `z-${token}`,
    price: 3_200_000,
    engineType: 'ハイブリッド',
    driveSystem: 'FF',
    seating: 5,
    publicationStatus: 'published',
    sunroof: 'standard',
  });

  publishedSlug = { manufacturer: model.manufacturerSlug, model: model.slug };
});

afterAll(async () => {
  for (const id of createdModelIds.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

describe('listPublishedGrades', () => {
  it('draft を1件も返さない', async () => {
    const { rows } = await listPublishedGrades({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.publicationStatus === 'published')).toBe(true);
  });

  it('公開件数と総数が一致する', async () => {
    const { rows, total } = await listPublishedGrades({});
    expect(total).toBe(rows.length);
  });

  it('価格の上限で絞り込める', async () => {
    const { rows } = await listPublishedGrades({ priceMax: 1 });
    expect(rows).toHaveLength(0);
  });

  it('装備の unknown をヒットさせない', async () => {
    const { rows } = await listPublishedGrades({ features: ['sunroof'] });
    expect(rows.every((r) => r.sunroof === 'standard')).toBe(true);
  });
});

describe('findPublishedModel', () => {
  it('公開グレードを持つ車種を slug で引ける', async () => {
    const found = await findPublishedModel(publishedSlug.manufacturer, publishedSlug.model);
    expect(found).not.toBeNull();
    expect(found!.grades.every((g) => g.publicationStatus === 'published')).toBe(true);
  });

  it('存在しない slug は null を返す', async () => {
    expect(await findPublishedModel('no-such-maker', 'no-such-model')).toBeNull();
  });
});
