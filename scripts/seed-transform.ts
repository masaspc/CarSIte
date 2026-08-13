import {
  bodyTypeEnum,
  driveSystemEnum,
  engineTypeEnum,
  FEATURE_COLUMNS,
  type BodyType,
  type FeatureColumn,
} from '@/db/schema';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';
import { seedGradeSchema, type SeedGradeInput, type SeedGradeRecord } from '@/lib/validation';

export interface RawCar {
  id: string;
  manufacturer: string;
  model: string;
  grade: string;
  bodyType: string;
  price: number;
  releaseDate: string;
  dimensions: Record<string, number>;
  capacity: { seating: number };
  engine: {
    type: string;
    displacement?: number;
    maxPower: string;
    maxTorque: string;
    transmission: string;
    driveSystem: string;
  };
  fuelEfficiency: {
    wltcMode?: number;
    cityMode?: number;
    suburbanMode?: number;
    highwayMode?: number;
    cruisingRange?: number;
    ecoCarTax: boolean;
  };
  safety: Record<string, boolean | number>;
  comfort: Record<string, boolean>;
  images: { exterior: string[]; interior: string[] };
  officialUrl: string;
  description: string;
  priceHistory?: { date: string; price: number }[];
}

export interface SeedModel {
  key: string;
  manufacturer: string;
  manufacturerSlug: string;
  name: string;
  slug: string;
  bodyType: BodyType;
  officialUrl: string;
  description: string;
}

/**
 * 1グレード分の投入値。形は lib/validation.ts の seedGradeSchema が決める
 * （= Zodスキーマを単一の真実の源とする）。ここで独自に列を並べ直すと、
 * 検証されない列がシード経由でだけ増やせてしまう。
 *
 * modelId だけは差し引く: 変換時点では models が未挿入で UUID が無く、
 * 代わりに modelKey で親を指す。seed.ts が挿入後に解決して付け直す。
 * transmissionType / gearCount も持たない — 原文 transmission から
 * seedGradeSchema が導出する（管理画面と同じ導出を通す）。
 */
export type SeedGrade = { key: string; modelKey: string } & Omit<SeedGradeInput, 'modelId'>;

export interface SeedPricePoint {
  gradeKey: string;
  date: string;
  price: number;
}

export interface SeedData {
  models: SeedModel[];
  grades: SeedGrade[];
  priceHistory: SeedPricePoint[];
}

export class DuplicateGradeError extends Error {
  constructor(public readonly duplicates: string[]) {
    super(
      `重複したグレードが ${duplicates.length} 件あります。値が食い違うため自動では解決できません:\n` +
        duplicates.map((d) => `  - ${d}`).join('\n'),
    );
    this.name = 'DuplicateGradeError';
  }
}

export class SeedValidationError extends Error {
  constructor(public readonly failures: readonly { grade: string; issues: string[] }[]) {
    super(
      `Zod検証に失敗したグレードが ${failures.length} 件あります。` +
        '不正なデータを黙って投入しないため、シード全体を中止します:\n' +
        failures
          .map(({ grade, issues }) => `  - ${grade}\n${issues.map((i) => `      ${i}`).join('\n')}`)
          .join('\n'),
    );
    this.name = 'SeedValidationError';
  }
}

/** 内部キーの区切り。車種名・メーカー名に現れない文字列にする */
const SEPARATOR = '::';

/** モデルの一意キー。キー構築をファイル間で重複させないこと */
export function modelKeyOf(manufacturer: string, name: string): string {
  return `${manufacturer}${SEPARATOR}${name}`;
}

/**
 * 既存の boolean 装備を feature_availability に写す。
 * true は standard、false は **unknown**。
 * 元データは機械生成のテンプレート値であり、false に「設定なし」の根拠がないため
 * none に丸めない。
 */
function mapFeature(value: unknown): 'standard' | 'unknown' {
  return value === true ? 'standard' : 'unknown';
}

/**
 * RawCar（JSONフィクスチャの生入力）はただの string しか持たないため、
 * DBのenumカラムに書き込む前に許可値かどうかを実行時に検証する。
 * `as BodyType` のような型キャストはコンパイラを黙らせるだけで型安全性を
 * 回復しないため使わない。ここで弾けば、insert時のDB制約違反という
 * 分かりにくい失敗ではなく、どの車のどのフィールドが不正かを名指しして
 * 止まる。DuplicateGradeError と同じ思想: 壊れたデータを黙って通さない。
 */
