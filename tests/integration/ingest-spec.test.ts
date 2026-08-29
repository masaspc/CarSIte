import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, extractions, grades, models, specDocuments, specSources } from '@/db/schema';
import { ingestSpec } from '@/scripts/ingest-spec';

const createdModels: string[] = [];

afterEach(async () => {
  for (const id of createdModels.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function newModelWithDocument() {
  const token = rand();
  const [model] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `テスト車種${token}`,
      slug: `model-${token}`,
      bodyType: 'セダン',
    })
    .returning();
  createdModels.push(model.id);

  const [source] = await db
    .insert(specSources)
    .values({ modelId: model.id, pdfBaseUrl: `https://example.com/${token}/spec_` })
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

  return { model, source, document };
}

const spec = (modelName: string, overrides: Record<string, unknown> = {}) => ({
  modelName,
  grades: [
    {
      name: 'Z',
      powertrain: '2.0L ハイブリッド車',
      driveSystemRaw: '2WD',
      typeDesignation: '6AA-TEST-A',
      price: null,
      seating: 5,
      weight: 1420,
      displacement: 1986,
      wltcMode: 28.4,
      engineType: 'ハイブリッド',
      transmission: '電気式無段変速機',
    },
  ],
  ...overrides,
});

async function changesOf(documentId: string) {
  return db.select().from(changeRequests).where(eq(changeRequests.specDocumentId, documentId));
}

describe('ingestSpec', () => {
  it('新しいグレードを change_requests に積む', async () => {
    const { model, document } = await newModelWithDocument();

    const result = await ingestSpec(model.slug, spec(model.name));

    expect(result.created).toBe(1);
    expect(result.specDocumentId).toBe(document.id);

    const rows = await changesOf(document.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('new_grade');
    expect(rows[0].status).toBe('pending');
  });

  it('価格と装備は diff に含めない（諸元表に無いため）', async () => {
    const { model, document } = await newModelWithDocument();

    await ingestSpec(model.slug, spec(model.name));

    const [row] = await changesOf(document.id);
    const diff = row.diff as Record<string, unknown>;
    expect(diff).not.toHaveProperty('price');
    expect(Object.keys(diff).some((k) => k.startsWith('features.'))).toBe(false);
    expect(diff).toHaveProperty('typeDesignation');
  });

  it('二度取り込んでも change_requests が重複しない', async () => {
    const { model, document } = await newModelWithDocument();

    const first = await ingestSpec(model.slug, spec(model.name));
    const second = await ingestSpec(model.slug, spec(model.name));

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await changesOf(document.id)).toHaveLength(1);
  });

  it('extractions に手動の記録を残す', async () => {
    const { model, document } = await newModelWithDocument();

    await ingestSpec(model.slug, spec(model.name));

    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.specDocumentId, document.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].modelIdUsed).toBe('manual');
    expect(rows[0].succeeded).toBe(true);
    expect(rows[0].inputTokens).toBeNull();
  });

  it('壊れたJSONは取り込まず、何も書かない', async () => {
    const { model, document } = await newModelWithDocument();

    await expect(ingestSpec(model.slug, { modelName: 'x', grades: [] })).rejects.toThrow(
      /検証に失敗/,
    );

    expect(await changesOf(document.id)).toHaveLength(0);
    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.specDocumentId, document.id));
    expect(rows).toHaveLength(0);
  });

  it('車種名が食い違う JSON は取り込まない', async () => {
    const { model, document } = await newModelWithDocument();

    await expect(ingestSpec(model.slug, spec('別の車種'))).rejects.toThrow(
      /車種名が一致しません/,
    );

    expect(await changesOf(document.id)).toHaveLength(0);
    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.specDocumentId, document.id));
    expect(rows).toHaveLength(0);
  });

  it('spec_documents が無い車種は取り込めない', async () => {
    const token = rand();
    const [model] = await db
      .insert(models)
      .values({
        manufacturer: `テスト自動車${token}`,
        manufacturerSlug: `test-${token}`,
        name: `テスト車種${token}`,
        slug: `model-${token}`,
        bodyType: 'セダン',
      })
      .returning();
    createdModels.push(model.id);

    await expect(ingestSpec(model.slug, spec(model.name))).rejects.toThrow(/諸元表がまだ取得されていません/);
  });

  it('既存グレードと内容が同じなら変更を立てない', async () => {
    const { model, document } = await newModelWithDocument();
    await db.insert(grades).values({
      modelId: model.id,
      name: 'Z',
      slug: `z-${rand()}`,
      price: 3_200_000,
      engineType: 'ハイブリッド',
      driveSystem: 'FF',
      seating: 5,
      powertrain: '2.0L ハイブリッド車',
      typeDesignation: '6AA-TEST-A',
      weight: 1420,
      displacement: 1986,
      wltcMode: '28.4',
      transmission: '電気式無段変速機',
    });

    const result = await ingestSpec(model.slug, spec(model.name));

    expect(result.created).toBe(0);
    expect(await changesOf(document.id)).toHaveLength(0);
  });
});
