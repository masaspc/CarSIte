import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades } from '@/db/schema';
import { findPublishedModel, listPublishedGrades } from '@/db/queries';

let publishedSlug: { manufacturer: string; model: string };
let targetGradeId: string;
let originalStatus: (typeof grades.$inferSelect)['publicationStatus'];

beforeAll(async () => {
  // シード直後は全件 draft。1件だけ published にして検証する。
  // テスト後に元の状態へ戻せるよう、変更前の値を必ず読んでから記録する。
  const [target] = await db.select().from(grades).limit(1);
  targetGradeId = target.id;
  originalStatus = target.publicationStatus;

  await db
    .update(grades)
    .set({ publicationStatus: 'published' })
    .where(eq(grades.id, target.id));

  const detail = await db.query.models.findFirst({ where: (m, { eq: e }) => e(m.id, target.modelId) });
  publishedSlug = { manufacturer: detail!.manufacturerSlug, model: detail!.slug };
});

afterAll(async () => {
  // データベースをテスト前の状態（全件 draft）に厳密に戻す。
  // 後続タスクは「新規シード直後は公開件数ゼロ」を前提にするため、
  // ここで漏らすと別タスクのテストが壊れる。
  await db
    .update(grades)
    .set({ publicationStatus: originalStatus })
    .where(eq(grades.id, targetGradeId));
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
