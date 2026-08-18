import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  FEATURE_COLUMNS,
  bodyTypeEnum,
  changeRequests,
  driveSystemEnum,
  engineTypeEnum,
  featureAvailabilityEnum,
  grades,
  models,
  specDocuments,
  specSources,
} from '@/db/schema';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';

export type ApplyResult = 'applied' | 'noop' | 'stale' | 'not_approved';

interface DiffEntry {
  before: unknown;
  after: unknown;
}

type Diff = Record<string, DiffEntry>;

/**
 * 適用は冪等でなければならない。
 *
 * @neondatabase/serverless の HTTP ドライバはトランザクションを持たないため、
 * 「複数の書き込みをまとめて巻き戻す」ができない。代わりに、
 * 状態遷移そのものを条件付き UPDATE にして、二度目が空振りするようにする。
 *
 *   update change_requests set status='applied'
 *   where id = $1 and status = 'approved'
 *
 * 更新行数が0なら、既に誰かが適用したか、そもそも承認されていない。
 * どちらの場合も何もしないのが正しい。
 */
export async function applyChangeRequest(id: string, decidedBy: string): Promise<ApplyResult> {
  const context = await loadContext(id);
  if (!context) return 'not_approved';

  const { request, modelId, documentMonth } = context;
  if (request.status === 'applied') return 'noop';
  if (request.status !== 'approved') return 'not_approved';

  const diff = asDiff(request.diff);
  if (!diff) return markStale(id);

  if (request.kind === 'new_grade') return applyNewGrade(id, diff, modelId, decidedBy);
  if (request.kind === 'new_model') return applyNewModel(id, diff, decidedBy);

  const grade = await findGrade(modelId, request.targetKey);
  if (!grade) return markStale(id);

  if (request.kind === 'discontinued') {
    // 既に廃止済みの行を上書きしない。before=false と食い違っている
    if (grade.discontinuedAt) return markStale(id);
    if (!(await claim(id, decidedBy))) return 'noop';
    // publication_status は触らない。非公開にするかは別の判断である
    await db
      .update(grades)
      .set({ discontinuedAt: documentMonth, updatedAt: new Date() })
      .where(eq(grades.id, grade.id));
    return 'applied';
  }

  const patch = buildGradePatch(diff, grade as unknown as Record<string, unknown>);
  if (!patch) return markStale(id);
  if (!(await claim(id, decidedBy))) return 'noop';

  await db
    .update(grades)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(grades.id, grade.id));
  return 'applied';
}

export async function approveChangeRequest(id: string, decidedBy: string): Promise<boolean> {
  return decide(id, decidedBy, 'approved');
}

export async function rejectChangeRequest(id: string, decidedBy: string): Promise<boolean> {
  return decide(id, decidedBy, 'rejected');
}

async function decide(id: string, decidedBy: string, status: 'approved' | 'rejected') {
  const rows = await db
    .update(changeRequests)
    .set({ status, decidedBy, decidedAt: new Date() })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, 'pending')))
    .returning({ id: changeRequests.id });
  return rows.length > 0;
}

/** change_request から親の車種と、廃止年月に使う書類の年月まで辿る */
async function loadContext(id: string) {
  const [row] = await db
    .select({
      request: changeRequests,
      modelId: specSources.modelId,
      documentMonth: specDocuments.documentMonth,
    })
    .from(changeRequests)
    .innerJoin(specDocuments, eq(changeRequests.specDocumentId, specDocuments.id))
    .innerJoin(specSources, eq(specDocuments.specSourceId, specSources.id))
    .where(eq(changeRequests.id, id));
  return row;
}

/** 承認済みのものだけを applied にする。取れなければ他が先に適用している */
async function claim(id: string, decidedBy: string): Promise<boolean> {
  const rows = await db
    .update(changeRequests)
    .set({ status: 'applied', appliedAt: new Date(), decidedBy })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, 'approved')))
    .returning({ id: changeRequests.id });
  return rows.length > 0;
}

