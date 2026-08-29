import { describe, expect, it } from 'vitest';
import {
  ExtractedSpecSchema,
  UnknownEnumValueError,
  extractionJsonSchema,
  normalizeDriveSystem,
} from '@/pipeline/extraction-schema';
import { FEATURE_COLUMNS } from '@/db/schema';

// Structured Outputs は additionalProperties に false 以外を許さないため、
// features は20項目すべてを列挙した固定オブジェクトになっている
const ALL_FEATURES = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, 'unknown' as const]),
);

const GOLDEN = {
  modelName: 'プリウス',
  grades: [
    {
      name: 'Z',
      powertrain: '2.0L プラグインハイブリッド車',
      driveSystemRaw: '2WD',
      typeDesignation: '6LA-MXWH61-AHXHB',
      price: 4_600_000,
      seating: 5,
      weight: 1620,
      displacement: 1987,
      wltcMode: 26.0,
      engineType: 'PHEV',
      transmission: '電気式無段変速機',
      features: ALL_FEATURES,
    },
  ],
};

describe('ExtractedSpecSchema', () => {
  it('諸元表から取れる形をそのまま受け付ける', () => {
    expect(() => ExtractedSpecSchema.parse(GOLDEN)).not.toThrow();
  });

  it('グレードが0件なら拒否（抽出失敗を成功として通さない）', () => {
    expect(() => ExtractedSpecSchema.parse({ ...GOLDEN, grades: [] })).toThrow();
  });

  it('価格や重量が取れない場合は null を許す', () => {
    const partial = {
      ...GOLDEN,
      grades: [{ ...GOLDEN.grades[0], price: null, weight: null, typeDesignation: null }],
    };
    expect(() => ExtractedSpecSchema.parse(partial)).not.toThrow();
  });

  it('engine_type に列挙外の値が来たら拒否', () => {
    const bad = { ...GOLDEN, grades: [{ ...GOLDEN.grades[0], engineType: '水素' }] };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('装備の値は4値のいずれかでなければ拒否', () => {
    const bad = {
      ...GOLDEN,
      grades: [{ ...GOLDEN.grades[0], features: { ...ALL_FEATURES, sunroof: 'yes' } }],
    };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('装備が1項目でも欠けたら拒否（省略ではなく unknown を明示させる）', () => {
    const { sunroof: _omitted, ...missing } = ALL_FEATURES;
    const bad = { ...GOLDEN, grades: [{ ...GOLDEN.grades[0], features: missing }] };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('powertrain が空文字なら拒否（一意制約の識別子になるため）', () => {
    const bad = { ...GOLDEN, grades: [{ ...GOLDEN.grades[0], powertrain: '' }] };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('driveSystemRaw が空文字なら拒否', () => {
    const bad = { ...GOLDEN, grades: [{ ...GOLDEN.grades[0], driveSystemRaw: '' }] };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('同名グレードが複数あっても受け付ける（統合させない）', () => {
    const twoZ = {
      ...GOLDEN,
      grades: [
        GOLDEN.grades[0],
        { ...GOLDEN.grades[0], powertrain: '2.0L ハイブリッド車', typeDesignation: '6AA-MXWH60' },
      ],
    };
    const parsed = ExtractedSpecSchema.parse(twoZ);
    expect(parsed.grades).toHaveLength(2);
    expect(parsed.grades.map((g) => g.name)).toEqual(['Z', 'Z']);
  });
});

describe('extractionJsonSchema', () => {
  it('JSON Schema に変換できる', () => {
    const schema = extractionJsonSchema() as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).toContain('grades');
  });

  it('列挙値が JSON Schema に落ちている（APIに強制させる形と検証が同じ出所）', () => {
    const serialized = JSON.stringify(extractionJsonSchema());
    expect(serialized).toContain('PHEV');
    expect(serialized).toContain('standard');
  });

  it('Structured Outputs が受け付けない検証キーワードを含まない', () => {
    // これらを送ると 400 になる。Zod は出力するので、渡す前に落としている
    const serialized = JSON.stringify(extractionJsonSchema());
    for (const keyword of [
      '$schema', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
      'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    ]) {
      expect(serialized).not.toContain(`"${keyword}"`);
    }
  });

  it('すべてのオブジェクトに additionalProperties: false が付く', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.type === 'object' && record.additionalProperties !== false) {
        offenders.push(path);
      }
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };
    walk(extractionJsonSchema(), '$');

    expect(offenders).toEqual([]);
  });

  it('装備は20項目すべてが required に入る', () => {
    const schema = extractionJsonSchema() as any;
    const features = schema.properties.grades.items.properties.features;
    expect(features.required).toHaveLength(FEATURE_COLUMNS.length);
    expect(features.required).toContain('sunroof');
  });
});

describe('normalizeDriveSystem', () => {
  it('諸元表の表記をDBの列挙に写す', () => {
    expect(normalizeDriveSystem('2WD')).toBe('FF');
    expect(normalizeDriveSystem('E-Four')).toBe('4WD');
    expect(normalizeDriveSystem('4WD')).toBe('4WD');
    expect(normalizeDriveSystem('AWD')).toBe('4WD');
  });

  it('既にDBの値ならそのまま通す', () => {
    expect(normalizeDriveSystem('FF')).toBe('FF');
    expect(normalizeDriveSystem('FR')).toBe('FR');
  });

  it('前後の空白は無視する', () => {
    expect(normalizeDriveSystem(' 2WD ')).toBe('FF');
  });

  it('大文字小文字を問わない', () => {
    expect(normalizeDriveSystem('e-four')).toBe('4WD');
  });

  it('未知の表記は例外にする。黙って既定値に倒さない', () => {
    expect(() => normalizeDriveSystem('6WD')).toThrow(UnknownEnumValueError);
    expect(() => normalizeDriveSystem('6WD')).toThrow(/6WD/);
  });
});

describe('features を持たない入力', () => {
  const gradeWithoutFeatures = {
    name: 'Z',
    powertrain: '2.0L ハイブリッド車',
    driveSystemRaw: '2WD',
    typeDesignation: '6AA-MXWH60-AHXHB',
    price: null,
    seating: 5,
    weight: 1420,
    displacement: 1986,
    wltcMode: 28.4,
    engineType: 'ハイブリッド',
    transmission: '電気式無段変速機',
  };

  it('features を省略しても検証を通る', () => {
    const parsed = ExtractedSpecSchema.safeParse({
      modelName: 'プリウス',
      grades: [gradeWithoutFeatures],
    });

    expect(parsed.success).toBe(true);
  });

  it('features があれば従来どおり検証する', () => {
    const parsed = ExtractedSpecSchema.safeParse({
      modelName: 'プリウス',
      grades: [{ ...gradeWithoutFeatures, features: { navigation: 'まちがった値' } }],
    });

    expect(parsed.success).toBe(false);
  });
});
