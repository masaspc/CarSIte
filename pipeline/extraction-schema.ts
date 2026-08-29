import { z } from 'zod';
import { DRIVE_SYSTEMS, ENGINE_TYPES, FEATURE_AVAILABILITIES } from '@/db/enums';
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
  'E-FOUR': '4WD',
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
   * 20項目すべてを必須にしてある。
   *
   * z.record で任意のキーを許す形にはできない。Structured Outputs は
   * `additionalProperties` に `false` 以外を受け付けないためであり、
   * 加えて、キーを自由にするとモデルが勝手な名前の項目を作る。
   * 20項目を列挙して全部要求すれば、判断できないものは省略ではなく
   * unknown として明示される。
   */
  features: z.object(featureShape()),
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
  return sanitize(z.toJSONSchema(ExtractedSpecSchema));
}