async function markStale(id: string): Promise<'stale'> {
  await db
    .update(changeRequests)
    .set({ status: 'stale' })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, 'approved')));
  return 'stale';
}

/** claim した後に本体の書き込みが失敗したときだけ使う。applied を取り消す */
async function unclaimToStale(id: string): Promise<void> {
  await db
    .update(changeRequests)
    .set({ status: 'stale', appliedAt: null })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, 'applied')));
}

/**
 * target_key は型式（あれば）か 名前/パワートレイン/駆動方式 の複合キー。
 * 複合キーは車種内でしか一意でないため、必ず model_id で絞る。
 */
async function findGrade(modelId: string, targetKey: string) {
  const [byTypeDesignation] = await db
    .select()
    .from(grades)
    .where(and(eq(grades.modelId, modelId), eq(grades.typeDesignation, targetKey)));
  if (byTypeDesignation) return byTypeDesignation;

  const parts = targetKey.split('/');
  if (parts.length !== 3) return undefined;
  const [name, powertrain, driveSystem] = parts;
  // 列挙値でない文字列を enum 列と比較すると Postgres が例外を投げる
  if (!isDriveSystem(driveSystem)) return undefined;

  const [row] = await db
    .select()
    .from(grades)
    .where(
      and(
        eq(grades.modelId, modelId),
        eq(grades.name, name),
        eq(grades.powertrain, powertrain),
        eq(grades.driveSystem, driveSystem),
      ),
    );
  return row;
}

/** jsonb から来る diff は信用できない入力なので、書き込める列を白名簿で縛る */
const UPDATABLE_GRADE_COLUMNS = new Set<string>([
  'name',
  'typeDesignation',
  'price',
  'seating',
  'weight',
  'displacement',
  'wltcMode',
  'engineType',
  'transmission',
  ...FEATURE_COLUMNS,
]);

/**
 * diff の before が現在値と全て一致するときだけ patch を返す。
 * 1つでも食い違えば null（= stale）。上書きはしない。
 */
