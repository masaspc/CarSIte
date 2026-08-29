import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

// Server Action はリクエスト外から呼ぶため、Next のキャッシュAPIだけ差し替える。
// 認可・検証・DB書き込みは本物を通す（ここで確かめたいのはその3つ）。
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { githubId: 'test-admin' } })) }));

const ADMIN_ID = 'test-admin';

let gradeId: string;
let modelId: string;
let original: typeof grades.$inferSelect;
let originalModel: typeof models.$inferSelect;

beforeAll(async () => {
  process.env.ADMIN_GITHUB_IDS = ADMIN_ID;

  const [row] = await db.select().from(grades).limit(1);
  original = row;
  gradeId = row.id;
  modelId = row.modelId;

  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  originalModel = model;
});

afterAll(async () => {
  // 公開件数ゼロ・全件 draft・車種は未検証、というシード直後の状態へ厳密に戻す。
  // 漏らすと公開ページに未検証データが出たまま残る。
  await db
    .update(grades)
    .set({
      publicationStatus: original.publicationStatus,
      verifiedAt: original.verifiedAt,
      verifiedBy: original.verifiedBy,
      updatedAt: original.updatedAt,
    })
    .where(eq(grades.id, gradeId));

  await db
    .update(models)
    .set({
      verifiedAt: originalModel.verifiedAt,
      verifiedBy: originalModel.verifiedBy,
      updatedAt: originalModel.updatedAt,
    })
    .where(eq(models.id, modelId));
});

async function currentGrade() {
  const [row] = await db.select().from(grades).where(eq(grades.id, gradeId)).limit(1);
  return row;
}

describe('setPublicationStatus の公開ゲート', () => {
  it('車種が未検証のあいだはグレードを公開できない', async () => {
    await db
      .update(models)
      .set({ verifiedAt: null, verifiedBy: null })
      .where(eq(models.id, modelId));

    const { setPublicationStatus } = await import('@/app/actions/cars');
    await expect(setPublicationStatus(gradeId, 'published')).rejects.toThrow(
      new RegExp(`${originalModel.manufacturer} ${originalModel.name}`),
    );

    // 拒否は「例外を投げるだけ」ではなく、実際に書き込まれていないことまで確かめる
    expect((await currentGrade()).publicationStatus).toBe('draft');
  });

  it('未検証でも draft・archived への変更は通す', async () => {
    const { setPublicationStatus } = await import('@/app/actions/cars');
    await expect(setPublicationStatus(gradeId, 'archived')).resolves.toBeUndefined();
    expect((await currentGrade()).publicationStatus).toBe('archived');

    await setPublicationStatus(gradeId, 'draft');
    expect((await currentGrade()).publicationStatus).toBe('draft');
  });

  it('車種を検証済みにすると公開できる', async () => {
    const { setModelVerified, setPublicationStatus } = await import('@/app/actions/cars');

    await setModelVerified(modelId);
    const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    expect(model.verifiedAt).not.toBeNull();
    expect(model.verifiedBy).toBe(ADMIN_ID);

    await expect(setPublicationStatus(gradeId, 'published')).resolves.toBeUndefined();
    const published = await currentGrade();
    expect(published.publicationStatus).toBe('published');
    expect(published.verifiedBy).toBe(ADMIN_ID);
  });

  it('車種の検証を取り消すと公開中のグレードも draft に戻る', async () => {
    const { clearModelVerified } = await import('@/app/actions/cars');

    await clearModelVerified(modelId);
    const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    expect(model.verifiedAt).toBeNull();
    expect((await currentGrade()).publicationStatus).toBe('draft');
  });
});

