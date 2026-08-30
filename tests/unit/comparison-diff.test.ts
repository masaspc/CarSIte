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

  it('airbags: 0 は不明ではなく既知の値として扱う（意図的な仕様。旧実装のtruthy判定には戻さない）', () => {
    // 書き換え前の ComparisonTable は `grade.airbags ? ... : undefined` という
    // truthy 判定だったため、airbags: 0（0個という既知の事実）を「不明」に
    // 潰していた。新実装は isUnknown で null/undefined/''/'unknown' だけを
    // 不明として扱うため、0 は '0個' という値として表示・比較される。
    const sections = buildComparison([row({ airbags: 0 }), row({ airbags: 6 })]);
    const airbags = sections.flatMap((s) => s.rows).find((r) => r.label === 'エアバッグ');
    expect(airbags?.state).toBe('different');
    expect(airbags?.cells[0].text).toBe('0個');
    expect(airbags?.cells[1].text).toBe('6個');
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
    // ecoCarTax は真偽値 true と文字列 'true' のどちらも「対象」に整形されるため
    // 表示文字列は一致する。しかし生値としては型が異なり sameValue は different と
    // 判定する。表示文字列の比較ではこの違いを検出できないため、これは
    // judge() が整形後の文字列ではなく生値を見ていることの実証になる。
    const sections = buildComparison([row({ ecoCarTax: true }), row({ ecoCarTax: 'true' })]);
    const ecoTax = sections.flatMap((s) => s.rows).find((r) => r.label === 'エコカー減税');
    expect(ecoTax?.cells[0].text).toBe(ecoTax?.cells[1].text);
    expect(ecoTax?.state).toBe('different');
  });
});

describe('buildComparison — セクションと行ラベルの並び', () => {
  it('書き換え前の ComparisonTable と一字一句同じセクション・行ラベル・順序を保つ', () => {
    // リテラルで固定する。buildComparison から生成すると何も守らないテストになる。
    const expected = [
      { label: '基本情報', rows: ['価格', 'ボディタイプ', '発売年月', '乗車定員'] },
      { label: 'サイズ', rows: ['全長 (mm)', '全幅 (mm)', '全高 (mm)', '車両重量 (kg)'] },
      {
        label: 'エンジン・性能',
        rows: ['エンジンタイプ', '総排気量 (cc)', '最高出力', '最大トルク', 'トランスミッション', '駆動方式'],
      },
      {
        label: '燃費性能',
        rows: [
          'WLTCモード (km/L)',
          '市街地モード (km/L)',
          '高速道路モード (km/L)',
          '航続可能距離 (km)',
          'エコカー減税',
          'エアバッグ',
        ],
      },
      {
        label: '安全装備',
        rows: [
          '衝突被害軽減ブレーキ',
          '誤発進抑制機能',
          '車線逸脱警報',
          '車線維持支援',
          'ACC',
          'ブラインドスポットモニター',
          '360度カメラ',
          '駐車支援システム',
        ],
      },
      {
        label: '快適装備',
        rows: [
          'カーナビ',
          'ETC',
          'バックカメラ',
          'パワーシート',
          'シートヒーター',
          'ステアリングヒーター',
          'オートエアコン',
          'LEDヘッドライト',
          'スマートキー',
          'パワーバックドア',
          'ハンズフリーバックドア',
          'サンルーフ',
        ],
      },
    ];

    const sections = buildComparison([row(), row({ price: 4_251_500 })]);
    const actual = sections.map((s) => ({ label: s.label, rows: s.rows.map((r) => r.label) }));

    expect(actual).toEqual(expected);
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
