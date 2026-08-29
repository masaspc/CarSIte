# 収集パイプラインの有人化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 収集パイプラインからLLM抽出を外し、週次ジョブはPDFの変更検知だけを無人で行い、諸元の取り込みは `ingest-spec` を通じた有人操作にする。`ANTHROPIC_API_KEY` 無しでパイプラインが完結する状態にする。

**Architecture:** `ExtractedSpec` という型を継ぎ目として、その生産者をLLMから「人が読んで書いたJSON」に差し替える。下流（`normalizeGrades` → `computeChanges` → `change_requests` → 承認 → `applyChangeRequest`）は一切変えない。装備と価格は諸元表に載っていないため比較対象から外す。

**Tech Stack:** TypeScript / Node 22 / Drizzle ORM / Neon Postgres / Vitest / Zod

**Spec:** `docs/superpowers/specs/2026-08-14-collection-pipeline-design.md`（6.0 節が今回の改訂）

## Global Constraints

- **既存テストの期待値を緩めない。** 通らない場合は実装を直す
- **DBは103グレード・全件 `draft` が正しい状態。** 各タスクの終わりに戻っていることを確認する
- 統合テストは実DBに接続する。作った行は `afterEach` で必ず消す
- 統合テストは `collect()` に `sourceIds` を渡し、自分が作ったソースだけを処理する。渡さないと本物の `spec_sources`（プリウス・ヤリス）まで処理して実データを汚す
- `npm run lint` は警告0で通ること。`npx tsc --noEmit` はエラー0件
- コミットは `git add` の対象を明示指定する。`git add -A` は使わない

---

## Task 1: 装備と価格を比較対象から外せるようにする

`computeChanges` に比較オプションを足す。諸元表には装備の色分けも車両本体価格も載っていないため、それらを null として比較すると毎回・全グレードに空振りの変更が立つ。既定は現状のままにして後方互換を保つ。

**Files:**
- Modify: `pipeline/diff.ts`
- Test: `tests/unit/diff.test.ts`

**Interfaces:**
- Consumes: `ExistingGrade`, `NormalizedGrade`, `ChangeDraft`（すべて `pipeline/diff.ts` に既存）
- Produces:
  - `export interface CompareOptions { comparePrice?: boolean; compareFeatures?: boolean }`
  - `computeChanges(existing: ExistingGrade[], incoming: NormalizedGrade[], options?: CompareOptions): ChangeDraft[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/diff.test.ts` の末尾に追加する。

