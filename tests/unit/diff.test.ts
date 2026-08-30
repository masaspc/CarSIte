import { describe, expect, it } from 'vitest';
import { computeChanges, diffHash, gradeKey, normalizeGrades } from '@/pipeline/diff';
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
  it('型式があってもキーには複合を使う', () => {
    // 型式は一意とは限らない（ホンダ・スズキ）。DBの複合一意制約
    // grades_model_powertrain_drive_name_key と同じ判別力に揃える
    expect(gradeKey(incoming())).toBe('Z/2.0L プラグインハイブリッド車/FF');
  });

  it('型式の有無でキーが変わらない', () => {
    expect(gradeKey(incoming())).toBe(gradeKey(incoming({ typeDesignation: null })));
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

/*
 * ホンダ フィットとスズキ アルトの実データから来た要件。
 * 型式が一意なのはトヨタだけで、ホンダは 6AA-GR3 ひとつで
 * e:HEV X/FF・e:HEV Z/FF・e:HEV RS/FF の3件を覆う。
 * docs/research/2026-08-24-manufacturer-pdf-survey.md を参照。
 */
describe('型式が複数グレードで共有される場合', () => {
  const shared = (name: string) => ({
    ...incoming(),
    name,
    powertrain: 'e:HEV',
    typeDesignation: '6AA-GR3',
  });

  it('型式が同じでも名前が違えば別のキーになる', () => {
    expect(gradeKey(shared('e:HEV X'))).not.toBe(gradeKey(shared('e:HEV Z')));
  });

  it('内容が同じなら変更を立てない（誤った discontinued を出さない）', () => {
    const rows = ['e:HEV X', 'e:HEV Z', 'e:HEV RS'].map(shared);
    const existingRows = rows.map((row, i) => ({ id: `id-${i}`, ...row }));

    const changes = computeChanges(existingRows, rows);

    expect(changes).toEqual([]);
  });

  it('1件だけ本当に消えたら、その1件だけが discontinued になる', () => {
    const rows = ['e:HEV X', 'e:HEV Z', 'e:HEV RS'].map(shared);
    const existingRows = rows.map((row, i) => ({ id: `id-${i}`, ...row }));

    const changes = computeChanges(existingRows, rows.slice(0, 2));

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('discontinued');
    expect(changes[0].targetKey).toBe(gradeKey(shared('e:HEV RS')));
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
    // targetKey は複合キー。型式は一意とは限らないので識別子にしない
    expect(changes[0].targetKey).toBe('Z/2.0L プラグインハイブリッド車/FF');
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

describe('computeChanges の比較オプション', () => {
  it('comparePrice: false なら価格差があっても price_change を立てない', () => {
    const changes = computeChanges(
      [existing({ price: 3_200_000 })],
      [incoming({ price: null })],
      { comparePrice: false },
    );

    expect(changes.filter((c) => c.kind === 'price_change')).toEqual([]);
  });

  it('comparePrice の既定は true（従来どおり）', () => {
    const changes = computeChanges([existing({ price: 3_200_000 })], [incoming({ price: null })]);

    expect(changes.filter((c) => c.kind === 'price_change')).toHaveLength(1);
  });

  it('compareFeatures: false なら装備差があっても spec_change を立てない', () => {
    const changes = computeChanges(
      [existing({ features: { navigation: 'standard' } })],
      [incoming({ features: {} })],
      { compareFeatures: false },
    );

    expect(changes).toEqual([]);
  });

  it('compareFeatures: false でも諸元の変更は拾う', () => {
    const changes = computeChanges(
      [existing({ weight: 1_620, features: { navigation: 'standard' } })],
      [incoming({ weight: 1_500, features: {} })],
      { compareFeatures: false },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].diff).toEqual({ weight: { before: 1_620, after: 1_500 } });
  });

  it('comparePrice: false でも new_grade には price を含める', () => {
    /*
     * 2026-08-30 に意味を分けた。comparePrice は「価格の変化を検知するか」だけを
     * 指す。new_grade の price は比較データではなく作成データであり、
     * grades.price は NOT NULL なので、これが無いとグレードを作れない。
     */
    const changes = computeChanges([], [incoming({ price: 4_645_300 })], {
      comparePrice: false,
      compareFeatures: false,
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_grade');
    expect(changes[0].diff.price).toEqual({ before: null, after: 4_645_300 });
    // 装備は外れたまま（色でしか読めず、取り込み元が持っていない）
    expect(Object.keys(changes[0].diff).some((k) => k.startsWith('features.'))).toBe(false);
    expect(changes[0].diff).toHaveProperty('name');
    expect(changes[0].diff).toHaveProperty('powertrain');
  });

  it('価格が無ければ new_grade の price は null のまま入る', () => {
    // U（KINTO専用仕様車）のように購入価格が存在しないグレードがある。
    // 値が無いことを diff に残し、適用時に blocked として人間に見せる
    const changes = computeChanges([], [incoming({ price: null })], {
      comparePrice: false,
      compareFeatures: false,
    });

    expect(changes[0].diff.price).toEqual({ before: null, after: null });
  });

  it('comparePrice: false は price_change を立てないことだけを意味する', () => {
    const changes = computeChanges(
      [existing({ price: 3_200_000 })],
      [incoming({ price: 4_000_000 })],
      { comparePrice: false },
    );

    expect(changes.filter((c) => c.kind === 'price_change')).toEqual([]);
  });
});

describe('normalizeGrades の features 省略', () => {
  it('features が無い抽出結果は空の装備として扱う', () => {
    const rows = normalizeGrades({
      modelName: 'プリウス',
      grades: [
        {
          name: 'Z',
          powertrain: '2.0L ハイブリッド車',
          driveSystemRaw: '2WD',
          typeDesignation: null,
          price: null,
          seating: 5,
          weight: 1420,
          displacement: 1986,
          wltcMode: 28.4,
          engineType: 'ハイブリッド',
          transmission: '電気式無段変速機',
        },
      ],
    } as never);

    expect(rows[0].features).toEqual({});
  });
});

describe('諸元の追加項目（寸法・出力・燃費内訳・エアバッグなど）', () => {
  const dimensions = { length: 4600, width: 1780, height: 1430 };

  it('取り込み元が持っていない項目は比較しない', () => {
    /*
     * 既に取り込んだ車種のJSONにはこれらの項目が無い。比較すると
     * 「値が消えた」と解釈され、毎回・全グレードに空振りの変更が立つ。
     * 装備で compareFeatures を条件付きにしたのと同じ理由である。
     */
    const found = existing({ dimensions, airbags: 7, cruisingRange: 900 });
    const changes = computeChanges([found], [incoming()]);
    expect(changes).toHaveLength(0);
  });

  it('取り込み元が値を持てば差分が立つ', () => {
    const found = existing({ dimensions: null, airbags: null });
    const changes = computeChanges([found], [incoming({ dimensions, airbags: 7 })]);

    expect(changes).toHaveLength(1);
    expect(changes[0].diff.dimensions).toEqual({ before: null, after: dimensions });
    expect(changes[0].diff.airbags).toEqual({ before: null, after: 7 });
  });

  it('jsonb はキーの順序が違っても同じとみなす', () => {
    // DBから返る jsonb はキーの順序が保存時と違う。素朴に JSON.stringify すると
    // 中身が同じでも毎回「変更あり」になる
    const found = existing({ dimensions: { height: 1430, length: 4600, width: 1780 } });
    expect(computeChanges([found], [incoming({ dimensions })])).toHaveLength(0);
  });

  it('jsonb は null の項目を省略と同じに扱う', () => {
    const found = existing({ dimensions: { ...dimensions, wheelbase: null } });
    expect(computeChanges([found], [incoming({ dimensions })])).toHaveLength(0);
  });

  it('jsonb の中身が違えば塊ごと差分になる', () => {
    // 項目ごとではなく列ごと入れ替える。適用側でマージすると
    // 「一部だけ古い値が残る」状態を作るため
    const found = existing({ dimensions });
    const changed = { ...dimensions, height: 1435 };
    const changes = computeChanges([found], [incoming({ dimensions: changed })]);

    expect(changes[0].diff.dimensions).toEqual({ before: dimensions, after: changed });
    expect(changes[0].diff['dimensions.height']).toBeUndefined();
  });

  it('新規グレードの diff にも追加項目が入る', () => {
    const changes = computeChanges(
      [],
      [incoming({ dimensions, airbags: 7, transmissionType: 'CVT', gearCount: null })],
    );

    expect(changes[0].kind).toBe('new_grade');
    expect(changes[0].diff.dimensions).toEqual({ before: null, after: dimensions });
    expect(changes[0].diff.transmissionType).toEqual({ before: null, after: 'CVT' });
    // 値を持たない項目は新規作成の diff にも入れない
    expect(changes[0].diff.performance).toBeUndefined();
  });

  it('新規グレードの diff に同じ項目を二度入れない', () => {
    // fields の配列に name などが二重に現れるため、重複を潰していないと
    // 同じキーを2回書くことになる
    const changes = computeChanges([], [incoming({ airbags: 7 })]);
    const keys = Object.keys(changes[0].diff);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('diffHash', () => {
  const base = { weight: { before: 1400, after: 1420 } };

  it('同じ内容なら同じハッシュ', () => {
    expect(diffHash(base)).toBe(diffHash({ weight: { before: 1400, after: 1420 } }));
  });

  it('キーの順序が違っても同じハッシュ', () => {
    // DBから返る jsonb はキーの順序が保存時と違う。順序で変わると
    // 同じ内容を積み直せてしまう
    const a = { weight: { before: 1, after: 2 }, seating: { before: 4, after: 5 } };
    const b = { seating: { before: 4, after: 5 }, weight: { before: 1, after: 2 } };
    expect(diffHash(a)).toBe(diffHash(b));
  });

  it('内容が違えば違うハッシュ', () => {
    /*
     * これが一意制約に入っているおかげで、同じグレードに対する別の内容の変更を
     * 積める。装備を取り込んだあとに寸法を足すのがこの形になる。
     */
    expect(diffHash(base)).not.toBe(diffHash({ weight: { before: 1400, after: 1430 } }));
    expect(diffHash(base)).not.toBe(diffHash({ ...base, airbags: { before: null, after: 7 } }));
  });

  it('値の型が違えば違うハッシュ', () => {
    // 数値の 1 と文字列の "1" を同じにすると、型の取り違えを積み直せなくなる
    expect(diffHash({ a: { before: null, after: 1 } })).not.toBe(
      diffHash({ a: { before: null, after: '1' } }),
    );
  });
});
