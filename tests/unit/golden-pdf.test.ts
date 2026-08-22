import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPdfAcceptable } from '@/lib/pdf-guard';
import { countPdfPages } from '@/pipeline/pdf';

const PDF_PATH = path.resolve(__dirname, '../fixtures/prius_spec_202607.pdf');
const bytes = new Uint8Array(readFileSync(PDF_PATH));

describe('ゴールデンPDF', () => {
  it('PDFとして読める', async () => {
    await expect(countPdfPages(bytes)).resolves.toBeGreaterThan(0);
  });

  it('事前検査を通る（本物の諸元表が弾かれないことの確認）', async () => {
    const pageCount = await countPdfPages(bytes);
    expect(() =>
      assertPdfAcceptable({ contentType: 'application/pdf', bytes, pageCount }),
    ).not.toThrow();
  });

  it('sha256 が安定している（変更検知の土台）', () => {
    const first = createHash('sha256').update(bytes).digest('hex');
    const second = createHash('sha256').update(bytes).digest('hex');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

// この環境に ANTHROPIC_API_KEY は無い。キーがあるときだけ走らせる。
// モックでは表構造の解釈という肝心な部分を検証できないため、実APIで確かめる。
describe.runIf(hasApiKey)('ゴールデンPDFの抽出', () => {
  it('同名グレードが別のレコードとして出る', async () => {
    const { createAnthropicClient, extractSpec } = await import('@/pipeline/extract');
    const { normalizeGrades } = await import('@/pipeline/diff');
    const { gradeKey } = await import('@/pipeline/diff');

    const result = await extractSpec(bytes, createAnthropicClient(process.env.ANTHROPIC_API_KEY!));
    expect(result.succeeded).toBe(true);
    if (!result.succeeded) return;

    const rows = normalizeGrades(result.spec);

    // 「Z」は 2.0L PHEV と 2.0L HV に1つずつある。統合されていないこと
    const zRows = rows.filter((row) => row.name === 'Z');
    expect(zRows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(zRows.map((row) => row.powertrain)).size).toBeGreaterThanOrEqual(2);

    // キーが全て異なる = 一意制約に衝突しない
    const keys = rows.map(gradeKey);
    expect(new Set(keys).size).toBe(keys.length);

    // 括弧記法が分解されている = 2WD と E-Four で重量が違う行がある
    const hybridRows = rows.filter((row) => row.powertrain.includes('2.0L ハイブリッド'));
    const weights = new Set(hybridRows.map((row) => row.weight));
    expect(weights.size).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
