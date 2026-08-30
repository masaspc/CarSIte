# 差分ハイライト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 比較表で一致する行を既定で畳み、違う行だけを見せる。切り替えで全項目に戻せる。

**Architecture:** 判定と描画を分ける。`lib/same-value.ts` がスカラーの同値判定を持ち（`pipeline/` の2箇所から移設して集約）、`lib/comparison-diff.ts` が行の定義と `same`/`different`/`unknown` の三値判定を持つ。`ComparisonTable` は描画に専念する。

**Tech Stack:** Next.js 15 (App Router) / TypeScript / Tailwind CSS / Vitest

**Spec:** `docs/superpowers/specs/2026-08-30-comparison-diff-design.md`

## Global Constraints

- **既存テストの期待値を緩めない。** 通らない場合は実装のほうを直す
- `npx tsc --noEmit` はエラー0件、`npm run lint` は警告0
- コミットは `git add` の対象を明示指定する。`git add -A` は使わない
- **DBには接続しない。** このサブプロジェクトは単体テストだけで完結する。`npm run test:integration` は既存の回帰確認としてのみ実行し、新しい統合テストは書かない
- 現在DBには109グレードあり6件が公開済み。**この状態を変えない**
- 比較表に**新しい行を足さない**。現行の40行（諸元20＋装備20）が対象

---

## Task 1: sameValue を lib へ移設して集約する

`sameValue` は `pipeline/diff.ts` と `pipeline/apply.ts` に同じものが2つある。比較表で3つ目を作る前に1箇所へ集める。**振る舞いは1文字も変えない。**

**Files:**
- Create: `lib/same-value.ts`
- Create: `tests/unit/same-value.test.ts`
- Modify: `pipeline/diff.ts`
- Modify: `pipeline/apply.ts`

**Interfaces:**
- Produces: `export function sameValue(a: unknown, b: unknown): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/same-value.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sameValue } from '@/lib/same-value';

describe('sameValue', () => {
  it('同じ値は同じ', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(true, true)).toBe(true);
  });

  it('null と undefined は同じ扱い', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(null, null)).toBe(true);
  });

  it('片方だけ null なら違う', () => {
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue('', null)).toBe(false);
  });

  it('numeric 文字列と数値を同じとみなす', () => {
    // drizzle の numeric 列は文字列で返る（wltc_mode の "26.0"）
    expect(sameValue('26.0', 26)).toBe(true);
    expect(sameValue(26, '26.0')).toBe(true);
    expect(sameValue('1420', 1420)).toBe(true);
  });

  it('数値にならない文字列同士は文字列として比較する', () => {
    expect(sameValue('FF', 'FF')).toBe(true);
    expect(sameValue('FF', '4WD')).toBe(false);
  });

  it('空文字は数値に落とさない', () => {
    expect(sameValue('', 0)).toBe(false);
    expect(sameValue('   ', 0)).toBe(false);
  });

  it('数値にならない文字列と数値は違う', () => {
    expect(sameValue('¥3,998,500', 3998500)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/unit/same-value.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/same-value"`

- [ ] **Step 3: lib/same-value.ts を作る**

`pipeline/diff.ts` の `sameValue`（116行目付近）の中身を**そのまま**移す。ロジックは変えない。

```ts
/**
 * 同じ値とみなすかどうか。**スカラーの同値判定だけを担う。**
 *
 * drizzle の numeric 列は文字列で返るため（wltc_mode の "26.0"）、
 * 数値 26 と素朴に比べると毎回違うと判定される。それを放置すると、
 * 収集パイプラインでは何も変わっていないのに spec_change が立ち続け、
 * 比較表では同じ値が「違う」と表示される。
 *
 * **製品上の判断はここに入れない。** `unknown` を一致とみなすか、空値の行を
 * 畳むかといった判断は、それを使う側（lib/comparison-diff.ts）が持つ。
 * 収集パイプラインと比較UIで共有するのはこの層までである（設計書3章）。
 *
 * もとは pipeline/diff.ts と pipeline/apply.ts に同じものが2つあった。
 * 比較表で3つ目を作る前に集約した。
 */
export function sameValue(a: unknown, b: unknown): boolean {
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
```

- [ ] **Step 4: pipeline の2箇所を差し替える**

`pipeline/diff.ts`:
- `function sameValue(...) { ... }` の定義（コメント含む）を丸ごと削除する
- import に `import { sameValue } from '@/lib/same-value';` を足す

