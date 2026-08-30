import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS } from '@/db/schema';
import {
  buildComparison,
  countDifferent,
  visibleSections,
} from '@/lib/comparison-diff';
import type { ComparisonRow } from '@/db/queries';

const ALL_UNKNOWN = Object.fromEntries(
  FEATURE_COLUMNS.map((c) => [c, 'unknown' as const]),
);

/** 比較に要る最小限の形だけ作る。DBには触らない */
function row(overrides: Record<string, unknown> = {}): ComparisonRow {
  const { bodyType, ...gradeOverrides } = overrides;
  return {
    grade: {
      id: `id-${Math.random()}`,
      name: 'Z',
      slug: 'z-20hv-ff',
      price: 3_998_500,
      seating: 5,
      weight: 1420,
      displacement: 1986,
      wltcMode: '28.4',
      engineType: 'ハイブリッド',
      driveSystem: 'FF',
      transmission: '電気式無段変速機',
      powertrain: '2.0L ハイブリッド車',
      typeDesignation: '6AA-MXWH60-AHXHB',
      releaseDate: null,
      cruisingRange: null,
      ecoCarTax: false,
      airbags: null,
      dimensions: null,
      performance: null,
      fuelDetail: null,
      images: null,
      ...ALL_UNKNOWN,
      ...gradeOverrides,
    },
    manufacturer: 'トヨタ',
    manufacturerSlug: 'toyota',
    modelName: 'プリウス',
    modelSlug: 'prius',
    bodyType: (bodyType as string) ?? 'ハッチバック',
  } as unknown as ComparisonRow;
}

describe('buildComparison — 三値判定', () => {
  it('全て同じ値なら same', () => {
    const sections = buildComparison([row(), row()]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('same');
  });

  it('値が違えば different', () => {
    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('different');
  });

  it('numeric 文字列と数値の差は same（sameValue の規則）', () => {
    const sections = buildComparison([row({ wltcMode: '28.4' }), row({ wltcMode: 28.4 })]);
    const wltc = sections.flatMap((s) => s.rows).find((r) => r.label?.startsWith('WLTC'));
    expect(wltc?.state).toBe('same');
  });

  it('装備が両方 unknown なら same', () => {
    const sections = buildComparison([row(), row()]);
    const nav = sections.flatMap((s) => s.rows).find((r) => r.label === 'カーナビ');
    expect(nav?.state).toBe('same');
  });

  it('装備が standard と unknown なら unknown（different にしない）', () => {
    // 「装備が違う」ではなく「片方が不明」である。誤情報を出さない
    const sections = buildComparison([row({ navigation: 'standard' }), row()]);
    const nav = sections.flatMap((s) => s.rows).find((r) => r.label === 'カーナビ');
    expect(nav?.state).toBe('unknown');
  });

  it('装備が standard と none なら different', () => {
    const sections = buildComparison([
      row({ navigation: 'standard' }),
      row({ navigation: 'none' }),
    ]);
    const nav = sections.flatMap((s) => s.rows).find((r) => r.label === 'カーナビ');
    expect(nav?.state).toBe('different');
  });
});

describe('buildComparison — 3台のとき', () => {
  it('A=A≠B は different', () => {
    const sections = buildComparison([row(), row(), row({ price: 1 })]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('different');
  });

  it('A≠B=A も different', () => {
    const sections = buildComparison([row(), row({ price: 1 }), row()]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('different');
  });

  it('全て異なれば different', () => {
    const sections = buildComparison([row(), row({ price: 1 }), row({ price: 2 })]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('different');
  });

  it('1台でも unknown が混じれば unknown', () => {
    const sections = buildComparison([
      row({ navigation: 'standard' }),
      row({ navigation: 'none' }),
      row(),
    ]);
    const nav = sections.flatMap((s) => s.rows).find((r) => r.label === 'カーナビ');
    expect(nav?.state).toBe('unknown');
  });
});

describe('buildComparison — 生値で比較する', () => {
  it('表示は整形されるが、判定は生値で行う', () => {
    const sections = buildComparison([row(), row()]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');

    expect(price?.cells[0].raw).toBe(3_998_500);
    expect(price?.cells[0].text).toBe('¥3,998,500');
  });

  it('整形後の文字列で比較していない', () => {
    // "¥3,998,500" は数値に落ちないので、表示値で比較すると
    // sameValue の numeric 吸収が効かなくなる
    const sections = buildComparison([row({ price: 100 }), row({ price: 100 })]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('same');
  });
});

describe('countDifferent', () => {
  it('different と unknown と全体を数える', () => {
    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const counts = countDifferent(sections);

    expect(counts.total).toBe(40);
    expect(counts.different).toBe(1);
    expect(counts.unknown).toBe(0);
  });

  it('unknown を different に混ぜない', () => {
    const sections = buildComparison([row({ navigation: 'standard' }), row()]);
    const counts = countDifferent(sections);

    expect(counts.different).toBe(0);
    expect(counts.unknown).toBe(1);
  });
});

describe('visibleSections', () => {
  it('showAll: false は different だけを残す', () => {
    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const visible = visibleSections(sections, false);
    const labels = visible.flatMap((s) => s.rows).map((r) => r.label);

    expect(labels).toEqual(['価格']);
  });

  it('差分0件のセクションは見出しごと消える', () => {
    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const visible = visibleSections(sections, false);

    expect(visible).toHaveLength(1);
    expect(visible[0].label).toBe('基本情報');
  });

  it('showAll: true は全て残る', () => {
    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const visible = visibleSections(sections, true);

    expect(visible.flatMap((s) => s.rows)).toHaveLength(40);
    expect(visible).toHaveLength(6);
  });

  it('1台のときは showAll: false でも全て残す', () => {
    // 1台では全行が same になる。畳むと表が空になり故障に見える（設計書5章）
    const visible = visibleSections(buildComparison([row()]), false);

    expect(visible.flatMap((s) => s.rows)).toHaveLength(40);
  });

  it('0台のときは空', () => {
    expect(visibleSections(buildComparison([]), false)).toEqual([]);
  });
});
