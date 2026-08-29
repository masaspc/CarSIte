import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, models, specDocuments, specSources } from '@/db/schema';

const createdSources: string[] = [];

afterEach(async () => {
  // spec_documents / change_requests は cascade で消える
  for (const id of createdSources.splice(0)) {
    await db.delete(specSources).where(eq(specSources.id, id));
  }
});

async function newSource(overrides: Record<string, unknown> = {}) {
  const [model] = await db.select({ id: models.id }).from(models).limit(1);
  const [row] = await db
    .insert(specSources)
    .values({
      modelId: model.id,
      pdfBaseUrl: `https://example.com/${Math.random().toString(36).slice(2)}/spec_`,
      ...overrides,
    })
    .returning();
  createdSources.push(row.id);
  return row;
}

async function newDocument(specSourceId: string, sha256: string) {
  const [row] = await db
    .insert(specDocuments)
    .values({
      specSourceId,
      pdfUrl: 'https://example.com/spec_202607.pdf',
      documentMonth: '2026-07',
      sha256,
      byteSize: 455_398,
      pageCount: 6,
    })
    .returning();
  return row;
}

describe('spec_sources', () => {
  it('登録できて、既定値が入る', async () => {
    const source = await newSource();
    expect(source.knownMonth).toBeNull();
    expect(source.consecutiveFailures).toBe(0);
    expect(source.lastCheckedAt).toBeNull();
  });

  it('同じベースパスは二重登録できない', async () => {
    const source = await newSource();
    const [model] = await db.select({ id: models.id }).from(models).limit(1);

    await expect(
      db.insert(specSources).values({ modelId: model.id, pdfBaseUrl: source.pdfBaseUrl }),
    ).rejects.toThrow();
  });

  it('known_month は YYYY-MM 形式しか受け付けない', async () => {
    await expect(newSource({ knownMonth: '202607' })).rejects.toThrow();
  });

  it('正しい形式の known_month は通る', async () => {
    const source = await newSource({ knownMonth: '2026-07' });
    expect(source.knownMonth).toBe('2026-07');
  });
});

describe('spec_documents', () => {
  it('同じ source に同じ sha256 は二度入らない（再取得しても増えない）', async () => {
    const source = await newSource();
    const sha = 'a'.repeat(64);

    await newDocument(source.id, sha);
    await expect(newDocument(source.id, sha)).rejects.toThrow();
  });

  it('spec_source を消すと cascade で消える', async () => {
    const source = await newSource();
    const document = await newDocument(source.id, 'e'.repeat(64));

    await db.delete(specSources).where(eq(specSources.id, source.id));
    createdSources.splice(createdSources.indexOf(source.id), 1);

    const remaining = await db
      .select({ id: specDocuments.id })
      .from(specDocuments)
      .where(eq(specDocuments.id, document.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('change_requests', () => {
  it('同じ文書・種別・対象は二重に積まれない（cronの重複起動対策）', async () => {
    const source = await newSource();
    const document = await newDocument(source.id, 'b'.repeat(64));

    const values = {
      specDocumentId: document.id,
      kind: 'price_change' as const,
      targetKey: '6LA-MXWH61-AHXHB',
      diff: { price: { before: 4_000_000, after: 4_200_000 } },
    };

    await db.insert(changeRequests).values(values);
    await expect(db.insert(changeRequests).values(values)).rejects.toThrow();
  });

  it('種別が違えば同じ対象でも積める', async () => {
    const source = await newSource();
    const document = await newDocument(source.id, 'd'.repeat(64));
    const base = { specDocumentId: document.id, targetKey: '6LA-MXWH61-AHXHB', diff: {} };

    await db.insert(changeRequests).values({ ...base, kind: 'price_change' });
    await expect(
      db.insert(changeRequests).values({ ...base, kind: 'spec_change' }),
    ).resolves.not.toThrow();
  });

  it('status の既定は pending', async () => {
    const source = await newSource();
    const document = await newDocument(source.id, 'c'.repeat(64));

    const [request] = await db
      .insert(changeRequests)
      .values({
        specDocumentId: document.id,
        kind: 'new_grade',
        targetKey: 'Z/2.0L PHEV/FF',
        diff: {},
      })
      .returning();

    expect(request.status).toBe('pending');
    expect(request.decidedBy).toBeNull();
    expect(request.appliedAt).toBeNull();
  });
});