function buildGradePatch(
  diff: Diff,
  grade: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(diff)) {
    const column = key.startsWith('features.') ? key.slice('features.'.length) : key;
    if (!UPDATABLE_GRADE_COLUMNS.has(column)) return null;
    if (!sameValue(grade[column], entry.before)) return null;

    const value = columnValue(column, entry.after);
    if (value === INVALID) return null;
    patch[column] = value;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

const INVALID = Symbol('invalid');

/** 列の型に合わせて値を整える。列挙値でないものは書かせない */
function columnValue(column: string, value: unknown): unknown | typeof INVALID {
  if (column === 'wltcMode') {
    // numeric 列は文字列で入れる（app/actions/cars.ts と同じ）
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return INVALID;
    return String(value);
  }
  if (column === 'engineType') {
    return isEngineType(value) ? value : INVALID;
  }
  if ((FEATURE_COLUMNS as readonly string[]).includes(column)) {
    return isFeatureAvailability(value) ? value : INVALID;
  }
  return value ?? null;
}

async function applyNewGrade(
  id: string,
  diff: Diff,
  modelId: string,
  decidedBy: string,
): Promise<ApplyResult> {
  const values = buildNewGradeValues(diff, modelId);
  if (!values) return markStale(id);

  // 既に同じキーの行があるなら、別経路で入っている。黙って上書きしない
  const key = `${values.name}/${values.powertrain}/${values.driveSystem}`;
  if (await findGrade(modelId, key)) return markStale(id);

  if (!(await claim(id, decidedBy))) return 'noop';

  try {
    // publication_status は既定の draft のまま。公開はしない
    await db.insert(grades).values(values);
  } catch {
    // 一意制約に弾かれた（claim と INSERT の間に別経路が入れた）
    await unclaimToStale(id);
    return 'stale';
  }
  return 'applied';
}

function buildNewGradeValues(diff: Diff, modelId: string) {
  const after = (key: string) => diff[key]?.after ?? null;

  const name = after('name');
  const price = after('price');
  const seating = after('seating');
  const engineType = after('engineType');
  const driveSystem = after('driveSystem');
  const powertrain = after('powertrain') ?? '';

  if (typeof name !== 'string' || name === '') return null;
  if (typeof price !== 'number') return null;
  if (typeof seating !== 'number') return null;
  if (typeof powertrain !== 'string') return null;
  if (!isEngineType(engineType)) return null;
  if (!isDriveSystem(driveSystem)) return null;

  const features: Record<string, string> = {};
  for (const column of FEATURE_COLUMNS) {
    const value = after(`features.${column}`);
    if (isFeatureAvailability(value)) features[column] = value;
  }

  const wltcMode = after('wltcMode');

  return {
    modelId,
    name,
    slug: gradeSlug(name, { powertrain, driveSystem }),
    price,
    seating,
    engineType,
    driveSystem,
    powertrain,
    typeDesignation: asNullableString(after('typeDesignation')),
    transmission: asNullableString(after('transmission')),
    weight: asNullableInteger(after('weight')),
    displacement: asNullableInteger(after('displacement')),
    wltcMode: wltcMode === null ? null : String(wltcMode),
    ...features,
  };
}

async function applyNewModel(id: string, diff: Diff, decidedBy: string): Promise<ApplyResult> {
  const after = (key: string) => diff[key]?.after ?? null;

  const manufacturer = after('manufacturer');
  const name = after('name');
  const bodyType = after('bodyType');
  if (typeof manufacturer !== 'string' || manufacturer === '') return markStale(id);
  if (typeof name !== 'string' || name === '') return markStale(id);
  if (!isBodyType(bodyType)) return markStale(id);

  const officialUrl = asNullableString(after('officialUrl'));

  if (!(await claim(id, decidedBy))) return 'noop';

  try {
    // verified_at は null のまま。人間が管理画面で検証する
    await db.insert(models).values({
      manufacturer,
      manufacturerSlug: manufacturerSlug(manufacturer),
      name,
      slug: modelSlug(name, officialUrl ?? ''),
      bodyType,
      officialUrl,
      description: asNullableString(after('description')),
    });
  } catch {
    await unclaimToStale(id);
    return 'stale';
  }
  return 'applied';
}

function asDiff(value: unknown): Diff | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const diff = value as Record<string, unknown>;
  for (const entry of Object.values(diff)) {
    if (typeof entry !== 'object' || entry === null || !('before' in entry) || !('after' in entry)) {
      return null;
    }
  }
  return diff as Diff;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function isEngineType(value: unknown): value is (typeof engineTypeEnum.enumValues)[number] {
  return typeof value === 'string' && (engineTypeEnum.enumValues as readonly string[]).includes(value);
}

function isDriveSystem(value: unknown): value is (typeof driveSystemEnum.enumValues)[number] {
  return typeof value === 'string' && (driveSystemEnum.enumValues as readonly string[]).includes(value);
}

function isBodyType(value: unknown): value is (typeof bodyTypeEnum.enumValues)[number] {
  return typeof value === 'string' && (bodyTypeEnum.enumValues as readonly string[]).includes(value);
}

function isFeatureAvailability(
  value: unknown,
): value is (typeof featureAvailabilityEnum.enumValues)[number] {
  return (
    typeof value === 'string' &&
    (featureAvailabilityEnum.enumValues as readonly string[]).includes(value)
  );
}

/**
 * 同じ値とみなすかどうか。pipeline/diff.ts と同じ規則。
 *
 * drizzle の numeric 列は文字列で返るため（wltc_mode の "26.0"）、
 * diff に入った数値 26 と素朴に比べると毎回 stale になる。
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
