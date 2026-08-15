import { describe, expect, it } from 'vitest';
import { computeChanges, gradeKey, normalizeGrades } from '@/pipeline/diff';
import { FEATURE_COLUMNS } from '@/db/schema';

const ALL_FEATURES = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, 'unknown' as const]),
) as Record<(typeof FEATURE_COLUMNS)[number], 'unknown'>;

function incoming(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Z',
    powertrain: '2.0L プラグインハイブリッド車',
    driveSystem: 'FF' as const,
    typeDesignation: '6LA-MXWH61-AHXHB',
    price: 4_600_000,
    seating: 5,
    weight: 1620,
    displacement: 1987,
    wltcMode: 26.0,
    engineType: 'PHEV' as const,
    transmission: '電気式無段変速機',
    features: ALL_FEATURES,
    ...overrides,
  };
}

function existing(overrides: Record<string, unknown> = {}) {
  return { id: 'uuid-1', ...incoming(), ...overrides };
}

describe('gradeKey', () => {
  it('型式があればそれを使う', () => {
    expect(gradeKey(incoming())).toBe('6LA-MXWH61-AHXHB');
  });

  it('型式が無ければ 名前/パワートレイン/駆動方式 の複合', () => {
    expect(gradeKey(incoming({ typeDesignation: null }))).toBe(
      'Z/2.0L プラグインハイブリッド車/FF',
    );
  });

  it('同名でもパワートレインが違えば別のキーになる', () => {
    const phev = gradeKey(incoming({ typeDesignation: null }));
    const hybrid = gradeKey(
      incoming({ typeDesignation: null, powertrain: '2.0L ハイブリッド車' }),
    );
    expect(phev).not.toBe(hybrid);
  });

  it('同名・同パワートレインでも駆動方式が違えば別のキーになる', () => {
    const ff = gradeKey(incoming({ typeDesignation: null }));
    const awd = gradeKey(incoming({ typeDesignation: null, driveSystem: '4WD' }));
    expect(ff).not.toBe(awd);
  });
});

describe('normalizeGrades', () => {
  it('駆動方式を諸元表の表記からDBの列挙に写す', () => {
    const rows = normalizeGrades({
      modelName: 'プリウス',
      grades: [
        { ...incoming(), driveSystemRaw: '2WD' },
        { ...incoming(), driveSystemRaw: 'E-Four' },
      ],
    } as never);

    expect(rows.map((r) => r.driveSystem)).toEqual(['FF', '4WD']);
  });

  it('未知の表記は例外にする（黙って倒さない）', () => {
    expect(() =>
      normalizeGrades({
        modelName: 'プリウス',
        grades: [{ ...incoming(), driveSystemRaw: '6WD' }],
      } as never),
    ).toThrow(/6WD/);
  });
});

describe('computeChanges', () => {
  it('DBに無いグレードは new_grade', () => {
    const changes = computeChanges([], [incoming()]);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_grade');
    expect(changes[0].targetKey).toBe('6LA-MXWH61-AHXHB');
  });

  it('new_grade の diff は before が null で after が値（逆適用できる形）', () => {
    const changes = computeChanges([], [incoming()]);
    expect(changes[0].diff.price).toEqual({ before: null, after: 4_600_000 });
    expect(changes[0].diff.name).toEqual({ before: null, after: 'Z' });
  });

  it('価格だけが違えば price_change', () => {
    const changes = computeChanges([existing()], [incoming({ price: 4_700_000 })]);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('price_change');
    expect(changes[0].diff).toEqual({ price: { before: 4_600_000, after: 4_700_000 } });
  });

  it('諸元が違えば spec_change', () => {
    const changes = computeChanges([existing()], [incoming({ weight: 1650 })]);
    expect(changes.map((c) => c.kind)).toEqual(['spec_change']);
    expect(changes[0].diff).toEqual({ weight: { before: 1620, after: 1650 } });
  });

  it('装備が変われば spec_change', () => {
    const changes = computeChanges(
      [existing()],
      [incoming({ features: { ...ALL_FEATURES, sunroof: 'standard' } })],
    );
    expect(changes.map((c) => c.kind)).toEqual(['spec_change']);
    expect(changes[0].diff['features.sunroof']).toEqual({
      before: 'unknown',
      after: 'standard',
    });
  });

  it('価格と諸元の両方が違えば2件に分かれる', () => {
    const changes = computeChanges([existing()], [incoming({ price: 4_700_000, weight: 1650 })]);
    expect(changes.map((c) => c.kind).sort()).toEqual(['price_change', 'spec_change']);
  });

  it('何も変わっていなければ0件', () => {
    expect(computeChanges([existing()], [incoming()])).toEqual([]);
  });

  it('抽出結果に無いグレードは discontinued', () => {
    const changes = computeChanges([existing()], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('discontinued');
    expect(changes[0].diff.discontinued).toEqual({ before: false, after: true });
  });

  it('既に廃止済みの行は二度 discontinued にしない', () => {
    const changes = computeChanges([existing({ discontinuedAt: '2026-01' })], []);
    expect(changes).toEqual([]);
  });

  it('同名の別パワートレインを取り違えない', () => {
    const phev = existing({ id: 'a', typeDesignation: null });
    const hybrid = existing({
      id: 'b',
      typeDesignation: null,
      powertrain: '2.0L ハイブリッド車',
      price: 3_500_000,
    });

    const changes = computeChanges(
      [phev, hybrid],
      [
        incoming({ typeDesignation: null }),
        incoming({
          typeDesignation: null,
          powertrain: '2.0L ハイブリッド車',
          price: 3_600_000,
        }),
      ],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('price_change');
    expect(changes[0].targetKey).toBe('Z/2.0L ハイブリッド車/FF');
  });

  it('null から値が入った場合も spec_change になる', () => {
    const changes = computeChanges([existing({ weight: null })], [incoming({ weight: 1620 })]);
    expect(changes[0].kind).toBe('spec_change');
    expect(changes[0].diff).toEqual({ weight: { before: null, after: 1620 } });
  });

  it('値が消えた場合（値 -> null）も spec_change になる', () => {
    const changes = computeChanges([existing()], [incoming({ weight: null })]);
    expect(changes[0].kind).toBe('spec_change');
    expect(changes[0].diff).toEqual({ weight: { before: 1620, after: null } });
  });

  it('diff には変わった項目だけが入る', () => {
    const changes = computeChanges([existing()], [incoming({ weight: 1650, seating: 4 })]);
    expect(Object.keys(changes[0].diff).sort()).toEqual(['seating', 'weight']);
  });

  it('wltcMode の 26 と 26.0 を変更とみなさない（数値の表記ゆれ）', () => {
    const changes = computeChanges([existing({ wltcMode: 26 })], [incoming({ wltcMode: 26.0 })]);
    expect(changes).toEqual([]);
  });

  it('DBから来る numeric 型の文字列 "26.0" も同値として扱う', () => {
    // drizzle の numeric 列は文字列で返る。文字列と数値を素朴に比べると
    // 毎回 spec_change が立ち、承認キューが空振りで埋まる
    const changes = computeChanges([existing({ wltcMode: '26.0' })], [incoming({ wltcMode: 26 })]);
    expect(changes).toEqual([]);
  });
});
