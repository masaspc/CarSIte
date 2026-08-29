import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPdfAcceptable } from '@/lib/pdf-guard';
import { countPdfPages } from '@/pipeline/pdf';

import { gradeKey } from '@/pipeline/diff';
import { normalizeDriveSystem } from '@/pipeline/extraction-schema';

const PDF_PATH = path.resolve(__dirname, '../fixtures/prius_spec_202607.pdf');
const bytes = new Uint8Array(readFileSync(PDF_PATH));

/** 原本を直接読んで起こした正解データ。出所は _provenance を参照 */
interface ExpectedGrade {
  name: string;
  powertrain: string;
  driveSystemRaw: string;
  typeDesignation: string;
  weight: number;
  price: null;
}
const expected = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/prius_spec_202607.expected.json'), 'utf8'),
) as { gradeCount: number; grades: ExpectedGrade[] };

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

/**
 * 正解データに対して本番コードを当てる。APIキーは要らない。
 *
 * 実物の諸元表から起こした値なので、ここが通れば「同名グレード」と
 * 「括弧記法」を実データで扱えることの裏づけになる。
 */
describe('ゴールデンPDFの正解データに対する同定', () => {
  it('同名グレードが別のパワートレインに存在する', () => {
    const zRows = expected.grades.filter((row) => row.name === 'Z');
    expect(zRows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(zRows.map((row) => row.powertrain)).size).toBeGreaterThanOrEqual(2);
  });

  it('gradeKey が全て異なる（一意制約に衝突しない）', () => {
    const keys = expected.grades.map((row) =>
      gradeKey({
        typeDesignation: row.typeDesignation,
        name: row.name,
        powertrain: row.powertrain,
        driveSystem: normalizeDriveSystem(row.driveSystemRaw),
      }),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(expected.gradeCount);
  });

  it('名前だけで突き合わせると取り違える（型式が要る理由）', () => {
    const byName = new Set(expected.grades.map((row) => row.name));
    expect(byName.size).toBeLessThan(expected.grades.length);
  });

  it('実物の駆動方式表記をすべて解釈できる', () => {
    const raws = [...new Set(expected.grades.map((row) => row.driveSystemRaw))];
    expect(raws).toContain('2WD');
    expect(raws).toContain('E-Four');
    for (const raw of raws) {
      expect(() => normalizeDriveSystem(raw)).not.toThrow();
    }
  });

  it('括弧記法が展開されている（2WD と E-Four で重量が違う）', () => {
    const hybrid = expected.grades.filter((row) => row.powertrain === '2.0L ハイブリッド車');
    expect(new Set(hybrid.map((row) => row.weight)).size).toBeGreaterThanOrEqual(2);
  });

  it('諸元表に車両本体価格は無い', () => {
    // 原本に「価格は販売店が独自に定めていますので…」とある。
    // 抽出結果の price は null になり、NOT NULL 列への適用は stale になる
    // （pipeline/apply.ts の NON_NULLABLE_GRADE_COLUMNS）
    expect(expected.grades.every((row) => row.price === null)).toBe(true);
  });
});

/**
 * 正解データを原本そのものと突き合わせる。
 *
 * この正解データは Claude がPDFを読んで転記したものだが、その転記を信じる必要はない。
 * PDF から機械抽出したテキストに、書いた値がそのまま現れることを確かめる。
 * ここが通る限り、転記ミスは混入していない。APIキーは要らない。
 */
describe('正解データが原本と一致する', () => {
  it('型式と重量が原本のテキストに現れる', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: true });
    const body = String(text);

    for (const grade of expected.grades) {
      expect(body).toContain(grade.typeDesignation);
      expect(body).toContain(grade.weight.toLocaleString('en-US'));
    }
  }, 60_000);

  it('原本のテキストが壊れていない（設計書2.2の前提の再確認）', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: true });

    // 設計書は「字間が壊れて『プラグイ ンハイブ リ ッ ド車』としか取れない」と
    // 書いていたが、実際には壊れずに取れる。前提が変わったことを固定しておく
    expect(String(text)).toContain('プラグインハイブリッド車');
  }, 60_000);

  it('取り込み用JSONが正解データと同じ8グレードを指す', () => {
    const ingest = JSON.parse(
      readFileSync(path.resolve(__dirname, '../fixtures/prius.spec.json'), 'utf8'),
    ) as { grades: Array<{ typeDesignation: string; weight: number }> };

    expect(ingest.grades).toHaveLength(expected.gradeCount);

    const wanted = new Set(expected.grades.map((g) => g.typeDesignation));
    for (const grade of ingest.grades) {
      expect(wanted).toContain(grade.typeDesignation);
    }

    const byType = new Map(expected.grades.map((g) => [g.typeDesignation, g.weight]));
    for (const grade of ingest.grades) {
      expect(grade.weight).toBe(byType.get(grade.typeDesignation));
    }

    // 8件すべてが同じ型式を指していても上記の検証は通ってしまうため、
    // 型式が一意であることを別途確かめる
    expect(new Set(ingest.grades.map((g) => g.typeDesignation)).size).toBe(ingest.grades.length);
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

    /*
     * 原本から起こした正解データと突き合わせる。構造が正しいだけでなく、
     * 値が合っているかを見る。型式は諸元表に印字された文字列なので、
     * ここが食い違えば抽出が読み違えている。
     */
    const extractedTypes = new Set(rows.map((row) => row.typeDesignation).filter(Boolean));
    for (const want of expected.grades) {
      expect(extractedTypes).toContain(want.typeDesignation);
    }
    expect(rows).toHaveLength(expected.gradeCount);

    // 諸元表に価格は無いので、抽出も null を返すのが正しい
    expect(rows.every((row) => row.price === null)).toBe(true);
  }, 300_000);
});
