import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS } from '@/db/schema';
import { matchFeature } from '@/lib/feature-vocabulary';
import { normalizeGrades } from '@/pipeline/diff';
import { ExtractedSpecSchema } from '@/pipeline/extraction-schema';

/*
 * 日産 ノートの取り込み用JSONを守る。
 * 経緯は docs/research/2026-08-31-nissan-structure.md。
 */
const raw = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/note.spec.json'), 'utf8'),
) as { _featureProvenance?: { rowMapping?: Record<string, string> } };
const spec = ExtractedSpecSchema.parse(raw);

describe('ノートの取り込み用JSON', () => {
  it('X系4グレード（AUTECHと福祉車両は含めない）', () => {
    expect(spec.grades).toHaveLength(4);
    for (const g of spec.grades) {
      expect(g.name).not.toContain('AUTECH');
      expect(g.name).not.toContain('回転シート');
    }
  });

  it('グレード識別子が一意である', () => {
    const keys = normalizeGrades(spec).map((r) => `${r.name}/${r.powertrain}/${r.driveSystem}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('グレード名に駆動方式が入る（X と X FOUR）', () => {
    // ホンダの e:HEV X と同じ形。商品名は name に残し、駆動方式は別に持つ
    const four = spec.grades.filter((g) => g.name.includes('FOUR'));
    expect(four).toHaveLength(2);
    for (const g of four) expect(g.driveSystemRaw).toBe('4WD');
    for (const g of spec.grades.filter((g) => !g.name.includes('FOUR'))) {
      expect(g.driveSystemRaw).toBe('2WD');
    }
  });

  it('Black Edition は別グレードとして持つ', () => {
    /*
     * 独自の価格を持つ（X 2,399,100円 に対し X Black Edition 2,499,200円）。
     * スズキのパッケージ装着車（オプション扱い）とはここが違う。
     */
    const be = spec.grades.filter((g) => g.name.includes('Black Edition'));
    expect(be).toHaveLength(2);
    const priceOf = (name: string) => spec.grades.find((g) => g.name === name)!.price!;
    expect(priceOf('X Black Edition')).toBeGreaterThan(priceOf('X'));
    expect(priceOf('X FOUR Black Edition')).toBeGreaterThan(priceOf('X FOUR'));
  });

  it('Black Edition は素のグレードより装備が多い', () => {
    // 値段が高いのに標準装備が少なければ、列を取り違えている
    const count = (name: string) =>
      Object.values(spec.grades.find((g) => g.name === name)!.features!).filter(
        (v) => v === 'standard',
      ).length;
    expect(count('X Black Edition')).toBeGreaterThan(count('X'));
    expect(count('X FOUR Black Edition')).toBeGreaterThan(count('X FOUR'));
  });

  it('4WD は 2WD より重く、燃費が悪く、最低地上高が高い', () => {
    const x = spec.grades.find((g) => g.name === 'X')!;
    const four = spec.grades.find((g) => g.name === 'X FOUR')!;
    expect(four.weight!).toBeGreaterThan(x.weight!);
    expect(four.wltcMode!).toBeLessThan(x.wltcMode!);
    expect(four.dimensions!.groundClearance!).toBeGreaterThan(x.dimensions!.groundClearance!);
  });

  it('4WD はシートヒーターとステアリングヒーターが標準', () => {
    // 寒冷地向けの装備が4WDで標準になる。2WDはホットプラスパッケージのオプション
    for (const g of spec.grades) {
      const expected = g.driveSystemRaw === '4WD' ? 'standard' : 'option';
      expect(g.features?.seatHeater, g.name).toBe(expected);
      expect(g.features?.steeringHeater, g.name).toBe(expected);
    }
  });

  it('燃費の総合値が3モードの範囲に収まる', () => {
    for (const g of spec.grades) {
      const modes = [g.fuelDetail!.cityMode, g.fuelDetail!.suburbanMode, g.fuelDetail!.highwayMode]
        .filter((v): v is number => typeof v === 'number');
      expect(g.wltcMode!, g.name).toBeGreaterThanOrEqual(Math.min(...modes));
      expect(g.wltcMode!, g.name).toBeLessThanOrEqual(Math.max(...modes));
    }
  });

  it('e-POWER は変速機を持たない', () => {
    // 発電したモーターで直接駆動する。メーカーのグレード一覧も「-」と表示する
    for (const g of spec.grades) expect(g.transmission).toBeNull();
  });

  it('rowMapping が20項目あり、辞書と食い違わない', () => {
    const mapping = raw._featureProvenance?.rowMapping ?? {};
    expect(Object.keys(mapping).sort()).toEqual([...FEATURE_COLUMNS].sort());

    // 日産の表記はまだ辞書に入れていないので、当たらなくても落とさない。
    // 記載なしと書いた列だけ、実際に全グレード none であることを確かめる
    for (const column of FEATURE_COLUMNS) {
      if (!mapping[column].startsWith('記載なし')) continue;
      for (const g of spec.grades) {
        expect(g.features?.[column], `${g.name} の ${column}`).toBe('none');
      }
    }
    // 辞書に入れた表記があれば整合すること（将来 others.日産 を足したときの網）
    expect(matchFeature('LDW（車線逸脱警報）')).toBeDefined();
  });
});
