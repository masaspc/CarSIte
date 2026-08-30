import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS } from '@/db/schema';
import { ExtractedSpecSchema, type ExtractedGrade } from '@/pipeline/extraction-schema';
import { compareOptionsFor } from '@/scripts/ingest-spec';

const allFeatures = () =>
  Object.fromEntries(FEATURE_COLUMNS.map((column) => [column, 'standard' as const])) as NonNullable<
    ExtractedGrade['features']
  >;

const grade = (name: string, features?: ExtractedGrade['features']): ExtractedGrade => ({
  name,
  powertrain: '2.0L ハイブリッド車',
  driveSystemRaw: '2WD',
  typeDesignation: `TEST-${name}`,
  price: 3_000_000,
  seating: 5,
  weight: 1400,
  displacement: 1986,
  wltcMode: 28.4,
  engineType: 'ハイブリッド',
  transmission: '電気式無段変速機',
  ...(features ? { features } : {}),
});

describe('compareOptionsFor', () => {
  it('全グレードが装備を持つときだけ装備を比較する', () => {
    expect(
      compareOptionsFor({ modelName: 'X', grades: [grade('Z', allFeatures()), grade('G', allFeatures())] })
        .compareFeatures,
    ).toBe(true);
  });

  it('1件でも装備が欠けていれば比較しない', () => {
    /*
     * ここを true にすると壊れる。normalizeGrades が features を `{}` に倒すため、
     * 装備を持たないグレードには before='unknown' / after=null の空振り差分が
     * 20項目ぶん立ち、apply.ts が null を INVALID と見て blocked にする。
     * 「まだ読み取っていない」が「装備を消す変更」になってしまう。
     */
    expect(
      compareOptionsFor({ modelName: 'X', grades: [grade('Z', allFeatures()), grade('G')] })
        .compareFeatures,
    ).toBe(false);
  });

  it('どのグレードも装備を持たなければ比較しない（装備取り込み前の従来の挙動）', () => {
    expect(
      compareOptionsFor({ modelName: 'X', grades: [grade('Z'), grade('G')] }).compareFeatures,
    ).toBe(false);
  });

  it('価格は装備の有無にかかわらず比較しない', () => {
    // 諸元表に車両本体価格が載っていないため（設計書6.0.3）
    for (const features of [allFeatures(), undefined]) {
      expect(compareOptionsFor({ modelName: 'X', grades: [grade('Z', features)] }).comparePrice).toBe(
        false,
      );
    }
  });
});

describe('プリウスの取り込み用JSON', () => {
  const spec = ExtractedSpecSchema.parse(
    JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/prius.spec.json'), 'utf8')),
  );

  it('装備の比較が有効になる', () => {
    expect(compareOptionsFor(spec).compareFeatures).toBe(true);
  });

  it('8グレードすべてが20項目を持ち、unknown を1つも残していない', () => {
    expect(spec.grades).toHaveLength(8);
    for (const row of spec.grades) {
      expect(Object.keys(row.features ?? {})).toHaveLength(FEATURE_COLUMNS.length);
      expect(Object.values(row.features ?? {})).not.toContain('unknown');
    }
  });

  it('装備の数がグレードの序列と矛盾しない', () => {
    /*
     * 20項目×8グレードを目視で読み取っているため、取り違えを完全には防げない。
     * 上位グレードが下位グレードより標準装備が少ないという結果は読み違いの
     * 兆候になる（実際、最初の機械判定では駐車支援がZとGで逆に出ていた）。
     */
    const standardCount = (name: string, powertrain: string) => {
      const row = spec.grades.find((g) => g.name === name && g.powertrain.startsWith(powertrain));
      if (!row?.features) throw new Error(`${powertrain} の ${name} が見つかりません`);
      return Object.values(row.features).filter((v) => v === 'standard').length;
    };

    expect(standardCount('Z', '2.0L プラグイン')).toBeGreaterThan(standardCount('G', '2.0L プラグイン'));
    expect(standardCount('Z', '2.0L ハイブリッド')).toBeGreaterThan(
      standardCount('G', '2.0L ハイブリッド'),
    );
    expect(standardCount('G', '2.0L ハイブリッド')).toBeGreaterThan(
      standardCount('U', '1.8L ハイブリッド'),
    );
  });

  it('駆動方式違いの同一グレードは同じ装備を持つ', () => {
    // 装備一覧表のHEV列は「2WD/E-Four」が1列に統合されている（_featureProvenance 参照）
    for (const name of ['Z', 'G', 'U']) {
      const pair = spec.grades.filter(
        (g) => g.name === name && g.powertrain.includes('ハイブリッド車') && !g.powertrain.includes('プラグイン'),
      );
      expect(pair).toHaveLength(2);
      expect(pair[0].features).toEqual(pair[1].features);
    }
  });

  it('読み取りの根拠が記録されている', () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(__dirname, '../fixtures/prius.spec.json'), 'utf8'),
    ) as { _featureProvenance?: { rowMapping?: Record<string, string> } };

    // 何を根拠にどの値を入れたかを追えなければ、誤りを見つけても直しようがない
    expect(Object.keys(raw._featureProvenance?.rowMapping ?? {}).sort()).toEqual(
      [...FEATURE_COLUMNS].sort(),
    );
  });
});