```ts
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

  it('new_grade の diff からも装備と価格が外れる', () => {
    const changes = computeChanges([], [incoming()], {
      comparePrice: false,
      compareFeatures: false,
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_grade');
    expect(changes[0].diff).not.toHaveProperty('price');
    expect(Object.keys(changes[0].diff).some((k) => k.startsWith('features.'))).toBe(false);
    // 同定に要る項目は残っている
    expect(changes[0].diff).toHaveProperty('name');
    expect(changes[0].diff).toHaveProperty('powertrain');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: FAIL 5件（`computeChanges` が3つ目の引数を受け取らないため、オプションが無視されて期待値と食い違う）

- [ ] **Step 3: 実装する**

`pipeline/diff.ts` を次のように変える。

まず `computeChanges` の直前にインターフェースを足す。

```ts
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
```

`computeChanges` の署名とオプションの受け取りを変える。

```ts
export function computeChanges(
  existing: ExistingGrade[],
  incoming: NormalizedGrade[],
  options: CompareOptions = {},
): ChangeDraft[] {
  const comparePrice = options.comparePrice ?? true;
  const compareFeatures = options.compareFeatures ?? true;
```

`new_grade` を作っている箇所を変える。

```ts
    if (!found) {
      changes.push({
        kind: 'new_grade',
        targetKey: gradeKey(row),
        diff: newGradeDiff(row, { comparePrice, compareFeatures }),
      });
      continue;
    }
```

`price_change` を立てている箇所を条件で囲む。

```ts
    if (comparePrice && !sameValue(found.price, row.price)) {
      changes.push({
        kind: 'price_change',
        targetKey: gradeKey(row),
        diff: { price: { before: found.price ?? null, after: row.price } },
      });
    }

    const specDiff = specChanges(found, row, compareFeatures);
```

`newGradeDiff` の署名を変える。

```ts
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
```

**注意:** 元の `fields` 配列には `'price'` が含まれている。上のコードでは配列から外し、`options.comparePrice` の分岐で足している。配列に残したままだと `comparePrice: false` でも price が入る。

`specChanges` の署名を変える。

```ts
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
```

以降の装備ループは変えない。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: PASS。失敗0件、30件以上

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、失敗0件・255件以上

- [ ] **Step 6: コミット**

```bash
git add pipeline/diff.ts tests/unit/diff.test.ts
git commit -m "$(cat <<'EOF'
feat: computeChanges に比較オプションを足す

諸元表には車両本体価格も装備の色分けも載っていない。載っていないものを
null として比較すると「値が消えた」と解釈され、毎回・全グレードに
空振りの price_change と装備の spec_change が立つ。

comparePrice / compareFeatures で比較対象を絞れるようにした。既定は
両方 true なので、全項目を持つ入力ではこれまでどおり動く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 抽出スキーマの装備を任意にする

人が読んで書くJSONは装備を持たない。`ExtractedGradeSchema` が20項目すべてを必須にしているため、そのままでは検証を通せない。

**Files:**
- Modify: `pipeline/extraction-schema.ts`
- Modify: `pipeline/diff.ts`
- Test: `tests/unit/extraction-schema.test.ts`

**Interfaces:**
- Consumes: `FEATURE_COLUMNS`, `FEATURE_AVAILABILITIES`（`db/schema.ts` / `db/enums.ts`）
- Produces: `ExtractedGrade.features` が `Record<string, string> | undefined` になる。`normalizeGrades` は features が無い入力に対して `{}` を返す

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/extraction-schema.test.ts` の末尾に追加する。

```ts
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
```

`tests/unit/diff.test.ts` にも追加する。

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/unit/extraction-schema.test.ts tests/unit/diff.test.ts`
Expected: FAIL。「features を省略しても検証を通る」が `features` 必須で落ち、`normalizeGrades` のテストも `undefined` が返って落ちる

- [ ] **Step 3: スキーマを変える**

`pipeline/extraction-schema.ts` の `ExtractedGradeSchema` の `features` を任意にする。

```ts
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
```

- [ ] **Step 4: normalizeGrades を変える**

`pipeline/diff.ts` の `normalizeGrades` の該当行を変える。

```ts
    features: (grade.features ?? {}) as Record<string, string>,
```

- [ ] **Step 5: LLM向けJSONスキーマでは必須のままにする**

`extractionJsonSchema()` は `ExtractedSpecSchema` から生成しているため、そのままだと `features` が任意になってモデルが省略しうる。生成後に必須へ戻す。`pipeline/extraction-schema.ts` の `extractionJsonSchema` を次のようにする。

```ts
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
  if (required && !required.includes('features')) required.push('features');

  return schema;
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run tests/unit/extraction-schema.test.ts tests/unit/diff.test.ts`
Expected: PASS。失敗0件

- [ ] **Step 7: 全体を確認**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、失敗0件

- [ ] **Step 8: コミット**

```bash
git add pipeline/extraction-schema.ts pipeline/diff.ts tests/unit/extraction-schema.test.ts tests/unit/diff.test.ts
git commit -m "$(cat <<'EOF'
feat: 抽出スキーマの装備を任意にする

人が諸元表を読んで書く入力は装備を持たない。装備は色分け（緑=標準/
橙=メーカーOP/青=販売店OP）で表現されており、テキストからは読めない。

features オブジェクト全体を optional にし、normalizeGrades は
省略された場合に空の装備として扱う。LLMに渡すJSONスキーマ側では
生成後に required へ戻し、モデルには従来どおり20項目すべてを要求する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 週次ジョブを変更検知だけにする

`collect.ts` から抽出・差分・承認キューへの追加を外す。PDFが変わったことを `spec_documents` に記録し、原本を保存するところで止める。これで `ANTHROPIC_API_KEY` が不要になる。

**Files:**
- Modify: `scripts/collect.ts`
- Modify: `.github/workflows/collect.yml`
- Test: `tests/integration/collect.test.ts`

**Interfaces:**
- Consumes: `findLatestMonth`, `fetchAndValidate`（`pipeline/fetch.ts`）/ `ensureDecrypted`（`pipeline/decrypt.ts`）/ `countPdfPages`（`pipeline/pdf.ts`）
- Produces:
  - `CollectDeps` から `extraction: ExtractionClient | null` が消える
  - `CollectSummary` が `{ sources, unchanged, detected, failed, needsAttention }` になる（`extracted` / `changesCreated` / `autoApplied` は消える）

- [ ] **Step 1: 失敗するテストを書く**

`tests/integration/collect.test.ts` を書き換える。`fakeExtraction` は不要になるので削除し、次のテストに差し替える。既存の `newSource` / `fakeHttp` / `storageDir` / `countRows` ヘルパはそのまま使う。

```ts
describe('collect — 変更検知', () => {
  it('新しいPDFを spec_documents に記録し、原本を保存する', async () => {
    const { model } = await newSource();
    const dir = await storageDir();

    const summary = await run({ storageDir: dir });

    expect(summary.detected).toBe(1);
    const rows = await countRows(model.id);
    expect(rows.documents).toBe(1);

    // change_requests は作らない。取り込みは ingest-spec が行う
    expect(rows.changes).toBe(0);
    expect(rows.extractions).toBe(0);

    const [document] = await db
      .select({ storedPath: specDocuments.storedPath, sha256: specDocuments.sha256 })
      .from(specDocuments);
    expect(document.storedPath).toContain(dir);
    expect(existsSync(document.storedPath!)).toBe(true);
  });

  it('2回目は変更なしとして扱い、spec_documents が増えない', async () => {
    const { model } = await newSource();
    const dir = await storageDir();

    const first = await run({ storageDir: dir });
    expect(first.detected).toBe(1);

    const second = await run({ storageDir: dir });
    expect(second.detected).toBe(0);
    expect(second.unchanged).toBe(1);

    expect((await countRows(model.id)).documents).toBe(1);
  });

  it('APIキーが無くても動く', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await newSource();
      const summary = await run();
      expect(summary.detected).toBe(1);
      expect(summary.failed).toBe(0);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
```

ファイル先頭の import に `existsSync` を足す。

```ts
import { existsSync, readFileSync } from 'node:fs';
```

`run()` ヘルパから `extraction` を外す。

```ts
async function run(overrides: Partial<Parameters<typeof collect>[0]> = {}) {
  const counters = { gets: 0 };
  return collect({
    http: fakeHttp([NOW], counters),
    decryptor: createQpdfDecryptor(),
    countPages: countPdfPages,
    now: NOW,
    dryRun: false,
    storageDir: await storageDir(),
    log: () => {},
    sourceIds: [...createdSources],
    ...overrides,
  });
}
```

既存の `describe('collect — 同じPDFを二度処理しない')` の2つのテストは、新しい
`describe('collect — 変更検知')` が同じことを検証するため削除する。
`describe('collect — 1件の失敗が全体を止めない')` `describe('collect — 取得不能を人間に上げる')`
`describe('collect — dry-run')` の3つは残すが、`summary.extracted` を参照している箇所を
`summary.detected` に変える。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test:integration -- tests/integration/collect.test.ts`
Expected: FAIL。`summary.detected` が `undefined` で、`extraction` が必須のため型エラーも出る

- [ ] **Step 3: collect.ts の型を変える**

`CollectDeps` から `extraction` を削除する。

```ts
export interface CollectDeps {
  http: Http;
  /** 諸元表は編集制限で暗号化されている。保存する原本は暗号化されたままにする */
  decryptor: Decryptor;
  /** 'YYYY-MM'。年月探索と鮮度判定の基準 */
  now: string;
  dryRun: boolean;
  storageDir: string;
  log: (message: string) => void;
  sourceIds?: string[];
}
```

`CollectSummary` を変える。

```ts
export interface CollectSummary {
  sources: number;
  /** 前回と同じ内容だったもの */
  unchanged: number;
  /** 内容が変わっていて spec_documents に記録したもの */
  detected: number;
  failed: number;
  needsAttention: number;
}
```

- [ ] **Step 4: 抽出以降を削除する**

`collectOne` の戻り値の型を変える。

```ts
type OneOutcome = 'unchanged' | 'needs_attention' | 'detected';
```

`spec_documents` に insert したあとの処理を、すべて次に置き換える。
（現行の「4. 抽出する」から「7. 成功したので…」の直前までを丸ごと消す）

```ts
  await db
    .insert(specDocuments)
    .values({
      specSourceId: source.id,
      pdfUrl: url,
      documentMonth: month,
      sha256: pdf.sha256,
      byteSize: pdf.byteSize,
      pageCount: pdf.pageCount,
      storedPath,
    });

  /*
   * ここで止める。抽出はしない。
   *
   * 主要諸元表はテキストとして読めるのでLLMは要らず、装備一覧表は色で
   * 情報を表しているのでテキストでは読めない（設計書6.0）。無人で
   * できるのは「変わったことを記録して原本を残す」ところまでである。
   * 取り込みは scripts/ingest-spec.ts が有人で行う。
   */
  await db
    .update(specSources)
    .set({
      knownMonth: month,
      lastCheckedAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
    })
    .where(eq(specSources.id, source.id));

  deps.log(`  ${label}: ${month} は前回と内容が違う。取り込み待ち（npm run ingest-spec -- --model-slug <slug>）`);
  return 'detected';
}
```

`collect()` の集計を変える。

```ts
    try {
      const outcome = await collectOne(source, deps, label);
      if (outcome === 'unchanged') summary.unchanged += 1;
      if (outcome === 'needs_attention') summary.needsAttention += 1;
      if (outcome === 'detected') summary.detected += 1;
    } catch (error) {
```

`summary` の初期値を変える。

```ts
  const summary: CollectSummary = {
    sources: 0,
    unchanged: 0,
    detected: 0,
    failed: 0,
    needsAttention: 0,
  };
```

- [ ] **Step 5: 不要になった import と関数を消す**

**`pipeline/extract.ts` と `pipeline/extraction-schema.ts` は削除しない。**
`collect.ts` からの import を外すだけである。装備確認を行う段階で、プロンプトと
Structured Outputs の定義がそのまま使える（設計書6.0.4）。
`tests/unit/extract.test.ts` も残す。使われていないように見えても消さないこと。

同じ理由で `pipeline/approval-rules.ts` も残す。`ingest-spec` が使う。

`scripts/collect.ts` から次を削除する。

- `import { applyChangeRequest } from '@/pipeline/apply';`
- `import { decideApproval } from '@/pipeline/approval-rules';`
- `import { computeChanges, gradeKey, normalizeGrades, type ExistingGrade } from '@/pipeline/diff';`
- `import { EXTRACTION_MODEL, createAnthropicClient, extractSpec, type ExtractionClient } from '@/pipeline/extract';`
- `db/schema` の import から `FEATURE_COLUMNS`, `changeRequests`, `extractions`, `grades`, `models` のうち使わなくなるもの（`models` は残る。ラベル表示に使っている）
- `loadExistingGrades` 関数
- ファイル末尾の `export { currentMonth, gradeKey };` を `export { currentMonth };` にする

**注意:** `gradeKey` を export から外すため、`gradeKey` を `scripts/collect.ts` から import しているコードが無いことを確認する（`grep -rn "from '@/scripts/collect'" --include=*.ts .`）。

- [ ] **Step 6: main() からAPIキーの要求を消す**

```ts
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sourceIds = parseSourceIds(process.argv);

  console.log(dryRun ? '収集（dry-run: 書き込みません）' : 'PDFの変更を確認します');

  const summary = await collect({
    http: createFetchHttp(),
    decryptor: createQpdfDecryptor(),
    countPages: countPdfPages,
    now: currentMonth(),
    dryRun,
    storageDir: DEFAULT_STORAGE_DIR,
    log: (message) => console.log(message),
    sourceIds,
  });

  console.log(
    `対象 ${summary.sources} 件 / 変更なし ${summary.unchanged} / ` +
      `変更あり ${summary.detected} / 失敗 ${summary.failed} / 要確認 ${summary.needsAttention}`,
  );

  if (summary.detected > 0) {
    console.log('変更のあった車種は npm run ingest-spec で取り込んでください');
  }
  if (summary.needsAttention > 0) {
    console.log(`${NEEDS_ATTENTION} 人間の確認が必要な取得元があります。spec_sources.last_error を見てください`);
  }
}
```

- [ ] **Step 7: ワークフローからAPIキーを外す**

`.github/workflows/collect.yml` の `env` から `ANTHROPIC_API_KEY` の行を削除する。

```yaml
      - run: npm run collect
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx tsc --noEmit && npm run test:integration -- tests/integration/collect.test.ts`
Expected: tsc エラー0件、PASS。失敗0件

- [ ] **Step 9: コミット**

```bash
git add scripts/collect.ts .github/workflows/collect.yml tests/integration/collect.test.ts
git commit -m "$(cat <<'EOF'
feat: 週次ジョブを変更検知だけにする

主要諸元表はテキストとして読めるのでLLMは要らず、装備一覧表は色で情報を
表しているのでテキストでは読めない（設計書6.0）。無人でできるのは
「変わったことを記録して原本を残す」ところまでである。

collect.ts から抽出・差分・承認キューへの追加を外した。ANTHROPIC_API_KEY は
不要になり、GitHub Actions の env からも消した。取り込みは ingest-spec が
有人で行う。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ingest-spec で諸元を取り込む

人が諸元表を読んで書いたJSONを受け取り、既存の差分・承認フローに乗せる。

**Files:**
- Create: `scripts/ingest-spec.ts`
- Modify: `package.json`
- Test: `tests/integration/ingest-spec.test.ts`

**Interfaces:**
- Consumes: `ExtractedSpecSchema`（`pipeline/extraction-schema.ts`）/ `normalizeGrades`, `computeChanges`（`pipeline/diff.ts`、Task 1・2 で変更済み）/ `decideApproval`（`pipeline/approval-rules.ts`）
- Produces:
  - `export interface IngestResult { modelName: string; specDocumentId: string; created: number; skipped: number }`
  - `export async function ingestSpec(modelSlug: string, spec: unknown): Promise<IngestResult>`
  - `npm run ingest-spec -- --model-slug <slug> [--file <path>]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/integration/ingest-spec.test.ts` を作る。

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, extractions, grades, models, specDocuments, specSources } from '@/db/schema';
import { ingestSpec } from '@/scripts/ingest-spec';

const createdModels: string[] = [];

afterEach(async () => {
  for (const id of createdModels.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function newModelWithDocument() {
  const token = rand();
  const [model] = await db
    .insert(models)
    .values({
      manufacturer: `テスト自動車${token}`,
      manufacturerSlug: `test-${token}`,
      name: `テスト車種${token}`,
      slug: `model-${token}`,
      bodyType: 'セダン',
    })
    .returning();
  createdModels.push(model.id);

  const [source] = await db
    .insert(specSources)
    .values({ modelId: model.id, pdfBaseUrl: `https://example.com/${token}/spec_` })
    .returning();

  const [document] = await db
    .insert(specDocuments)
    .values({
      specSourceId: source.id,
      pdfUrl: 'https://example.com/spec_202607.pdf',
      documentMonth: '2026-07',
      sha256: `${rand()}${rand()}${rand()}${rand()}`,
      byteSize: 455_398,
      pageCount: 6,
    })
    .returning();

  return { model, source, document };
}

const spec = (overrides: Record<string, unknown> = {}) => ({
  modelName: 'テスト車種',
  grades: [
    {
      name: 'Z',
      powertrain: '2.0L ハイブリッド車',
      driveSystemRaw: '2WD',
      typeDesignation: '6AA-TEST-A',
      price: null,
      seating: 5,
      weight: 1420,
      displacement: 1986,
      wltcMode: 28.4,
      engineType: 'ハイブリッド',
      transmission: '電気式無段変速機',
    },
  ],
  ...overrides,
});

async function changesOf(documentId: string) {
  return db.select().from(changeRequests).where(eq(changeRequests.specDocumentId, documentId));
}

describe('ingestSpec', () => {
  it('新しいグレードを change_requests に積む', async () => {
    const { model, document } = await newModelWithDocument();

    const result = await ingestSpec(model.slug, spec());

    expect(result.created).toBe(1);
    expect(result.specDocumentId).toBe(document.id);

    const rows = await changesOf(document.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('new_grade');
    expect(rows[0].status).toBe('pending');
  });

  it('価格と装備は diff に含めない（諸元表に無いため）', async () => {
    const { model, document } = await newModelWithDocument();

    await ingestSpec(model.slug, spec());

    const [row] = await changesOf(document.id);
    const diff = row.diff as Record<string, unknown>;
    expect(diff).not.toHaveProperty('price');
    expect(Object.keys(diff).some((k) => k.startsWith('features.'))).toBe(false);
    expect(diff).toHaveProperty('typeDesignation');
  });

  it('二度取り込んでも change_requests が重複しない', async () => {
    const { model, document } = await newModelWithDocument();

    const first = await ingestSpec(model.slug, spec());
    const second = await ingestSpec(model.slug, spec());

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await changesOf(document.id)).toHaveLength(1);
  });

  it('extractions に手動の記録を残す', async () => {
    const { model, document } = await newModelWithDocument();

    await ingestSpec(model.slug, spec());

    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.specDocumentId, document.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].modelIdUsed).toBe('manual');
    expect(rows[0].succeeded).toBe(true);
    expect(rows[0].inputTokens).toBeNull();
  });

  it('壊れたJSONは取り込まず、何も書かない', async () => {
    const { model, document } = await newModelWithDocument();

    await expect(ingestSpec(model.slug, { modelName: 'x', grades: [] })).rejects.toThrow(
      /検証に失敗/,
    );

    expect(await changesOf(document.id)).toHaveLength(0);
    const rows = await db
      .select()
      .from(extractions)
      .where(eq(extractions.specDocumentId, document.id));
    expect(rows).toHaveLength(0);
  });

  it('spec_documents が無い車種は取り込めない', async () => {
    const token = rand();
    const [model] = await db
      .insert(models)
      .values({
        manufacturer: `テスト自動車${token}`,
        manufacturerSlug: `test-${token}`,
        name: `テスト車種${token}`,
        slug: `model-${token}`,
        bodyType: 'セダン',
      })
      .returning();
    createdModels.push(model.id);

    await expect(ingestSpec(model.slug, spec())).rejects.toThrow(/諸元表がまだ取得されていません/);
  });

  it('既存グレードと内容が同じなら変更を立てない', async () => {
    const { model, document } = await newModelWithDocument();
    await db.insert(grades).values({
      modelId: model.id,
      name: 'Z',
      slug: `z-${rand()}`,
      price: 3_200_000,
      engineType: 'ハイブリッド',
      driveSystem: 'FF',
      seating: 5,
      powertrain: '2.0L ハイブリッド車',
      typeDesignation: '6AA-TEST-A',
      weight: 1420,
      displacement: 1986,
      wltcMode: '28.4',
      transmission: '電気式無段変速機',
    });

    const result = await ingestSpec(model.slug, spec());

    expect(result.created).toBe(0);
    expect(await changesOf(document.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test:integration -- tests/integration/ingest-spec.test.ts`
Expected: FAIL — `Cannot find package '@/scripts/ingest-spec'`

- [ ] **Step 3: 実装する**

`scripts/ingest-spec.ts` を作る。

```ts
import '../load-env';
import { readFileSync } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  FEATURE_COLUMNS,
  changeRequests,
  extractions,
  grades,
  models,
  specDocuments,
  specSources,
} from '@/db/schema';
import { ExtractedSpecSchema } from '@/pipeline/extraction-schema';
import { computeChanges, normalizeGrades, type ExistingGrade } from '@/pipeline/diff';
import { decideApproval } from '@/pipeline/approval-rules';

/**
 * 人が諸元表を読んで書いたJSONを取り込む。
 *
 * 週次ジョブ（scripts/collect.ts）はPDFが変わったことを spec_documents に
 * 記録するところまでしか行わない。そこから先、諸元を読み取る工程は
 * 対話セッションの Claude が行い、結果をこのスクリプトに渡す（設計書6.0.2）。
 *
 * 差分・承認・冪等な適用は既存の経路をそのまま通る。変わるのは
 * ExtractedSpec の生産者だけである。
 */
export class IngestError extends Error {}

export interface IngestResult {
  modelName: string;
  specDocumentId: string;
  /** 新しく積んだ change_requests の件数 */
  created: number;
  /** 既に同じものが積まれていて飛ばした件数 */
  skipped: number;
}

/**
 * 諸元表には車両本体価格も装備の色分けも載っていないため比較しない。
 * 載っていないものを null として比較すると、毎回・全グレードに
 * 空振りの変更が立つ（設計書6.0.3）。
 */
const COMPARE_OPTIONS = { comparePrice: false, compareFeatures: false } as const;

export async function ingestSpec(modelSlug: string, spec: unknown): Promise<IngestResult> {
  const found = await db
    .select({ id: models.id, name: models.name, manufacturer: models.manufacturer })
    .from(models)
    .where(eq(models.slug, modelSlug));

  if (found.length === 0) {
    throw new IngestError(`slug "${modelSlug}" の車種が見つかりません`);
  }
  if (found.length > 1) {
    throw new IngestError(
      `slug "${modelSlug}" が複数の車種に一致します。models.slug はメーカー内でしか一意でないため絞り込めません`,
    );
  }
  const model = found[0];

  // 最新の spec_document に紐づける。change_requests.spec_document_id は NOT NULL
  const [document] = await db
    .select({ id: specDocuments.id, documentMonth: specDocuments.documentMonth })
    .from(specDocuments)
    .innerJoin(specSources, eq(specDocuments.specSourceId, specSources.id))
    .where(eq(specSources.modelId, model.id))
    .orderBy(desc(specDocuments.documentMonth), desc(specDocuments.fetchedAt))
    .limit(1);

  if (!document) {
    throw new IngestError(
      `${model.manufacturer} ${model.name} の諸元表がまだ取得されていません。` +
        '先に npm run collect を実行してください',
    );
  }

  // 検証に落ちたら何も書かない。半分正しいデータは全部間違っているより見つけにくい
  const parsed = ExtractedSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new IngestError(
      `諸元データの検証に失敗しました: ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }

  const existing = await loadExistingGrades(model.id);
  const drafts = computeChanges(existing, normalizeGrades(parsed.data), COMPARE_OPTIONS);

  await db.insert(extractions).values({
    specDocumentId: document.id,
    // LLM経由と区別できるようにする。監査証跡の形は揃える
    modelIdUsed: 'manual',
    rawOutput: parsed.data as never,
    inputTokens: null,
    outputTokens: null,
    succeeded: true,
    error: null,
  });

  let created = 0;
  let skipped = 0;

  for (const draft of drafts) {
    const decision = decideApproval(draft, {
      totalGrades: existing.length,
      priceChangeCount: 0,
    });

    const [row] = await db
      .insert(changeRequests)
      .values({
        specDocumentId: document.id,
        kind: draft.kind,
        targetKey: draft.targetKey,
        diff: draft.diff,
        status: decision.auto ? 'approved' : 'pending',
        reason: decision.auto ? null : decision.reason,
        decidedBy: decision.auto ? 'system' : null,
        decidedAt: decision.auto ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: changeRequests.id });

    if (row) created += 1;
    else skipped += 1;
  }

  return { modelName: model.name, specDocumentId: document.id, created, skipped };
}

async function loadExistingGrades(modelId: string): Promise<ExistingGrade[]> {
  const rows = await db.select().from(grades).where(eq(grades.modelId, modelId));

  return rows.map((row) => {
    const features: Record<string, string> = {};
    for (const column of FEATURE_COLUMNS) {
      features[column] = row[column];
    }
    return {
      id: row.id,
      typeDesignation: row.typeDesignation,
      name: row.name,
      powertrain: row.powertrain,
      driveSystem: row.driveSystem,
      price: row.price,
      seating: row.seating,
      weight: row.weight,
      displacement: row.displacement,
      wltcMode: row.wltcMode,
      engineType: row.engineType,
      transmission: row.transmission,
      discontinuedAt: row.discontinuedAt,
      features,
    };
  });
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelSlug = args['model-slug'];
  if (!modelSlug) {
    throw new IngestError(
      '使い方: npm run ingest-spec -- --model-slug <slug> [--file <path>]',
    );
  }

  // 既定の置き場所。tests/fixtures に置くのは、テストからも参照して
  // 「何をどう読んだか」を検証できるようにするため
  const file = args.file ?? `tests/fixtures/${modelSlug}.spec.json`;
  const spec = JSON.parse(readFileSync(file, 'utf8'));

  const result = await ingestSpec(modelSlug, spec);

  console.log(
    `${result.modelName}: 変更 ${result.created} 件を積みました（重複で飛ばした分 ${result.skipped} 件）`,
  );
  if (result.created > 0) {
    console.log('/admin/changes で内容を確認して承認してください');
  }
}

if (process.argv[1]?.includes('ingest-spec')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: package.json にスクリプトを足す**

`"register-source"` の次の行に足す。

```json
    "ingest-spec": "tsx scripts/ingest-spec.ts",
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx tsc --noEmit && npm run test:integration -- tests/integration/ingest-spec.test.ts`
Expected: tsc エラー0件、PASS。失敗0件、7件

- [ ] **Step 6: DBが元に戻っていることを確認**

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { sql } from 'drizzle-orm';
void (async () => {
  const { rows } = await db.execute(sql\`
    select (select count(*)::int from grades) g,
           (select count(*)::int from grades where publication_status='draft') d,
           (select count(*)::int from change_requests) c
  \`);
  console.log(rows[0]);
  const r = rows[0] as Record<string, number>;
  if (r.g !== 103 || r.d !== 103 || r.c !== 0) process.exit(1);
})();
"
```

Run: 上のコマンド
Expected: `{ g: 103, d: 103, c: 0 }` が表示され、終了コード0

- [ ] **Step 7: コミット**

```bash
git add scripts/ingest-spec.ts package.json tests/integration/ingest-spec.test.ts
git commit -m "$(cat <<'EOF'
feat: 諸元を有人で取り込む ingest-spec

週次ジョブはPDFが変わったことを記録するところまでしか行わない。
そこから先、諸元を読み取る工程は対話セッションの Claude が行い、
結果のJSONをこのスクリプトに渡す（設計書6.0.2）。

差分・承認・冪等な適用は既存の経路をそのまま通る。変わるのは
ExtractedSpec の生産者だけである。価格と装備は諸元表に載っていないため
比較対象から外す。

extractions には modelIdUsed='manual' で記録を残し、LLM経由と
監査証跡の形を揃える。検証に落ちたら何も書かない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: プリウスを実際に取り込んで通しで確認する

正解データを取り込み用の形に整え、`collect` → `ingest-spec` → 承認 → 適用 を実データで一度通す。

**Files:**
- Create: `tests/fixtures/prius.spec.json`
- Modify: `docs/superpowers/plans/2026-08-14-collection-pipeline.md`（完了条件の達成状況を更新）

**Interfaces:**
- Consumes: `ingestSpec`（Task 4）/ `applyChangeRequest`, `approveChangeRequest`（`pipeline/apply.ts`）

- [ ] **Step 1: 取り込み用の正解データを作る**

`tests/fixtures/prius_spec_202607.expected.json` の `grades` 配列を `ExtractedSpec` の形に写す。
`grossWeight` と `engineCode` は `ExtractedGradeSchema` に無い項目なので落とす。
`driveSystemRaw` はそのまま（`normalizeDriveSystem` が `2WD` → `FF`、`E-Four` → `4WD` に写す）。

`tests/fixtures/prius.spec.json` を作る。

```json
{
  "modelName": "プリウス",
  "grades": [
    { "name": "Z", "powertrain": "2.0L プラグインハイブリッド車", "driveSystemRaw": "2WD", "typeDesignation": "6LA-MXWH61-AHXHB", "price": null, "seating": 5, "weight": 1570, "displacement": 1986, "wltcMode": 25.9, "engineType": "PHEV", "transmission": "電気式無段変速機" },
    { "name": "G", "powertrain": "2.0L プラグインハイブリッド車", "driveSystemRaw": "2WD", "typeDesignation": "6LA-MXWH61-AHXGB", "price": null, "seating": 5, "weight": 1560, "displacement": 1986, "wltcMode": 25.9, "engineType": "PHEV", "transmission": "電気式無段変速機" },
    { "name": "Z", "powertrain": "2.0L ハイブリッド車", "driveSystemRaw": "2WD", "typeDesignation": "6AA-MXWH60-AHXHB", "price": null, "seating": 5, "weight": 1420, "displacement": 1986, "wltcMode": 28.4, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" },
    { "name": "Z", "powertrain": "2.0L ハイブリッド車", "driveSystemRaw": "E-Four", "typeDesignation": "6AA-MXWH65-AHXHB", "price": null, "seating": 5, "weight": 1480, "displacement": 1986, "wltcMode": 26.8, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" },
    { "name": "G", "powertrain": "2.0L ハイブリッド車", "driveSystemRaw": "2WD", "typeDesignation": "6AA-MXWH60-AHXGB", "price": null, "seating": 5, "weight": 1400, "displacement": 1986, "wltcMode": 28.4, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" },
    { "name": "G", "powertrain": "2.0L ハイブリッド車", "driveSystemRaw": "E-Four", "typeDesignation": "6AA-MXWH65-AHXGB", "price": null, "seating": 5, "weight": 1460, "displacement": 1986, "wltcMode": 26.8, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" },
    { "name": "U", "powertrain": "1.8L ハイブリッド車", "driveSystemRaw": "2WD", "typeDesignation": "6AA-ZVW60-AHXKB", "price": null, "seating": 5, "weight": 1360, "displacement": 1797, "wltcMode": 32.6, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" },
    { "name": "U", "powertrain": "1.8L ハイブリッド車", "driveSystemRaw": "E-Four", "typeDesignation": "6AA-ZVW65-AHXKB", "price": null, "seating": 5, "weight": 1420, "displacement": 1797, "wltcMode": 30.7, "engineType": "ハイブリッド", "transmission": "電気式無段変速機" }
  ]
}
```

**注意:** `wltcMode` は原本の「燃料消費率（国土交通省審査値）」の **WLTCモード** の行から取る。
市街地／郊外／高速道路の各モードと取り違えないこと。原本の該当行は次のとおり。

```
km/L   25.9※5   |   28.4［26.8］※6   |   32.6［30.7］
       ^^^^ PHEV      ^^^^ 2.0L HV        ^^^^ 1.8L HV
                      2WD ［E-Four］       2WD ［E-Four］
```

単一の値はそのパワートレイン群の全グレードに適用される（PHEV の 25.9 は Z と G の両方）。
次のコマンドで原本から確認できる。

```bash
pdftotext -layout -f 1 -l 1 tests/fixtures/prius_spec_202607.pdf - | grep -B2 "市街地モード" | head -1
```

- [ ] **Step 2: 原本と一致することを確認するテストを足す**

`tests/unit/golden-pdf.test.ts` の `describe('正解データが原本と一致する')` に追加する。

```ts
  it('取り込み用JSONが正解データと同じ8グレードを指す', () => {
    const ingest = JSON.parse(
      readFileSync(path.resolve(__dirname, '../fixtures/prius.spec.json'), 'utf8'),
    ) as { grades: Array<{ typeDesignation: string; weight: number }> };

    expect(ingest.grades).toHaveLength(expected.gradeCount);

    const wanted = new Set(expected.grades.map((g) => g.typeDesignation));
    for (const grade of ingest.grades) {
      expect(wanted).toContain(grade.typeDesignation);
    }

    const byType = new Map(expected.grades.map((g) => [g.typeDesignation, g.weight]));
    for (const grade of ingest.grades) {
      expect(grade.weight).toBe(byType.get(grade.typeDesignation));
    }
  });
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npx vitest run tests/unit/golden-pdf.test.ts`
Expected: PASS。失敗0件、12件以上（1件 skip）

- [ ] **Step 4: 実データで取り込みまで通す**

**【2026-08-29 修正】** 当初の Step 4〜6 は `new_grade` を `applied` まで進める前提だったが、
それは成立しない。理由は下記「価格の壁」を読むこと。

```bash
npm run collect
npm run ingest-spec -- --model-slug prius
```

Run: 上の2コマンド
Expected: `collect` はプリウスとヤリスを確認する（既に `spec_documents` があれば
「前回と同じ内容」と出る。それでよい）。`ingest-spec` が
「プリウス: 変更 9 件を積みました」と出す（`new_grade` 8件 + `discontinued` 1件）

- [ ] **Step 5: 承認キューに積まれたことを確認する**

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { sql } from 'drizzle-orm';
void (async () => {
  const { rows } = await db.execute(sql\`
    select kind, status, count(*)::int n from change_requests group by 1,2 order by 1\`);
  console.log(rows);
  const { rows: g } = await db.execute(sql\`
    select (select count(*)::int from grades) total,
           (select count(*)::int from grades where publication_status='draft') drafts\`);
  console.log(g[0]);
})();
"
```

Run: 上のコマンド
Expected:
```
[ { kind: 'discontinued', status: 'pending', n: 1 },
  { kind: 'new_grade', status: 'pending', n: 8 } ]
{ total: 103, drafts: 103 }
```

**`grades` は103件のまま**である。承認していないので適用されていない。これが正しい。

### 価格の壁（このタスクで確定した事実）

`new_grade` を承認して適用しようとすると `stale` になる。バグではない。

`grades.price` は NOT NULL である。価格は公開ページの絞り込みと並び替えの軸であり、
0 や仮の値を入れれば「安い順」が壊れる。一方、諸元表に車両本体価格は載っていない
（原本に「価格は販売店が独自に定めていますので、詳しくは各販売店にお尋ねください」）。
メーカーの価格ページも画像かJS描画で、機械的に取得できない（設計書7.4）。

したがって次が成り立つ。

> **諸元表からの取り込みは、既存グレードの諸元を更新できる。
> しかし新しいグレードを作ることはできない。作成には価格が要るため。**

`pipeline/apply.ts` の `buildNewGradeValues` が価格の無い `new_grade` を拒むのは
**正しい挙動**である。価格を推測して入れるより、承認キューに残して人間に見せるほうがよい。

**このタスクでは `new_grade` を承認しないこと。** 承認すると `stale` になり、
一意制約のせいで再取り込みもできなくなる。

- [ ] **Step 6: 設計書に帰結を書く**

`docs/superpowers/specs/2026-08-14-collection-pipeline-design.md` の 7.4 の末尾に追記する。

```markdown
**2026-08-29 追記: 実データで確定した帰結。**

プリウスの諸元表8グレードを実際に取り込んだ結果、`new_grade` は適用できないことが
分かった。`grades.price` が NOT NULL であり、諸元表に価格が無いためである。
`pipeline/apply.ts` の `buildNewGradeValues` が価格の無い作成を拒む。

つまり**諸元表からの取り込みは既存グレードの諸元更新に限られる**。新規グレードの
作成には価格の取得元（案B）か、管理画面での人手入力が要る。
プリウスの8件は承認キューに `pending` のまま残してある。
```

- [ ] **Step 7: 全体を確認**

Run: `npx tsc --noEmit && npm test && npm run test:integration && npm run build && npm run lint`
Expected: tsc エラー0件、単体・統合とも失敗0件、build 成功、lint 警告0

**`tests/integration/grade-identity.test.ts` の期待値は103のまま変更しない。**
実データが増えていないので変える理由が無い。

- [ ] **Step 8: 完了条件の達成状況を更新する**

`docs/superpowers/plans/2026-08-14-collection-pipeline.md` の「完了条件の達成状況」表を
設計書の改訂後（5'・11'）に合わせて更新し、価格の壁を「残る課題」として記載する。

- [ ] **Step 9: コミット**

```bash
git add tests/fixtures/prius.spec.json tests/unit/golden-pdf.test.ts docs/superpowers/specs/2026-08-14-collection-pipeline-design.md docs/superpowers/plans/2026-08-14-collection-pipeline.md
git commit -m "$(cat <<'EOF'
feat: プリウスの諸元を取り込み、価格の壁を確定させる

原本から起こした8グレードを ingest-spec で取り込んだ。APIキーは使っていない。
承認キューに new_grade 8件と discontinued 1件が pending で積まれた。

ここで設計上の帰結が確定した。new_grade は適用できない。grades.price が
NOT NULL であり、諸元表に車両本体価格が載っていないためである。価格は公開ページの
絞り込みと並び替えの軸なので、0 や仮の値を入れれば「安い順」が壊れる。
buildNewGradeValues が価格の無い作成を拒むのは正しい挙動である。

したがって諸元表からの取り込みは既存グレードの諸元更新に限られる。新規作成には
価格の取得元か管理画面での人手入力が要る。設計書7.4に追記した。

grades は103件・全 draft のまま変わっていない。承認していないためである。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 運用手順を書く

週次ジョブが変更を検知したあと、人が何をすればよいかを書く。

**Files:**
- Create: `docs/operations/collect.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: なし（ドキュメントのみ）

- [ ] **Step 1: 運用手順を書く**

`docs/operations/collect.md` に次を書く。

- 週次ジョブが何をするか（変更検知だけ。APIキー不要）
- 変更を検知したときの手順:
  1. `spec_documents` を見て、どの車種のどの年月が変わったかを確認する
  2. `storage/pdfs/<sha256>.pdf` の原本を Claude Code に読ませる
  3. `tests/fixtures/<model-slug>.spec.json` を更新する
  4. `npm run ingest-spec -- --model-slug <slug>`
  5. `/admin/changes` で承認する
- 新しい車種を登録する手順（`npm run register-source`）
- EVを登録できない理由（`wltc_mode` の単位）
- 装備の取り込みは未対応であること、その理由（色分けで表現されており、LLMが要る）
- 価格が取れないこと（設計書7.4）

- [ ] **Step 2: README に導線を足す**

README の該当箇所に `docs/operations/collect.md` へのリンクと、
`npm run collect` / `npm run ingest-spec` / `npm run register-source` の説明を足す。

- [ ] **Step 3: 記述が実物と合っているか確認**

Run: `grep -oE 'npm run [a-z-]+' docs/operations/collect.md README.md | sort -u` の結果が
`package.json` の `scripts` にすべて存在すること
Expected: 存在しないスクリプト名が出ないこと

- [ ] **Step 4: コミット**

```bash
git add docs/operations/collect.md README.md
git commit -m "$(cat <<'EOF'
docs: 収集の運用手順

週次ジョブが変更を検知したあと、人が何をすればよいかを書いた。
原本を読む → JSONを更新 → ingest-spec → 承認、の4手順。

装備が未対応であることと価格が取れないことも、理由つきで明記した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