describe('updateGrade の slug 不変条件', () => {
  const inputOf = (row: typeof grades.$inferSelect) => ({
    modelId: row.modelId,
    name: row.name,
    slug: row.slug,
    price: row.price,
    releaseDate: row.releaseDate,
    discontinuedAt: row.discontinuedAt,
    engineType: row.engineType,
    driveSystem: row.driveSystem,
    transmission: row.transmission,
    seating: row.seating,
    displacement: row.displacement,
    weight: row.weight,
    wltcMode: row.wltcMode === null ? null : Number(row.wltcMode),
    cruisingRange: row.cruisingRange,
    ecoCarTax: row.ecoCarTax,
    airbags: row.airbags,
  });

  it('フォームが slug を書き換えてきたら拒否する', async () => {
    const { updateGrade } = await import('@/app/actions/cars');
    const row = await currentGrade();

    await expect(
      updateGrade(gradeId, { ...inputOf(row), slug: `${row.slug}-x` }),
    ).rejects.toThrow(/slug は作成後に変更できません/);

    expect((await currentGrade()).slug).toBe(row.slug);
  });

  it('slug が同じ通常の編集は通る', async () => {
    const { updateGrade } = await import('@/app/actions/cars');
    const row = await currentGrade();

    await expect(updateGrade(gradeId, inputOf(row))).resolves.toBeUndefined();
    expect((await currentGrade()).slug).toBe(row.slug);
  });
});

describe('updateGrade の modelId 不変条件', () => {
  const inputOf = (row: typeof grades.$inferSelect) => ({
    modelId: row.modelId,
    name: row.name,
    slug: row.slug,
    price: row.price,
    releaseDate: row.releaseDate,
    discontinuedAt: row.discontinuedAt,
    engineType: row.engineType,
    driveSystem: row.driveSystem,
    transmission: row.transmission,
    seating: row.seating,
    displacement: row.displacement,
    weight: row.weight,
    wltcMode: row.wltcMode === null ? null : Number(row.wltcMode),
    cruisingRange: row.cruisingRange,
    ecoCarTax: row.ecoCarTax,
    airbags: row.airbags,
  });

  /** 付け替え先に使う、いま編集している車種とは別の車種 */
  async function otherModelId() {
    const rows = await db.select({ id: models.id }).from(models).limit(5);
    const other = rows.find((row) => row.id !== modelId);
    if (!other) throw new Error('別の車種が見つかりません');
    return other.id;
  }

  it('フォームが modelId を書き換えてきたら拒否する', async () => {
    const { updateGrade } = await import('@/app/actions/cars');
    const row = await currentGrade();
    const target = await otherModelId();

    await expect(
      updateGrade(gradeId, { ...inputOf(row), modelId: target }),
    ).rejects.toThrow(/車種は作成後に変更できません/);

    expect((await currentGrade()).modelId).toBe(row.modelId);
  });

  it('modelId が同じ通常の編集は通る', async () => {
    const { updateGrade } = await import('@/app/actions/cars');
    const row = await currentGrade();

    await updateGrade(gradeId, { ...inputOf(row), seating: row.seating });

    expect((await currentGrade()).modelId).toBe(row.modelId);
  });

  it('公開中のグレードを未検証の車種へ移せない（公開ゲートの回避を塞ぐ）', async () => {
    /*
     * assertModelVerifiedForPublish は setPublicationStatus でしか働かない。
     * 検証済みの車種で公開したあとに未検証の車種へ付け替えられると、
     * 未検証の車種メタデータが published のまま公開ページに出る。
     */
    const { setModelVerified, setPublicationStatus, updateGrade } = await import(
      '@/app/actions/cars'
    );
    await setModelVerified(modelId);
    await setPublicationStatus(gradeId, 'published');

    const row = await currentGrade();
    const target = await otherModelId();

    await expect(
      updateGrade(gradeId, { ...inputOf(row), modelId: target }),
    ).rejects.toThrow(/車種は作成後に変更できません/);

    const after = await currentGrade();
    expect(after.modelId).toBe(modelId);
    expect(after.publicationStatus).toBe('published');

    // 後片付け。afterAll でも戻すが、後続テストに published を残さない
    await setPublicationStatus(gradeId, 'draft');
  });
});
