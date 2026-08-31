import { z } from 'zod';
import {
  DRIVE_SYSTEMS,
  ENGINE_TYPES,
  FEATURE_AVAILABILITIES,
  TRANSMISSION_TYPES,
} from '@/db/enums';
import { FEATURE_COLUMNS } from '@/db/schema';

export class UnknownEnumValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownEnumValueError';
  }
}

/**
 * 諸元表の駆動方式の表記と、DBの列挙値の対応。
 *
 * トヨタは「2WD / E-Four」と書く。E-Four は後輪をモーターで駆動する4WDである。
 * この写像をLLMにやらせず、コード側で持つのは2つ理由がある —
 * 表記の揺れが増えたときにテストで固定できること、そして未知の表記が来たときに
 * 黙って FF に倒すのではなく確実に失敗させられることである。
 */
const DRIVE_SYSTEM_ALIASES: Record<string, (typeof DRIVE_SYSTEMS)[number]> = {
  '2WD': 'FF',
  '2WD（前2輪駆動）': 'FF',
  // マツダは「2WD（FF）」と書く（MAZDA2の諸元表）
  '2WD（FF）': 'FF',
  'E-FOUR': '4WD',
  // スズキは「フルタイム4WD」と書く（アルトの諸元表）
  'フルタイム4WD': '4WD',
  'E-4': '4WD',
  AWD: '4WD',
  '4WD': '4WD',
  FF: 'FF',
  FR: 'FR',
  MR: 'MR',
  RR: 'RR',
};

export function normalizeDriveSystem(raw: string): (typeof DRIVE_SYSTEMS)[number] {
  const key = raw.trim().toUpperCase();
  const mapped = DRIVE_SYSTEM_ALIASES[key];
  if (!mapped) {
    throw new UnknownEnumValueError(
      `駆動方式の表記「${raw}」を解釈できません。` +
        'DRIVE_SYSTEM_ALIASES に追加するか、抽出結果を確認してください',
    );
  }
  return mapped;
}

type FeatureShape = { [K in (typeof FEATURE_COLUMNS)[number]]: FeatureEnum };
type FeatureEnum = z.ZodEnum<{
  [K in (typeof FEATURE_AVAILABILITIES)[number]]: K;
}>;

/**
 * 20項目ぶんの Zod スキーマを FEATURE_COLUMNS から組み立てる。
 * 列の一覧を二度書かないためで、db/schema.ts に項目が増えれば
 * 抽出スキーマにも自動で増える。
 */
function featureShape(): FeatureShape {
  const shape = {} as FeatureShape;
  for (const column of FEATURE_COLUMNS) {
    shape[column] = z.enum(FEATURE_AVAILABILITIES);
  }
  return shape;
}

/**
 * 寸法。grades.dimensions（jsonb）にそのまま入る。
 *
 * 列を足さず jsonb にしてあるのは、車種によって載っている項目が違うためである。
 * 比較表が読むのは length / width / height の3つで、残りは持っていれば表示に使える。
 */
const DimensionsSchema = z.object({
  length: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  wheelbase: z.number().int().positive().nullish(),
  groundClearance: z.number().int().positive().nullish(),
  minTurningRadius: z.number().positive().nullish(),
});

/**
 * 出力・トルク。単位付きの文字列で持つ。
 *
 * 諸元表の表記は「67kW（91PS）/5,500r.p.m.」のように出力と回転数が一体で、
 * 数値に分解すると元の情報が落ちる。比較表もそのまま表示する。
 */
const PerformanceSchema = z.object({
  maxPower: z.string().min(1),
  maxTorque: z.string().min(1),
});

/** WLTCの内訳。wltcMode（総合値）は別に持つ */
const FuelDetailSchema = z.object({
  cityMode: z.number().positive(),
  suburbanMode: z.number().positive().nullish(),
  highwayMode: z.number().positive(),
});

