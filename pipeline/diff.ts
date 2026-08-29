import type { ChangeKind } from '@/db/schema';
import { FEATURE_COLUMNS } from '@/db/schema';
import { type ExtractedSpec, normalizeDriveSystem } from './extraction-schema';

/** price は price_change、ここに挙げた項目は spec_change に振り分ける */
const SPEC_FIELDS = [
  'name',
  'typeDesignation',
  'seating',
  'weight',
  'displacement',
  'wltcMode',
  'engineType',
  'transmission',
] as const;

export type FeatureKey = (typeof FEATURE_COLUMNS)[number];

export interface GradeIdentity {
  typeDesignation: string | null;
  name: string;
  powertrain: string;
  driveSystem: string;
}

export interface NormalizedGrade extends GradeIdentity {
  price: number | null;
  seating: number;
  weight: number | null;
  displacement: number | null;
  wltcMode: number | null;
  engineType: string;
  transmission: string | null;
  features: Record<string, string>;
}

export interface ExistingGrade extends GradeIdentity {
  id: string;
  price: number | null;
  seating: number;
  weight: number | null;
  displacement: number | null;
  /** drizzle の numeric 列は文字列で返る */
  wltcMode: number | string | null;
  engineType: string;
  transmission: string | null;
  discontinuedAt?: string | null;
  features?: Record<string, string>;
}

export interface ChangeDraft {
  kind: ChangeKind;
  targetKey: string;
  diff: Record<string, { before: unknown; after: unknown }>;
}

/**
 * グレードを一意に指す文字列。
 *
 * **型式は使わない。** 「型式はバリアントごとに一意」という前提は
 * トヨタでしか成立しないことが実測で分かった（2026-08-24）。
 *
 *   トヨタ プリウス   8バリアント / 型式8種  ○
 *   トヨタ アクア     9バリアント / 型式9種  ○
 *   スズキ アルト     8バリアント / 型式2種  ✗
 *   ホンダ フィット  15バリアント / 型式6種  ✗
 *
 * ホンダは 6AA-GR3 ひとつで e:HEV X/FF・e:HEV Z/FF・e:HEV RS/FF・
 * 助手席回転シート車 e:HEV Z/FF の4件を覆う。型式をキーにすると4件が1件に潰れ、
 * 内容が同じでも spec_change と discontinued が立つ（実測で確認）。
 * 販売中のグレードを廃止扱いにしかねない。
 *
 * 名前・パワートレイン・駆動方式の複合で識別する。これは DB の
 * grades_model_powertrain_drive_name_key と同じ判別力であり、
 * キーと制約が一致する。型式は識別子ではなく諸元の1項目として持つ。
 *
 * 詳細: docs/research/2026-08-24-manufacturer-pdf-survey.md
 */
export function gradeKey(grade: GradeIdentity): string {
  return compositeKey(grade);
}

function compositeKey(grade: GradeIdentity): string {
  return `${grade.name}/${grade.powertrain}/${grade.driveSystem}`;
}

/**
 * 抽出結果をDBの形に写す。駆動方式の表記（2WD / E-Four）をここで列挙値にする。
 * 未知の表記は例外になる — 黙って FF に倒すと、静かに間違ったデータが入る。
 */
export function normalizeGrades(spec: ExtractedSpec): NormalizedGrade[] {
  return spec.grades.map((grade) => ({
    typeDesignation: grade.typeDesignation,
    name: grade.name,
    powertrain: grade.powertrain,
    driveSystem: normalizeDriveSystem(grade.driveSystemRaw),
    price: grade.price,
    seating: grade.seating,
    weight: grade.weight,
    displacement: grade.displacement,
    wltcMode: grade.wltcMode,
    engineType: grade.engineType,
    transmission: grade.transmission,
    features: grade.features as Record<string, string>,
  }));
}

/**
 * 同じ値とみなすかどうか。
 *
 * drizzle の numeric 列は文字列で返るため（wltc_mode の "26.0"）、
 * 抽出結果の数値 26 と素朴に比べると毎回違うと判定される。
 * それを放置すると、何も変わっていないのに spec_change が立ち続け、
 * 承認キューが空振りで埋まる。
 */
function sameValue(a: unknown, b: unknown): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === right) return true;
  if (left === null || right === null) return false;

  const asNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const numericLeft = asNumber(left);
  const numericRight = asNumber(right);
  return numericLeft !== null && numericRight !== null && numericLeft === numericRight;
}

/**
 * 何を比較するか。
 *
 * 諸元表には車両本体価格も装備の色分けも載っていない（設計書6.0.3・7.4）。
 * 載っていないものを null として比較すると「値が消えた」と解釈され、
 * 毎回・全グレードに空振りの変更が立つ。取り込み元が持っていない項目は
 * 比較しない。
 *
 * 既定は両方 true。LLM抽出のように全項目を持つ入力ではこれまでどおり動く。
 */
