import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

// Server Action はリクエスト外から呼ぶため、Next のキャッシュAPIだけ差し替える。
// 認可・検証・DB書き込みは本物を通す（ここで確かめたいのはその3つ）。
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { githubId: 'test-admin' } })) }));

const ADMIN_ID = 'test-admin';

const rand = () => Math.random().toString(36).slice(2, 10);

/*
 * このテストは自分専用の車種・グレードを作り、自分で片付ける。
 *
 * 以前は `db.select().from(grades).limit(1)` で ORDER BY 無しに1件掴み、
 * afterAll でその1件と親車種だけを元の値に戻していた。ところが
 * clearModelVerified は「車種配下の公開中グレード“全部”」を draft に戻すため、
 * たまたま公開済みの実データを抱えた車種を掴んだ回では、そのテストが触っていない
 * 公開済みグレードまで巻き添えで draft になり、afterAll では復元できなかった
 * （本番データを壊す事故が実際に起きた）。
 *
 * 本番の行を一切掴まないよう、テスト用の車種2件とグレード1件をここで作成し、
 * afterAll で models を削除する（grades は cascade で消える）。
 */
async function newModel(overrides: Record<string, unknown> = {}) {
  const token = rand();
  const [row] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `テスト車種${token}`,
      slug: `model-${token}`,
      bodyType: 'SUV',
      ...overrides,
    })
    .returning();
  createdModelIds.push(row.id);
  return row;
}

async function newGrade(modelId: string, overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(grades)
    .values({
      modelId,
      name: 'Z',
      slug: `z-${rand()}`,
      price: 3_200_000,
      engineType: 'ハイブリッド',
      driveSystem: 'FF',
      seating: 5,
      ...overrides,
    })
    .returning();
  return row;
}

const createdModelIds: string[] = [];

let gradeId: string;
let modelId: string;
let modelManufacturer: string;
let modelName: string;
/** updateGrade の modelId 不変条件テストで、付け替え先として使う別の車種 */
let otherModelId: string;

beforeAll(async () => {
  process.env.ADMIN_GITHUB_IDS = ADMIN_ID;

  const model = await newModel();
  modelId = model.id;
  modelManufacturer = model.manufacturer;
  modelName = model.name;

  const grade = await newGrade(modelId);
  gradeId = grade.id;

  const other = await newModel();
  otherModelId = other.id;
});

afterAll(async () => {
  for (const id of createdModelIds.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
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
      new RegExp(`${modelManufacturer} ${modelName}`),
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

  it('フォームが modelId を書き換えてきたら拒否する', async () => {
    const { updateGrade } = await import('@/app/actions/cars');
    const row = await currentGrade();

    await expect(
      updateGrade(gradeId, { ...inputOf(row), modelId: otherModelId }),
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

    await expect(
      updateGrade(gradeId, { ...inputOf(row), modelId: otherModelId }),
    ).rejects.toThrow(/車種は作成後に変更できません/);

    const after = await currentGrade();
    expect(after.modelId).toBe(modelId);
    expect(after.publicationStatus).toBe('published');

    // 後片付け。afterAll でも models ごと消すが、後続テストに published を残さない
    await setPublicationStatus(gradeId, 'draft');
  });
});
