import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, grades, models, specDocuments, specSources } from '@/db/schema';
import type { ChangeKind, ChangeStatus } from '@/db/schema';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
// Server Action の revalidateTag はリクエスト文脈の外では動かない
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const createdModels: string[] = [];

afterEach(async () => {
  for (const id of createdModels.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

const rand = () => Math.random().toString(36).slice(2, 10);
const POWERTRAIN = '2.0L HEV';

async function setSession(session: unknown) {
  process.env.ADMIN_GITHUB_IDS = '12345,67890';
  const { auth } = await import('@/auth');
  vi.mocked(auth).mockResolvedValue(session as never);
}

const asAnonymous = () => setSession(null);
const asOutsider = () => setSession({ user: { githubId: '999999' } });
const asAdmin = () => setSession({ user: { githubId: '12345' } });

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
  createdModels.push(row.id);
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
      powertrain: POWERTRAIN,
      ...overrides,
    })
    .returning();
  return row;
}

async function newDocument(modelId: string) {
  const [source] = await db
    .insert(specSources)
    .values({ modelId, pdfBaseUrl: `https://example.com/${rand()}/spec_` })
    .returning();
  const [document] = await db
    .insert(specDocuments)
    .values({
      specSourceId: source.id,
      pdfUrl: 'https://example.com/spec_202607.pdf',
      documentMonth: '2026-07',
      sha256: `${rand()}${rand()}${rand()}${rand()}`,
      byteSize: 455_398,
      pageCount: 6,
    })
    .returning();
  return document;
}

async function newChangeRequest(
  specDocumentId: string,
  options: {
    kind: ChangeKind;
    targetKey: string;
    diff: Record<string, { before: unknown; after: unknown }>;
    status?: ChangeStatus;
  },
) {
  const [row] = await db
    .insert(changeRequests)
    .values({
      specDocumentId,
      kind: options.kind,
      targetKey: options.targetKey,
      diff: options.diff,
      status: options.status ?? 'pending',
    })
    .returning();
  return row;
}

const NEW_GRADE_DIFF = {
  name: { before: null, after: 'G' },
  powertrain: { before: null, after: POWERTRAIN },
  driveSystem: { before: null, after: '4WD' },
  price: { before: null, after: 2_900_000 },
  seating: { before: null, after: 5 },
  engineType: { before: null, after: 'ハイブリッド' },
};

async function readRequest(id: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  return row;
}

describe('approveDocument / rejectDocument の認可', () => {
  it('未認証なら AuthorizationError', async () => {
    await asAnonymous();
    const model = await newModel();
    const document = await newDocument(model.id);

    const { approveDocument } = await import('@/app/actions/changes');
    await expect(approveDocument(document.id)).rejects.toThrow('認証が必要です');
  });

  it('許可リストに無い GitHub ID なら AuthorizationError', async () => {
    await asOutsider();
    const model = await newModel();
    const document = await newDocument(model.id);

    const { approveDocument } = await import('@/app/actions/changes');
    await expect(approveDocument(document.id)).rejects.toThrow('管理者権限がありません');
  });

  it('許可された ID なら通り、その書類の change_requests が approved になる', async () => {
    await asAdmin();
    const model = await newModel();
    await newGrade(model.id);
    const document = await newDocument(model.id);
    const first = await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 3_400_000 } },
    });
    const second = await newChangeRequest(document.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: NEW_GRADE_DIFF,
    });

    const { approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);

    expect((await readRequest(first.id)).status).toBe('approved');
    expect((await readRequest(second.id)).status).toBe('approved');
    expect((await readRequest(first.id)).decidedBy).toBe('12345');
  });

  it('却下は rejected にする', async () => {
    await asAdmin();
    const model = await newModel();
    const document = await newDocument(model.id);
    const request = await newChangeRequest(document.id, {
      kind: 'spec_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { seating: { before: 5, after: 7 } },
    });

    const { rejectDocument } = await import('@/app/actions/changes');
    await rejectDocument(document.id);

    expect((await readRequest(request.id)).status).toBe('rejected');
  });

  it('未認証の却下も AuthorizationError', async () => {
    await asAnonymous();
    const model = await newModel();
    const document = await newDocument(model.id);

    const { rejectDocument } = await import('@/app/actions/changes');
    await expect(rejectDocument(document.id)).rejects.toThrow('認証が必要です');
  });
});