const ExtractedGradeSchema = z.object({
  /** 諸元表に印字されたグレード名。「Z」「G」など */
  name: z.string().min(1),
  /** 列見出しの原文。「2.0L プラグインハイブリッド車」。一意制約の識別子になるため空は許さない */
  powertrain: z.string().min(1),
  /** 諸元表の表記のまま受け取る。DBの列挙への写像は normalizeDriveSystem が行う */
  driveSystemRaw: z.string().min(1),
  /** 車両型式。諸元表に無ければ null */
  typeDesignation: z.string().min(1).nullable(),
  price: z.number().int().positive().nullable(),
  seating: z.number().int().positive(),
  weight: z.number().int().positive().nullable(),
  displacement: z.number().int().positive().nullable(),
  wltcMode: z.number().positive().nullable(),
  engineType: z.enum(ENGINE_TYPES),
  transmission: z.string().nullable(),
  /**
   * ここから下は任意である。
   *
   * 既に取り込んだ車種のJSONにこれらが無いため、必須にすると再検証で落ちる。
   * 任意にしておけば「まだ読んでいない」を「値が無い」と取り違えずに済む —
   * computeChanges は undefined の項目を比較対象から外す。
   *
   * ただし LLM に渡すJSONスキーマ側では必須にする（extractionJsonSchema）。
   * 省略を許すと「判断できないものを明示する」という指示が骨抜きになる。
   */
  cruisingRange: z.number().int().positive().nullish(),
  airbags: z.number().int().min(0).max(20).nullish(),
  transmissionType: z.enum(TRANSMISSION_TYPES).nullish(),
  gearCount: z.number().int().min(1).max(10).nullish(),
  dimensions: DimensionsSchema.optional(),
  performance: PerformanceSchema.optional(),
  fuelDetail: FuelDetailSchema.optional(),
  /**
   * 20項目すべてを必須にしてある。
   *
   * z.record で任意のキーを許す形にはできない。Structured Outputs は
   * `additionalProperties` に `false` 以外を受け付けないためであり、
   * 加えて、キーを自由にするとモデルが勝手な名前の項目を作る。
   * 20項目を列挙して全部要求すれば、判断できないものは省略ではなく
   * unknown として明示される。
   *
   * ただしオブジェクト全体は任意である。人が諸元表を読んで書く入力
   * （scripts/ingest-spec.ts）は装備を持たない。装備は色分けで表現されており
   * テキストからは読めないため、サイト構築段階で別途行う（設計書6.0）。
   * LLMに渡すJSONスキーマ側では引き続き全項目を要求する。
   */
  features: z.object(featureShape()).optional(),
});

export const ExtractedSpecSchema = z.object({
  modelName: z.string().min(1),
  /** 0件は抽出失敗である。成功として通してはいけない */
  grades: z.array(ExtractedGradeSchema).min(1),
});

export type ExtractedGrade = z.infer<typeof ExtractedGradeSchema>;
export type ExtractedSpec = z.infer<typeof ExtractedSpecSchema>;

/**
 * Structured Outputs が受け付けない検証キーワード。
 *
 * 仕様上サポートされないものを送ると 400 になる。Zod は当然これらを出力するので、
 * APIに渡す前に落とす。落としても検証が緩むわけではない —
 * 返ってきた値は結局 ExtractedSpecSchema.safeParse を通すため、
 * 「APIには構造を強制させ、細かい制約は手元で確かめる」という二段構えになる。
 */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== 'object') return node;

  const source = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    result[key] = sanitize(value);
  }

  // すべてのオブジェクトに additionalProperties: false が要る。
  // Zod が別の値を入れている場合も false で上書きする
  if (result.type === 'object') result.additionalProperties = false;

  return result;
}

/**
 * Structured Outputs（output_config.format）に渡す JSON Schema。
 *
 * Zod のオブジェクトをそのまま渡すのではなく変換する。変換元が1つなので、
 * APIに強制させる形と、返ってきた値を検証する形が食い違わない。
 */
export function extractionJsonSchema(): unknown {
  const schema = sanitize(z.toJSONSchema(ExtractedSpecSchema)) as Record<string, unknown>;

  /*
   * features はスキーマ上は任意だが、それは人が書く入力のためであって
   * モデルに対しては全項目を要求する。省略を許すと「判断できないものを
   * unknown と書く」という指示が骨抜きになる。
   */
  const grade = (
    ((schema.properties as Record<string, Record<string, unknown>>).grades.items) as Record<
      string,
      unknown
    >
  );
  const required = grade.required as string[] | undefined;
  // 任意にしてあるのは人が書く入力のためであって、モデルには全項目を要求する
  for (const key of [
    'features',
    'cruisingRange',
    'airbags',
    'transmissionType',
    'gearCount',
    'dimensions',
    'performance',
    'fuelDetail',
  ]) {
    if (required && !required.includes(key)) required.push(key);
  }

  return schema;
}
