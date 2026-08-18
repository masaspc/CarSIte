import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, grades, models, specDocuments, specSources } from '@/db/schema';
import type { ChangeKind, ChangeStatus } from '@/db/schema';
import { gradeSlug } from '@/lib/slug';
import { applyChangeRequest, approveChangeRequest, rejectChangeRequest } from '@/pipeline/apply';

/**
 * 作った行は models を消せば cascade で全部消える
 * （grades / spec_sources → spec_documents → change_requests）。
 * 既存の103グレードには一切触らない。
 */
const createdModels: string[] = [];

afterEach(async () => {
  for (const id of createdModels.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

const rand = () => Math.random().toString(36).slice(2, 10);

const POWERTRAIN = '2.0L HEV';

async function newModel() {
  const token = rand();
  const [row] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `テスト車種${token}`,
      slug: `model-${token}`,
      bodyType: 'SUV',
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

async function newChangeRequest(
  modelId: string,
  options: {
    kind: ChangeKind;
    targetKey: string;
    diff: Record<string, { before: unknown; after: unknown }>;
    status?: ChangeStatus;
  },
) {
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
  const [row] = await db
    .insert(changeRequests)
    .values({
      specDocumentId: document.id,
      kind: options.kind,
      targetKey: options.targetKey,
      diff: options.diff,
      status: options.status ?? 'approved',
    })
    .returning();
  return row;
}

const priceDiff = (before: number, after: number) => ({ price: { before, after } });

async function readGrade(id: string) {
  const [row] = await db.select().from(grades).where(eq(grades.id, id));
  return row;
}

async function readRequest(id: string) {
  const [row] = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
  return row;
}

async function countGrades(modelId: string) {
  return (await db.select({ id: grades.id }).from(grades).where(eq(grades.modelId, modelId))).length;
}

describe('applyChangeRequest — price_change', () => {
  it('承認していない変更は適用されず、DBも変わらない', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
      status: 'pending',
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('not_approved');
    expect((await readGrade(grade.id)).price).toBe(3_200_000);
    expect((await readRequest(request.id)).status).toBe('pending');
  });

  it('承認済みを適用すると price が diff.after になる', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('applied');
    expect((await readGrade(grade.id)).price).toBe(3_400_000);
  });

  it('二度目の適用は noop で、二度は動かない', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('applied');
    expect(await applyChangeRequest(request.id, 'tester')).toBe('noop');
    expect((await readGrade(grade.id)).price).toBe(3_400_000);
  });

  it('現在値が diff.before と食い違うなら stale になり、上書きしない', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id, { price: 3_500_000 });
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('stale');
    expect((await readGrade(grade.id)).price).toBe(3_500_000);
  });

  it('stale になった change_request の status が stale に変わる', async () => {
    const model = await newModel();
    await newGrade(model.id, { price: 3_500_000 });
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    await applyChangeRequest(request.id, 'tester');
    expect((await readRequest(request.id)).status).toBe('stale');
  });

  it('applied になった行は applied_at と decided_by が埋まる', async () => {
    const model = await newModel();
    await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    await applyChangeRequest(request.id, 'masa');
    const applied = await readRequest(request.id);
    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).toBeInstanceOf(Date);
    expect(applied.decidedBy).toBe('masa');
  });

  it('適用しても publication_status は draft のまま（公開は別の操作）', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    await applyChangeRequest(request.id, 'tester');
    expect((await readGrade(grade.id)).publicationStatus).toBe('draft');
  });
});

describe('applyChangeRequest — new_grade', () => {
  const newGradeDiff = {
    name: { before: null, after: 'G' },
    powertrain: { before: null, after: POWERTRAIN },
    driveSystem: { before: null, after: '4WD' },
    typeDesignation: { before: null, after: null },
    price: { before: null, after: 2_900_000 },
    seating: { before: null, after: 5 },
    weight: { before: null, after: 1_500 },
    displacement: { before: null, after: 1_986 },
    wltcMode: { before: null, after: 26 },
    engineType: { before: null, after: 'ハイブリッド' },
    transmission: { before: null, after: '電気式無段変速機' },
  };

  it('適用すると行が1件増え、slug が gradeSlug と一致する', async () => {
    const model = await newModel();
    await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: newGradeDiff,
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('applied');
    expect(await countGrades(model.id)).toBe(2);

    const [created] = await db
      .select()
      .from(grades)
      .where(and(eq(grades.modelId, model.id), eq(grades.name, 'G')));
    expect(created.slug).toBe(gradeSlug('G', { powertrain: POWERTRAIN, driveSystem: '4WD' }));
    expect(created.publicationStatus).toBe('draft');
  });

  it('同じものをもう一度適用しても行は増えない', async () => {
    const model = await newModel();
    await newGrade(model.id);
    const request = await newChangeRequest(model.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: newGradeDiff,
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('applied');
    expect(await applyChangeRequest(request.id, 'tester')).toBe('noop');
    expect(await countGrades(model.id)).toBe(2);
  });

  it('同名・同パワートレイン・同駆動方式を2件適用すると2件目は applied にならない', async () => {
    const model = await newModel();
    await newGrade(model.id);
    const first = await newChangeRequest(model.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: newGradeDiff,
    });
    const second = await newChangeRequest(model.id, {
      kind: 'new_grade',
      targetKey: `G/${POWERTRAIN}/4WD`,
      diff: newGradeDiff,
    });

    expect(await applyChangeRequest(first.id, 'tester')).toBe('applied');
    expect(await applyChangeRequest(second.id, 'tester')).toBe('stale');
    expect((await readRequest(second.id)).status).toBe('stale');
    expect(await countGrades(model.id)).toBe(2);
  });
});

describe('applyChangeRequest — discontinued', () => {
  it('discontinued_at が埋まり、publication_status は触らない', async () => {
    const model = await newModel();
    const grade = await newGrade(model.id, { publicationStatus: 'published' });
    const request = await newChangeRequest(model.id, {
      kind: 'discontinued',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: { discontinued: { before: false, after: true } },
    });

    expect(await applyChangeRequest(request.id, 'tester')).toBe('applied');
    const after = await readGrade(grade.id);
    expect(after.discontinuedAt).not.toBeNull();
    expect(after.publicationStatus).toBe('published');
  });
});

describe('approveChangeRequest / rejectChangeRequest', () => {
  it('pending を承認できて、decided_by と decided_at が埋まる', async () => {
    const model = await newModel();
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
      status: 'pending',
    });

    expect(await approveChangeRequest(request.id, 'masa')).toBe(true);
    const approved = await readRequest(request.id);
    expect(approved.status).toBe('approved');
    expect(approved.decidedBy).toBe('masa');
    expect(approved.decidedAt).toBeInstanceOf(Date);
  });

  it('pending でないものは承認できない', async () => {
    const model = await newModel();
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
    });

    expect(await approveChangeRequest(request.id, 'masa')).toBe(false);
    expect((await readRequest(request.id)).status).toBe('approved');
  });

  it('pending を却下できる', async () => {
    const model = await newModel();
    const request = await newChangeRequest(model.id, {
      kind: 'price_change',
      targetKey: `Z/${POWERTRAIN}/FF`,
      diff: priceDiff(3_200_000, 3_400_000),
      status: 'pending',
    });

    expect(await rejectChangeRequest(request.id, 'masa')).toBe(true);
    expect((await readRequest(request.id)).status).toBe('rejected');
  });
});