describe('承認しても公開されないこと', () => {
  it('new_grade を承認・適用してもグレードは draft のままで公開ページに出ない', async () => {
    await asAdmin();
    const model = await newModel();
    await newGrade(model.id);
    const document = await newDocument(model.id);
    const request = await newChangeRequest(document.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: NEW_GRADE_DIFF,
    });

    const { approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);

    const { applyChangeRequest } = await import('@/pipeline/apply');
    expect(await applyChangeRequest(request.id, '12345')).toBe('applied');

    const [created] = await db
      .select()
      .from(grades)
      .where(eq(grades.modelId, model.id))
      .orderBy(grades.name);
    expect(created.publicationStatus).toBe('draft');

    const { listPublishedGrades } = await import('@/db/queries');
    const { rows, total } = await listPublishedGrades({ keyword: model.name });
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it('親の車種が未検証なら published にできない', async () => {
    await asAdmin();
    const model = await newModel();
    const grade = await newGrade(model.id);
    expect(model.verifiedAt).toBeNull();

    const { setPublicationStatus } = await import('@/app/actions/cars');
    await expect(setPublicationStatus(grade.id, 'published')).rejects.toThrow(
      /未検証のため/,
    );

    const [after] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(after.publicationStatus).toBe('draft');
  });

  it('pending の change_request は公開クエリの結果に一切影響しない', async () => {
    await asAdmin();
    const model = await newModel();
    await newGrade(model.id);
    const document = await newDocument(model.id);
    await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 9_900_000 } },
    });

    const { listPublishedGrades } = await import('@/db/queries');
    const { total } = await listPublishedGrades({ keyword: model.name });
    expect(total).toBe(0);

    // 承認していないので価格も動いていない
    const [row] = await db.select().from(grades).where(eq(grades.modelId, model.id));
    expect(row.price).toBe(3_200_000);
  });
});

describe('listPendingChangeRequests', () => {
  it('spec_document_id ごとにまとめ、pending だけを返す', async () => {
    const model = await newModel();
    await newGrade(model.id);
    const document = await newDocument(model.id);
    await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 3_400_000 } },
    });
    await newChangeRequest(document.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: NEW_GRADE_DIFF,
    });
    await newChangeRequest(document.id, {
      kind: 'spec_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { seating: { before: 5, after: 7 } },
      status: 'applied',
    });

    const { listPendingChangeRequests } = await import('@/db/admin-queries');
    const groups = await listPendingChangeRequests();
    const group = groups.find((item) => item.specDocumentId === document.id);

    expect(group).toBeDefined();
    expect(group!.manufacturer).toBe(model.manufacturer);
    expect(group!.modelName).toBe(model.name);
    // applied のものは含めない
    expect(group!.changes).toHaveLength(2);
    // 自動承認されなかった理由が付く
    for (const change of group!.changes) {
      expect(typeof change.reason).toBe('string');
      expect(change.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('applyDocument', () => {
  it('未認証なら AuthorizationError', async () => {
    await asAnonymous();
    const model = await newModel();
    const document = await newDocument(model.id);

    const { applyDocument } = await import('@/app/actions/changes');
    await expect(applyDocument(document.id)).rejects.toThrow('認証が必要です');
  });

  it('許可リストに無い GitHub ID なら AuthorizationError', async () => {
    await asOutsider();
    const model = await newModel();
    const document = await newDocument(model.id);

    const { applyDocument } = await import('@/app/actions/changes');
    await expect(applyDocument(document.id)).rejects.toThrow('管理者権限がありません');
  });

  it('承認しただけでは grades は変わらない（承認と適用は別操作）', async () => {
    await asAdmin();
    const model = await newModel();
    const grade = await newGrade(model.id);
    const document = await newDocument(model.id);
    await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 3_400_000 } },
    });

    const { approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);

    const [after] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(after.price).toBe(3_200_000);
  });

  it('適用すると grades に反映される', async () => {
    await asAdmin();
    const model = await newModel();
    const grade = await newGrade(model.id);
    const document = await newDocument(model.id);
    await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 3_400_000 } },
    });

    const { applyDocument, approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);
    await applyDocument(document.id);

    const [after] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(after.price).toBe(3_400_000);
    // 公開状態は触らない
    expect(after.publicationStatus).toBe('draft');
  });

  it('価格の無い new_grade は blocked になり、承認キューに残る', async () => {
    await asAdmin();
    const model = await newModel();
    await newGrade(model.id);
    const document = await newDocument(model.id);
    // 諸元表から起こした new_grade は price を持たない（諸元表に価格が無いため）
    const { price: _price, ...withoutPrice } = NEW_GRADE_DIFF;
    const request = await newChangeRequest(document.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: withoutPrice,
    });

    const { applyDocument, approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);
    await applyDocument(document.id);

    expect((await readRequest(request.id)).status).toBe('blocked');

    // グレードは増えていない
    const rows = await db.select().from(grades).where(eq(grades.modelId, model.id));
    expect(rows).toHaveLength(1);

    // blocked は画面に出続ける（listPendingChangeRequests が拾う）
    const { listPendingChangeRequests } = await import('@/db/admin-queries');
    const groups = await listPendingChangeRequests();
    const group = groups.find((g) => g.specDocumentId === document.id);
    expect(group?.changes.some((c) => c.status === 'blocked')).toBe(true);
  });

  it('二度適用しても二重には当たらない', async () => {
    await asAdmin();
    const model = await newModel();
    const grade = await newGrade(model.id);
    const document = await newDocument(model.id);
    await newChangeRequest(document.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { price: { before: 3_200_000, after: 3_400_000 } },
    });

    const { applyDocument, approveDocument } = await import('@/app/actions/changes');
    await approveDocument(document.id);
    await applyDocument(document.id);
    await applyDocument(document.id);

    const [after] = await db.select().from(grades).where(eq(grades.id, grade.id));
    expect(after.price).toBe(3_400_000);
  });
});