function assertEnum<T extends string>(
  values: readonly T[],
  value: string,
  field: string,
  carId: string,
): T {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(
      `${carId} の ${field} が不正です: ${JSON.stringify(value)}（許可値: ${values.join(' / ')}）`,
    );
  }
  return value as T;
}

export function transformCars(cars: RawCar[]): SeedData {
  const models = new Map<string, SeedModel>();
  const grades: SeedGrade[] = [];
  const priceHistory: SeedPricePoint[] = [];
  const seenGrades = new Set<string>();
  const duplicates: string[] = [];

  for (const car of cars) {
    const modelKey = modelKeyOf(car.manufacturer, car.model);

    if (!models.has(modelKey)) {
      models.set(modelKey, {
        key: modelKey,
        manufacturer: car.manufacturer,
        manufacturerSlug: manufacturerSlug(car.manufacturer),
        name: car.model,
        slug: modelSlug(car.model, car.officialUrl),
        bodyType: assertEnum(bodyTypeEnum.enumValues, car.bodyType, 'bodyType', car.id),
        officialUrl: car.officialUrl,
        description: car.description,
      });
    }

    const gradeKey = `${modelKey}${SEPARATOR}${car.grade}`;
    if (seenGrades.has(gradeKey)) {
      duplicates.push(`${car.manufacturer} / ${car.model} / ${car.grade}`);
      continue;
    }
    seenGrades.add(gradeKey);

    const features = Object.fromEntries(
      FEATURE_COLUMNS.map((column) => [
        column,
        mapFeature(car.safety[column] ?? car.comfort[column]),
      ]),
    ) as Record<FeatureColumn, 'standard' | 'unknown'>;

    grades.push({
      key: gradeKey,
      modelKey,
      name: car.grade,
      slug: gradeSlug(car.grade),
      publicationStatus: 'draft',
      price: car.price,
      releaseDate: car.releaseDate || null,
      engineType: assertEnum(engineTypeEnum.enumValues, car.engine.type, 'engineType', car.id),
      driveSystem: assertEnum(
        driveSystemEnum.enumValues,
        car.engine.driveSystem,
        'driveSystem',
        car.id,
      ),
      transmission: car.engine.transmission,
      seating: car.capacity.seating,
      displacement: car.engine.displacement ?? null,
      weight: car.dimensions.weight ?? null,
      wltcMode: car.fuelEfficiency.wltcMode ?? null,
      cruisingRange: car.fuelEfficiency.cruisingRange ?? null,
      ecoCarTax: car.fuelEfficiency.ecoCarTax,
      airbags: typeof car.safety.airbags === 'number' ? car.safety.airbags : null,
      dimensions: car.dimensions,
      performance: { maxPower: car.engine.maxPower, maxTorque: car.engine.maxTorque },
      fuelDetail: {
        cityMode: car.fuelEfficiency.cityMode,
        suburbanMode: car.fuelEfficiency.suburbanMode,
        highwayMode: car.fuelEfficiency.highwayMode,
      },
      images: car.images,
      extraFeatures: {},
      ...features,
    });

    for (const point of car.priceHistory ?? []) {
      priceHistory.push({ gradeKey, date: point.date, price: point.price });
    }
  }

  if (duplicates.length > 0) {
    throw new DuplicateGradeError(duplicates);
  }

  return { models: [...models.values()], grades, priceHistory };
}

/**
 * insert 直前に、1グレードずつ共有の Zod スキーマへ通す。
 * 価格の上限や乗車定員の範囲といった制約を、管理画面からの入力と同じ定義で
 * シードにも効かせるための唯一の経路。ここを通さずに insert してはいけない。
 *
 * 1件目で止めずに全件を検証してから投げる。フィクスチャを直す側にとっては
 * 「1件直しては再実行」より、壊れている行が一度に全部見えるほうが速い。
 * DuplicateGradeError と同じく、原因の行を名指しして中止する。
 */
export function validateSeedGrades(
  gradeRows: readonly SeedGrade[],
  modelIdOf: (modelKey: string) => string,
): SeedGradeRecord[] {
  const validated: SeedGradeRecord[] = [];
  const failures: { grade: string; issues: string[] }[] = [];

  for (const { key, modelKey, ...row } of gradeRows) {
    const result = seedGradeSchema.safeParse({ ...row, modelId: modelIdOf(modelKey) });
    if (result.success) {
      validated.push(result.data);
      continue;
    }
    failures.push({
      grade: key.split(SEPARATOR).join(' / '),
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
  }

  if (failures.length > 0) {
    throw new SeedValidationError(failures);
  }

  return validated;
}
