import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  FEATURE_COLUMNS,
  bodyTypeEnum,
  changeRequests,
  driveSystemEnum,
  engineTypeEnum,
  featureAvailabilityEnum,
  transmissionTypeEnum,
  grades,
  models,
  specDocuments,
  specSources,
} from '@/db/schema';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';
import { sameValue } from '@/lib/same-value';

export type ApplyResult = 'applied' | 'noop' | 'stale' | 'not_approved' | 'blocked';

/**
 * 適用できなかった理由。stale と blocked は対処がまったく違うので分ける。
 *
 * - `stale`   … 対象データが動いていた。人間が差分を見直す
 * - `blocked` … 必要な値が欠けている。値を入れれば解決する
 */
type Unappliable = 'stale' | 'blocked';

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
  // blocked は「値が欠けていた」だけなので、揃っていれば再適用してよい
  if (request.status !== 'approved' && request.status !== 'blocked') return 'not_approved';

  const diff = asDiff(request.diff);
  // diff が壊れている。データの問題であってデータが動いたわけではない
  if (!diff) return markUnappliable(id, 'blocked');

  if (request.kind === 'new_grade') return applyNewGrade(id, diff, modelId, decidedBy);
  if (request.kind === 'new_model') return applyNewModel(id, diff, decidedBy);

  const grade = await findGrade(modelId, request.targetKey);
  // 対象が見つからない＝世界のほうが変わった
  if (!grade) return markUnappliable(id, 'stale');

  if (request.kind === 'discontinued') {
    // 既に廃止済みの行を上書きしない。before=false と食い違っている
    if (grade.discontinuedAt) return markUnappliable(id, 'stale');
    if (!(await claim(id, decidedBy))) return 'noop';
    // publication_status は触らない。非公開にするかは別の判断である
    await db
      .update(grades)
      .set({ discontinuedAt: documentMonth, updatedAt: new Date() })
      .where(eq(grades.id, grade.id));
    return 'applied';
  }

  const patch = buildGradePatch(diff, grade as unknown as Record<string, unknown>);
  if ('reason' in patch) return markUnappliable(id, patch.reason);
  if (!(await claim(id, decidedBy))) return 'noop';

  await db
    .update(grades)
    .set({ ...patch.values, updatedAt: new Date() })
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

/**
 * 適用してよい状態。blocked は「値が欠けていて適用できなかった」だけなので、
 * 値が揃えば approved と同じく再適用できる。
 */
const APPLIABLE = inArray(changeRequests.status, ['approved', 'blocked']);

/** 適用してよいものだけを applied にする。取れなければ他が先に適用している */
async function claim(id: string, decidedBy: string): Promise<boolean> {
  const rows = await db
    .update(changeRequests)
    .set({ status: 'applied', appliedAt: new Date(), decidedBy })
    .where(and(eq(changeRequests.id, id), APPLIABLE))
    .returning({ id: changeRequests.id });
  return rows.length > 0;
}

async function markUnappliable<R extends Unappliable>(id: string, reason: R): Promise<R> {
  await db
    .update(changeRequests)
    .set({ status: reason })
    .where(and(eq(changeRequests.id, id), APPLIABLE));
  return reason;
}

/** claim した後に本体の書き込みが失敗したときだけ使う。applied を取り消す */
async function unclaimToStale(id: string): Promise<void> {
  await db
    .update(changeRequests)
    .set({ status: 'stale', appliedAt: null })
    .where(and(eq(changeRequests.id, id), eq(changeRequests.status, 'applied')));
}

/**
 * target_key は 名前/パワートレイン/駆動方式 の複合キー（gradeKey が作る）。
 * 車種内でしか一意でないため、必ず model_id で絞る。
 *
 * 型式による照合はフォールバックに回す。型式は一意とは限らず
 * （ホンダは1つの型式が4バリアントを覆う）、複数該当したら当てない。
 */