`pipeline/apply.ts`:
- ファイル末尾付近の `function sameValue(...) { ... }` の定義（コメント含む）を丸ごと削除する
- import に `import { sameValue } from '@/lib/same-value';` を足す

**呼び出し側は一切変えない。** `sameValue(a, b)` の使い方は同じである。

- [ ] **Step 5: 集約できたことを確認**

Run: `grep -rn "function sameValue" pipeline lib`
Expected: `lib/same-value.ts` の1件のみ

- [ ] **Step 6: 既存の振る舞いが変わっていないことを確認**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: tsc エラー0件、単体・統合とも失敗0件。**1件でも落ちたら移設で振る舞いを変えている**

- [ ] **Step 7: コミット**

```bash
git add lib/same-value.ts tests/unit/same-value.test.ts pipeline/diff.ts pipeline/apply.ts
git commit -m "$(cat <<'EOF'
refactor: sameValue を lib へ移して3箇所の重複を1箇所にする

pipeline/diff.ts と pipeline/apply.ts に同じ実装が2つあった。タスクの
ファイル範囲を超えられない規約のため意図的に複製したものである。
比較表で3つ目を作る前に集約した。

共有するのはスカラーの同値判定までで、unknown の扱いのような製品判断は
使う側が持つ。振る舞いは変えていない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 行の定義と三値判定を作る

比較表の各行を「ラベル・判定用の生値・表示用の整形」の3つに分け、`same` / `different` / `unknown` を判定する純粋関数を作る。**描画はしない。**

**Files:**
- Create: `lib/comparison-diff.ts`
- Create: `tests/unit/comparison-diff.test.ts`

**Interfaces:**
- Consumes: `sameValue`（Task 1）/ `FEATURE_COLUMNS`, `FeatureColumn`（`db/schema.ts`）/ `ComparisonRow`（`db/queries.ts`）
- Produces:
  - `export type RowState = 'same' | 'different' | 'unknown'`
  - `export interface ComparisonCell { raw: unknown; text: string }`
  - `export interface ComparisonRowDef { label: string; cells: ComparisonCell[]; state: RowState }`
  - `export interface ComparisonSection { label: string; rows: ComparisonRowDef[] }`
  - `export function buildComparison(grades: ComparisonRow[]): ComparisonSection[]`
  - `export function countDifferent(sections: ComparisonSection[]): { different: number; unknown: number; total: number }`
  - `export function visibleSections(sections: ComparisonSection[], showAll: boolean): ComparisonSection[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/comparison-diff.test.ts`:

```ts
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
    // "¥3,998,500" は数値に落ちないので、表示値で比較すると
    // sameValue の numeric 吸収が効かなくなる
    const sections = buildComparison([row({ price: 100 }), row({ price: 100 })]);
    const price = sections.flatMap((s) => s.rows).find((r) => r.label === '価格');
    expect(price?.state).toBe('same');
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/unit/comparison-diff.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/comparison-diff"`

- [ ] **Step 3: lib/comparison-diff.ts を作る**

行の定義は `components/ComparisonTable.tsx` の現行の `renderRow` / `renderFeatureRow` の
呼び出しから**そのまま写す**。ラベル・順序・整形規則を変えない。

**下のコードを写す前に、実物の `FEATURE_NAME` と突き合わせること。**
この計画を書いた際、`誤発進抑制機能`→`誤発進抑制`、`ACC`→`アダプティブクルーズ`、
`駐車支援システム`→`パーキングアシスト` と3件を書き換えてしまい、自己レビューで
見つけて直した。ラベルが変わるとテストが探す行が見つからなくなる。

```bash
diff <(sed -n '/^const FEATURE_NAME/,/^};/p' components/ComparisonTable.tsx) \
     <(sed -n '/^const FEATURE_NAME/,/^};/p' lib/comparison-diff.ts)
```

セクションは6つ、行は40行（基本情報4・サイズ4・エンジン性能6・燃費性能6・安全装備8・快適装備12）。

```ts
import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import type { ComparisonRow } from '@/db/queries';
import { sameValue } from '@/lib/same-value';

/**
 * 行の状態。**二値ではなく三値である。**
 *
 * 装備は取り込みが先送りされており（収集パイプライン設計書6.0）、片方だけ
 * 既知という状態が起きる。`standard` と `unknown` を「相違」に含めると
 * 「装備が違う」という誤情報になる。不明を含む行は別扱いにする。
 */
export type RowState = 'same' | 'different' | 'unknown';

export interface ComparisonCell {
  /** 判定に使う生値。整形前 */
  raw: unknown;
  /** セルに表示する文字列 */
  text: string;
}

export interface ComparisonRowDef {
  label: string;
  cells: ComparisonCell[];
  state: RowState;
}

export interface ComparisonSection {
  label: string;
  rows: ComparisonRowDef[];
}

const EMPTY = '−';

const FEATURE_LABEL: Record<string, string> = {
  standard: '○',
  option: 'OP',
  none: '×',
  unknown: EMPTY,
};

const FEATURE_NAME: Record<FeatureColumn, string> = {
  collisionMitigationBrake: '衝突被害軽減ブレーキ',
  falseStartSuppression: '誤発進抑制機能',
  laneDepartureWarning: '車線逸脱警報',
  laneKeepingAssist: '車線維持支援',
  adaptiveCruiseControl: 'ACC',
  blindSpotMonitor: 'ブラインドスポットモニター',
  camera360: '360度カメラ',
  parkingAssist: '駐車支援システム',
  navigation: 'カーナビ',
  etc: 'ETC',
  backCamera: 'バックカメラ',
  powerSeat: 'パワーシート',
  seatHeater: 'シートヒーター',
  steeringHeater: 'ステアリングヒーター',
  autoAircon: 'オートエアコン',
  ledHeadlight: 'LEDヘッドライト',
  smartKey: 'スマートキー',
  powerBackDoor: 'パワーバックドア',
  handsFreeBackDoor: 'ハンズフリーバックドア',
  sunroof: 'サンルーフ',
};

const SAFETY_FEATURES: FeatureColumn[] = [
  'collisionMitigationBrake', 'falseStartSuppression', 'laneDepartureWarning',
  'laneKeepingAssist', 'adaptiveCruiseControl', 'blindSpotMonitor',
  'camera360', 'parkingAssist',
];

const COMFORT_FEATURES: FeatureColumn[] = [
  'navigation', 'etc', 'backCamera', 'powerSeat', 'seatHeater', 'steeringHeater',
  'autoAircon', 'ledHeadlight', 'smartKey', 'powerBackDoor', 'handsFreeBackDoor', 'sunroof',
];

interface Dimensions { length?: number; width?: number; height?: number }
interface Performance { maxPower?: string; maxTorque?: string }
interface FuelDetail { cityMode?: number; highwayMode?: number }

/** 値が「不明」を表すか。装備の unknown と、値そのものが無い場合 */
function isUnknown(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 'unknown';
}

/**
 * 行の状態を決める。
 *
 * 不明を含む行は `different` にしない。「値が違う」と「片方が分からない」は
 * 別のことであり、後者を相違として見せると誤情報になる（設計書4.2）。
 */
function judge(values: unknown[]): RowState {
  if (values.length <= 1) return 'same';
  if (values.some(isUnknown)) {
    // 全部不明なら「同じく不明」として畳んでよい
    return values.every(isUnknown) ? 'same' : 'unknown';
  }
  const [first, ...rest] = values;
  return rest.every((v) => sameValue(first, v)) ? 'same' : 'different';
}

function makeRow(label: string, raws: unknown[], format: (v: unknown) => string): ComparisonRowDef {
  return {
    label,
    cells: raws.map((raw) => ({ raw, text: format(raw) })),
    state: judge(raws),
  };
}

const plain = (v: unknown): string => (isUnknown(v) ? EMPTY : String(v));
const yen = (v: unknown): string => (isUnknown(v) ? EMPTY : `¥${Number(v).toLocaleString()}`);
const suffix = (unit: string) => (v: unknown): string => (isUnknown(v) ? EMPTY : `${v}${unit}`);
const feature = (v: unknown): string => FEATURE_LABEL[String(v)] ?? EMPTY;
const ecoTax = (v: unknown): string => (v ? '対象' : '対象外');

export function buildComparison(grades: ComparisonRow[]): ComparisonSection[] {
  if (grades.length === 0) return [];

  const g = <T,>(pick: (row: ComparisonRow) => T): T[] => grades.map(pick);
  const dim = (key: keyof Dimensions) =>
    g((r) => (r.grade.dimensions as Dimensions | null)?.[key]);
  const perf = (key: keyof Performance) =>
    g((r) => (r.grade.performance as Performance | null)?.[key]);
  const fuel = (key: keyof FuelDetail) =>
    g((r) => (r.grade.fuelDetail as FuelDetail | null)?.[key]);

  const featureRow = (column: FeatureColumn) =>
    makeRow(FEATURE_NAME[column], g((r) => r.grade[column]), feature);

  return [
    {
      label: '基本情報',
      rows: [
        makeRow('価格', g((r) => r.grade.price), yen),
        makeRow('ボディタイプ', g((r) => r.bodyType), plain),
        makeRow('発売年月', g((r) => r.grade.releaseDate), plain),
        makeRow('乗車定員', g((r) => r.grade.seating), suffix('人')),
      ],
    },
    {
      label: 'サイズ',
      rows: [
        makeRow('全長 (mm)', dim('length'), plain),
        makeRow('全幅 (mm)', dim('width'), plain),
        makeRow('全高 (mm)', dim('height'), plain),
        makeRow('車両重量 (kg)', g((r) => r.grade.weight), plain),
      ],
    },
    {
      label: 'エンジン・性能',
      rows: [
        makeRow('エンジンタイプ', g((r) => r.grade.engineType), plain),
        makeRow('総排気量 (cc)', g((r) => r.grade.displacement), plain),
        makeRow('最高出力', perf('maxPower'), plain),
        makeRow('最大トルク', perf('maxTorque'), plain),
        makeRow('トランスミッション', g((r) => r.grade.transmission), plain),
        makeRow('駆動方式', g((r) => r.grade.driveSystem), plain),
      ],
    },
    {
      label: '燃費性能',
      rows: [
        makeRow('WLTCモード (km/L)', g((r) => r.grade.wltcMode), suffix(' km/L')),
        makeRow('市街地モード (km/L)', fuel('cityMode'), plain),
        makeRow('高速道路モード (km/L)', fuel('highwayMode'), plain),
        makeRow('航続可能距離 (km)', g((r) => r.grade.cruisingRange), plain),
        makeRow('エコカー減税', g((r) => r.grade.ecoCarTax), ecoTax),
        makeRow('エアバッグ', g((r) => r.grade.airbags), suffix('個')),
      ],
    },
    { label: '安全装備', rows: SAFETY_FEATURES.map(featureRow) },
    { label: '快適装備', rows: COMFORT_FEATURES.map(featureRow) },
  ];
}

export function countDifferent(sections: ComparisonSection[]) {
  const rows = sections.flatMap((s) => s.rows);
  return {
    different: rows.filter((r) => r.state === 'different').length,
    unknown: rows.filter((r) => r.state === 'unknown').length,
    total: rows.length,
  };
}

/**
 * 表示する行を絞る。
 *
 * 1台のときは絞らない。全行が same になるため、絞ると表が空になり
 * 故障のように見える（設計書5章）。
 */
export function visibleSections(
  sections: ComparisonSection[],
  showAll: boolean,
): ComparisonSection[] {
  if (showAll) return sections;

  const single = sections.every((s) => s.rows.every((r) => r.cells.length <= 1));
  if (single) return sections;

  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => r.state === 'different') }))
    .filter((s) => s.rows.length > 0);
}
```

**注意:** `ecoCarTax` は boolean で `false` が正常値である。`isUnknown` は
`false` を不明扱いしない（`null`/`undefined`/`''`/`'unknown'` のみ）。
これを誤ると全グレードのエコカー減税行が `unknown` になる。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/comparison-diff.test.ts`
Expected: PASS。失敗0件、19件以上

- [ ] **Step 5: 全体を確認**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: tsc エラー0件、失敗0件、lint 警告0

- [ ] **Step 6: コミット**

```bash
git add lib/comparison-diff.ts tests/unit/comparison-diff.test.ts
git commit -m "$(cat <<'EOF'
feat: 比較行の三値判定を作る

行の状態を same / different / unknown の三値にする。装備は取り込みが
先送りされており片方だけ既知という状態が起きるため、standard と unknown を
「相違」に含めると「装備が違う」という誤情報になる。

判定は生値で行い、表示用の整形は別に持つ。現行の比較表は比較前に
「¥3,998,500」へ整形しており、そこに sameValue を当てると numeric 文字列を
吸収するという共有の理由自体が成立しない。

行の定義（ラベル・順序・整形規則）は現行の ComparisonTable からそのまま
写した。行は足していない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 比較表を差分表示にする

`ComparisonTable` を `buildComparison` の結果を描画するだけにし、切り替えUIと表頭の改善を入れる。

**Files:**
- Modify: `components/ComparisonTable.tsx`
- Modify: `components/CompareListClient.tsx`

**Interfaces:**
- Consumes: `buildComparison`, `countDifferent`, `visibleSections`, `ComparisonSection`（Task 2）
- Produces: `ComparisonTable` の props に `showAll: boolean` と `onToggleShowAll: () => void` が増える

- [ ] **Step 1: ComparisonTable を書き換える**

判定ロジックを全て削除し、`buildComparison` の結果を描画する。次を守る。

**表頭に `powertrain` と駆動方式を足す**（設計書4.0）。現在は
`メーカー / 車種名 / グレード名` の3行だけで、プリウスの `Z` を3つ並べると
全部「トヨタ / プリウス / Z」になり列を区別できない。

```tsx
<div>
  <p className="text-sm">{row.manufacturer}</p>
  <p className="font-bold">{row.modelName}</p>
  <p className="text-xs">{row.grade.name}</p>
  {/* 同名グレードを見分けるために要る。プリウスには Z が3つある */}
  <p className="text-xs opacity-80">{row.grade.powertrain}</p>
  <p className="text-xs opacity-80">{row.grade.driveSystem}</p>
</div>
```

**相違行に色を付ける。ただし色だけに頼らない**（設計書9章のアクセシビリティ）。
`showAll` のときだけ意味があるので、`different` の行に薄い背景を付ける。

**セクション見出しは `visibleSections` が返したものだけ描く。**
差分0件のセクションは `visibleSections` が既に落としている。

- [ ] **Step 2: 切り替えUIを足す**

表の上に置く。`aria-checked` を付け、キーボードで操作できるようにする。

```tsx
<div className="mb-4 flex items-center gap-4">
  <button
    type="button"
    role="switch"
    aria-checked={!showAll}
    onClick={onToggleShowAll}
    className="..."
  >
    {showAll ? 'すべて表示中' : '違いのみ表示中'}
  </button>
  <p className="text-sm text-gray-700">
    {total}項目中 {different}項目が異なります
    {unknown > 0 && `（うち${unknown}項目は情報が不足しています）`}
  </p>
</div>
```

**「36項目が同じです」とは書かない**（設計書4.2）。`unknown` を含む行があるときは
但し書きを添える。

1台のときは切り替えを `disabled` にし、「もう1台追加すると違いを表示できます」と出す。

- [ ] **Step 3: CompareListClient に状態を持たせる**

```tsx
const [showAll, setShowAll] = useState(false);
```

`ComparisonTable` に渡す。既存の共有・クリア機能は変えない。

- [ ] **Step 4: 型検査とビルド**

Run: `npx tsc --noEmit && npm run build && npm run lint`
Expected: tsc エラー0件、build 成功、lint 警告0

- [ ] **Step 5: 既存テストの回帰確認**

Run: `npm test && npm run test:integration`
Expected: 失敗0件

- [ ] **Step 6: 実データでスモークテスト**

```bash
npm run dev &
```

起動後、次のURLを開いて目視で確認する。

```
http://localhost:3000/compare?cars=toyota/prius/z-20hv-ff,toyota/prius/z-20hv-4wd
```

Run: 上記URLをブラウザまたは curl で開く
Expected:
- 既定で相違行だけが出る。**価格・駆動方式・車両重量・WLTCモード**が含まれる
- 「40項目中 N項目が異なります」が出る
- 表頭に `2.0L ハイブリッド車` と `FF` / `4WD` が出て、2列を区別できる
- 切り替えると40行すべてが出る

3列でも確認する。

```
http://localhost:3000/compare?cars=toyota/prius/z-20phev-ff,toyota/prius/z-20hv-ff,toyota/prius/z-20hv-4wd
```

Run: 上記URLを開く
Expected: 表頭が全部「トヨタ / プリウス / Z」ではなく、パワートレインと駆動方式で
区別できる。3列とも別のグレードだと分かる

**確認したら dev サーバーを止める。**

- [ ] **Step 7: コミット**

```bash
git add components/ComparisonTable.tsx components/CompareListClient.tsx
git commit -m "$(cat <<'EOF'
feat: 比較表を差分表示にし、表頭で同名グレードを区別できるようにする

既定で相違行だけを表示し、切り替えで全40項目に戻せるようにした。判定は
lib/comparison-diff.ts が持ち、この component は描画に専念する。

表頭に powertrain と駆動方式を足した。従来は メーカー/車種名/グレード名 の
3行だけで、プリウスの Z を3つ並べると全部「トヨタ/プリウス/Z」になり列を
区別できなかった。サブプロジェクト2で同名グレード問題を構造的に解決したのに、
比較画面で可視化されていなかった。

相違は色だけで示さない。「違いのみ表示」という絞り込みそのものと相違件数の
表示を主要な手掛かりにし、背景色は補助にとどめる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