export interface CompareOptions {
  comparePrice?: boolean;
  compareFeatures?: boolean;
}

/**
 * 抽出結果とDBの現状を突き合わせ、change_requests の草案を作る。
 *
 * 突き合わせは型式と複合キーの両方で行う。型式が後から付いた場合
 * （既存は null、抽出結果には型式がある）に、片方だけで引くと
 * 「廃止 + 新規」という誤った2件になるためである。
 */
export function computeChanges(
  existing: ExistingGrade[],
  incoming: NormalizedGrade[],
  options: CompareOptions = {},
): ChangeDraft[] {
  const comparePrice = options.comparePrice ?? true;
  const compareFeatures = options.compareFeatures ?? true;
  const byKey = new Map<string, ExistingGrade>();
  for (const row of existing) {
    byKey.set(compositeKey(row), row);
  }

  /*
   * 型式による突き合わせは、その型式が既存側で一意なときだけ行う。
   *
   * 型式が後から付いた場合（既存は null、抽出結果には型式がある）に
   * 拾えるようにするための道だが、複数のグレードが同じ型式を共有する
   * メーカーでは、どれに当てるかを決められない。曖昧なまま当てると
   * 別のグレードに変更を書き込む。
   */
  const typeCounts = new Map<string, number>();
  for (const row of existing) {
    if (!row.typeDesignation) continue;
    typeCounts.set(row.typeDesignation, (typeCounts.get(row.typeDesignation) ?? 0) + 1);
  }
  const byTypeDesignation = new Map<string, ExistingGrade>();
  for (const row of existing) {
    if (!row.typeDesignation) continue;
    if (typeCounts.get(row.typeDesignation) !== 1) continue;
    byTypeDesignation.set(row.typeDesignation, row);
  }

  const changes: ChangeDraft[] = [];
  const matched = new Set<string>();

  for (const row of incoming) {
    const found =
      byKey.get(compositeKey(row)) ??
      (row.typeDesignation ? byTypeDesignation.get(row.typeDesignation) : undefined);

    if (!found) {
      changes.push({
        kind: 'new_grade',
        targetKey: gradeKey(row),
        diff: newGradeDiff(row, { comparePrice, compareFeatures }),
      });
      continue;
    }

    matched.add(found.id);

    if (comparePrice && !sameValue(found.price, row.price)) {
      changes.push({
        kind: 'price_change',
        targetKey: gradeKey(row),
        diff: { price: { before: found.price ?? null, after: row.price } },
      });
    }

    const specDiff = specChanges(found, row, compareFeatures);
    if (Object.keys(specDiff).length > 0) {
      changes.push({ kind: 'spec_change', targetKey: gradeKey(row), diff: specDiff });
    }
  }

  for (const row of existing) {
    if (matched.has(row.id)) continue;
    // 既に廃止済みの行を毎週 discontinued に上げ直さない
    if (row.discontinuedAt) continue;
    changes.push({
      kind: 'discontinued',
      targetKey: gradeKey(row),
      diff: { discontinued: { before: false, after: true } },
    });
  }

  return changes;
}

function newGradeDiff(
  row: NormalizedGrade,
  options: { comparePrice: boolean; compareFeatures: boolean },
): ChangeDraft['diff'] {
  const diff: ChangeDraft['diff'] = {};
  const fields: Array<keyof NormalizedGrade> = [
    'name',
    'powertrain',
    'driveSystem',
    'typeDesignation',
    'seating',
    'weight',
    'displacement',
    'wltcMode',
    'engineType',
    'transmission',
  ];
  for (const field of fields) {
    diff[field] = { before: null, after: row[field] ?? null };
  }
  if (options.comparePrice) {
    diff.price = { before: null, after: row.price ?? null };
  }
  if (options.compareFeatures) {
    for (const column of FEATURE_COLUMNS) {
      diff[`features.${column}`] = { before: null, after: row.features[column] ?? null };
    }
  }
  return diff;
}

function specChanges(
  found: ExistingGrade,
  row: NormalizedGrade,
  compareFeatures: boolean,
): ChangeDraft['diff'] {
  const diff: ChangeDraft['diff'] = {};

  for (const field of SPEC_FIELDS) {
    const before = found[field] ?? null;
    const after = row[field] ?? null;
    if (!sameValue(before, after)) diff[field] = { before, after };
  }

  // 既存側に装備が無い（読み出していない）場合は装備を比較しない。
  // 「未取得」を「変更」と取り違えないため
  if (compareFeatures && found.features) {
    for (const column of FEATURE_COLUMNS) {
      const before = found.features[column] ?? null;
      const after = row.features[column] ?? null;
      if (!sameValue(before, after)) diff[`features.${column}`] = { before, after };
    }
  }

  return diff;
}