async function findGrade(modelId: string, targetKey: string) {
  const parts = targetKey.split('/');
  if (parts.length !== 3) return findGradeByTypeDesignation(modelId, targetKey);
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

/** 複合キーの形をしていない target_key（型式で作られた古い行）のための後方互換 */
async function findGradeByTypeDesignation(modelId: string, targetKey: string) {
  const rows = await db
    .select()
    .from(grades)
    .where(and(eq(grades.modelId, modelId), eq(grades.typeDesignation, targetKey)));
  // 複数該当するなら型式では特定できない。当てずに諦める
  return rows.length === 1 ? rows[0] : undefined;
}

/**
 * NOT NULL の列。ここに null を書こうとしたら適用せず stale にする。
 *
 * 諸元表には車両本体価格が載っていない（実物で確認: 「価格は販売店が独自に
 * 定めていますので…」）。抽出結果の price は null になり、computeChanges は
 * 「値 -> null」を price_change として立てる。それをそのまま適用すると
 * grades.price の NOT NULL 制約に当たってDBエラーで落ちる。
 *
 * 「値が取れなかった」と「値が無くなった」は区別がつかない。
 * 区別がつかないものを書き込まないのがこのパイプラインの原則である。
 */
const NON_NULLABLE_GRADE_COLUMNS = new Set<string>([
  'name',
  'price',
  'seating',
  'engineType',
  ...FEATURE_COLUMNS,
]);

/** 塊ごと入れ替える jsonb 列。中の項目ごとのマージはしない（pipeline/diff.ts 参照） */
const JSON_GRADE_COLUMNS = new Set<string>(['dimensions', 'performance', 'fuelDetail']);

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
  'cruisingRange',
  'airbags',
  'transmissionType',
  'gearCount',
  ...JSON_GRADE_COLUMNS,
  ...FEATURE_COLUMNS,
]);


/**
 * diff の before が現在値と全て一致するときだけ patch を返す。上書きはしない。
 *
 * 失敗の理由を2つに分ける。`stale` は対象データが動いていた場合で、人間が
 * 差分を見直す必要がある。`blocked` は diff の中身が書き込めない場合で、
 * 値を直せば解決する。
 */
function buildGradePatch(
  diff: Diff,
  grade: Record<string, unknown>,
): { values: Record<string, unknown> } | { reason: Unappliable } {
  const patch: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(diff)) {
    const column = key.startsWith('features.') ? key.slice('features.'.length) : key;

    // 知らない列。diff の作りが壊れている
    if (!UPDATABLE_GRADE_COLUMNS.has(column)) return { reason: 'blocked' };

    // 現在値が before と違う。これだけが本当の stale である
    if (!sameValue(grade[column], entry.before)) return { reason: 'stale' };

    // NOT NULL 列に null は書けない（諸元表に価格が無い場合など）
    if (entry.after === null && NON_NULLABLE_GRADE_COLUMNS.has(column)) {
      return { reason: 'blocked' };
    }

    const value = columnValue(column, entry.after);
    if (value === INVALID) return { reason: 'blocked' };
    patch[column] = value;
  }

  if (Object.keys(patch).length === 0) return { reason: 'blocked' };
  return { values: patch };
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
  if (column === 'transmissionType') {
    return value === null || value === undefined || isTransmissionType(value) ? (value ?? null) : INVALID;
  }
  if (JSON_GRADE_COLUMNS.has(column)) {
    // jsonb 列に配列やスカラーを書き込ませない。読み出す側（比較表）は
    // オブジェクトとして扱うため、形が違うと描画で落ちる
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object' || Array.isArray(value)) return INVALID;
    return value;
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
  // 必要な値が欠けている（諸元表に価格が無いなど）。値が揃えば適用できる
  if (!values) return markUnappliable(id, 'blocked');

  // 既に同じキーの行があるなら、別経路で入っている。黙って上書きしない
  const key = `${values.name}/${values.powertrain}/${values.driveSystem}`;
  // 既に同じキーの行がある＝別経路で入っていた。世界のほうが変わった
  if (await findGrade(modelId, key)) return markUnappliable(id, 'stale');

  /*
   * slug の衝突は stale ではない。
   *
   * 識別子（名前/パワートレイン/駆動方式）が違っても slug が同じになることがある。
   * gradeSlug は排気量・動力源・変速機・駆動方式しか見ないため、それ以外の点でしか
   * 違わないパワートレイン表記は同じ slug に潰れる。
   *
   * これを stale と報告すると「対象データが動いた」という誤った診断になり、
   * 運用者は差分を見直しに行って何も見つけられない。実際にはパワートレイン表記か
   * gradeSlug を直せば解決する話なので blocked にする（blocked は承認キューに残り、
   * 直して「適用」を押し直せる）。
   */
  const [slugTaken] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.modelId, modelId), eq(grades.slug, values.slug)))
    .limit(1);
  if (slugTaken) return markUnappliable(id, 'blocked');

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
  if (typeof manufacturer !== 'string' || manufacturer === '') return markUnappliable(id, 'blocked');
  if (typeof name !== 'string' || name === '') return markUnappliable(id, 'blocked');
  if (!isBodyType(bodyType)) return markUnappliable(id, 'blocked');

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

function isTransmissionType(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (transmissionTypeEnum.enumValues as readonly string[]).includes(value)
  );
}

function isFeatureAvailability(
  value: unknown,
): value is (typeof featureAvailabilityEnum.enumValues)[number] {
  return (
    typeof value === 'string' &&
    (featureAvailabilityEnum.enumValues as readonly string[]).includes(value)
  );
}

