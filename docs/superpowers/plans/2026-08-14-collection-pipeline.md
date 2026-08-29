# 収集パイプライン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メーカー公式の諸元表PDFを週1回自動で取得し、Claude で構造化して承認キューに積み、承認されたものだけを公開する仕組みを作る。

**Architecture:** 登録済みPDFベースパス + 年月をHEADで探索して最新版を特定 → sha256 で変更を判定し、変わったものだけ Claude に投入 → 差分を `change_requests` に積む → 価格改定は条件付き自動、それ以外は人間が承認 → 適用して公開。ヘッドレスブラウザは使わない。

**Tech Stack:** Next.js 15.5 / TypeScript / Drizzle ORM 0.45 / Neon Postgres (HTTP driver, **トランザクション無し**) / Zod 4 / Vitest 4 / `@anthropic-ai/sdk` / `unpdf`（PDF.js） / GitHub Actions

**設計書:** `docs/superpowers/specs/2026-08-14-collection-pipeline-design.md`

## Global Constraints

以下は全タスクに適用される。各タスクの要件に暗黙に含まれる。

- **`.env.local` の中身を絶対に表示・出力・コミットしない。** 本番Neonの接続文字列（パスワード込み）が入っている
- **DBの `grades.publication_status` を `published` に変えない。** 全103行が `draft` であるのが正しい状態。テストで一時的に変えた行は、そのテスト内で必ず元に戻す（既存 `tests/integration/publication.test.ts` の `afterAll` が手本）
- **`npm run db:seed -- --force` を実行しない。** neon-http にトランザクションが無いため不可逆
- **`git add -A` を使わない。** 各タスクの「Files:」に挙がったパスだけを明示指定してコミットする
- **既存テストの期待値を緩めない。** ベースラインは unit 99件 / integration 18件。減らしてはいけない
- 既存の103グレードの `slug` を変更しない。公開URLの識別子であり、サブプロジェクト1で「一度発行したら変えない」と決めている
- 列挙値の定義は `db/enums.ts` が唯一の出所。新しい列挙を別ファイルに書き直さない
- 日本語のコメント・エラーメッセージは既存コードの文体に合わせる（「〜である」調の説明、理由を書く）
- `ANTHROPIC_API_KEY` はこの環境に設定されていない。実APIを叩くテストは、キーが無ければ skip する形で書く
- **`npx tsx -e` はCJSに変換されるためトップレベル `await` が使えない。**
  確認用のワンライナーは `void (async () => { ... })();` で包む
  （包まないと `Top-level await is currently not supported with the "cjs" output format` で落ちる）
- **HTTPヘッダの値は ByteString（latin-1）。日本語を入れると `fetch` が
  `Cannot convert argument to a ByteString` で落ちる。** User-Agent などは ASCII で書く。
  この失敗は偽のHTTPを使う単体テストでは再現せず、実際にネットワークへ出て初めて出る
- **PDF.js（`unpdf`）は渡された `Uint8Array` を破壊し、長さ0にする。** `countPdfPages` のように
  バッファを受け取る関数は、必ず `new Uint8Array(bytes)` で複製してから渡すこと
- **`db.execute()` は配列ではなく `{ rows, rowCount, fields, ... }` を返す。** `const [r] = await db.execute(...)`
  は `TypeError: (intermediate value) is not iterable` で落ちる。`const { rows } = await db.execute(...)` と書く。
  素の `neon()` クライアントのタグ付きテンプレートは配列を返すので、そちらは分割代入でよい

---

## Task 1: PDFの年月探索ロジック

登録済みのベースパスに年月を付けてPDFのURLを組み立て、どの年月を試すべきかを決める純粋関数群。ネットワークには触らない。

**Files:**
- Create: `lib/spec-url.ts`
- Test: `tests/unit/spec-url.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `buildPdfUrl(base: string, month: string): string`
  - `parseMonthFromUrl(url: string): string | null`
  - `candidateMonths(current: string, known: string | null, maxLookback?: number): string[]`
  - `monthsBetween(from: string, to: string): number`
  - `isStale(found: string, current: string, thresholdMonths?: number): boolean`
  - 月の表記は一貫して `'YYYY-MM'`（既存の `price_history.date` と同じ形式）

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/spec-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPdfUrl,
  candidateMonths,
  isStale,
  monthsBetween,
  parseMonthFromUrl,
} from '@/lib/spec-url';

const BASE = 'https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_';

describe('buildPdfUrl', () => {
  it('YYYY-MM を YYYYMM に変換して .pdf を付ける', () => {
    expect(buildPdfUrl(BASE, '2026-07')).toBe(
      'https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_202607.pdf',
    );
  });

  it('不正な月表記は受け付けない', () => {
    expect(() => buildPdfUrl(BASE, '202607')).toThrow();
    expect(() => buildPdfUrl(BASE, '2026-13')).toThrow();
  });
});

describe('parseMonthFromUrl', () => {
  it('実在のURLから年月を取り出す', () => {
    expect(parseMonthFromUrl(BASE + '202607.pdf')).toBe('2026-07');
  });

  it('年月を含まないURLは null', () => {
    expect(parseMonthFromUrl('https://example.com/spec.pdf')).toBeNull();
  });
});

describe('candidateMonths', () => {
  it('既知の翌月から今月まで、新しい順に並べる', () => {
    expect(candidateMonths('2026-08', '2026-05')).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('既知が今月と同じなら候補は無い（既知の再確認は呼び出し側の仕事）', () => {
    expect(candidateMonths('2026-08', '2026-08')).toEqual([]);
  });

  it('既知が今月より新しい場合も候補は無い', () => {
    expect(candidateMonths('2026-08', '2026-09')).toEqual([]);
  });

  it('年をまたぐ', () => {
    expect(candidateMonths('2026-02', '2025-11')).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('既知が無い初回は maxLookback か月ぶん遡る', () => {
    const months = candidateMonths('2026-08', null, 3);
    expect(months).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('既知が古すぎても maxLookback で打ち切る', () => {
    // 際限なくHEADを投げないための歯止め
    expect(candidateMonths('2026-08', '2000-01', 4)).toHaveLength(4);
  });
});

describe('monthsBetween', () => {
  it('経過月数を返す', () => {
    expect(monthsBetween('2026-07', '2026-08')).toBe(1);
    expect(monthsBetween('2025-08', '2026-08')).toBe(12);
    expect(monthsBetween('2026-08', '2026-08')).toBe(0);
  });
});

describe('isStale', () => {
  it('18か月以上前なら古いと判定する', () => {
    expect(isStale('2025-01', '2026-08')).toBe(true);
  });

  it('18か月未満なら古くない', () => {
    expect(isStale('2026-07', '2026-08')).toBe(false);
    expect(isStale('2025-03', '2026-08')).toBe(false); // 17か月
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/spec-url.test.ts`
Expected: FAIL（`lib/spec-url.ts` が存在しない）

- [ ] **Step 3: 実装する**

`lib/spec-url.ts`:

```ts
/**
 * 諸元表PDFのURLを、登録済みベースパスと年月から組み立てる。
 *
 * メーカーの諸元ページはJavaScriptで描画されるためHTTPクロールではPDFリンクが取れないが、
 * URLの年月部分だけは規則的である。実測では同時に存在する年月は1つだけで、
 * 古い版は消える（prius_spec_202607.pdf のみ 200、前後の月は 404）。
 * だから「200 が返った年月が最新版」と言い切れる。
 *
 * 一方、ベースパス（.../005_p_001/pdf/prius_spec_）の形は車種ごとに違い推測できない。
 * ここで組み立ててよいのは年月部分だけである。
 */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 既知の年月が無い初回に、何か月ぶん遡って探すか */
const DEFAULT_MAX_LOOKBACK = 24;

/** 見つかった諸元表がこれ以上古いと、探索が外れている可能性を疑う */
const DEFAULT_STALE_MONTHS = 18;

function toIndex(month: string): number {
  const matched = MONTH_PATTERN.exec(month);
  if (!matched) {
    throw new Error(`年月は 'YYYY-MM' 形式で指定してください: ${month}`);
  }
  return Number(matched[1]) * 12 + (Number(matched[2]) - 1);
}

function fromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function buildPdfUrl(base: string, month: string): string {
  const compact = month.replace(MONTH_PATTERN, '$1$2');
  if (compact === month) {
    throw new Error(`年月は 'YYYY-MM' 形式で指定してください: ${month}`);
  }
  return `${base}${compact}.pdf`;
}

export function parseMonthFromUrl(url: string): string | null {
  const matched = /(\d{4})(0[1-9]|1[0-2])\.pdf(?:$|[?#])/.exec(url);
  return matched ? `${matched[1]}-${matched[2]}` : null;
}

/**
 * 試すべき年月を新しい順に返す。
 *
 * 既知の年月がある場合はその翌月から今月まで。既知そのものは含めない —
 * 「もっと新しい版が出ていないか」を調べるのがこの関数の役目で、
 * 既知の生存確認は候補が全て404だったときに呼び出し側が行う。
 */
export function candidateMonths(
  current: string,
  known: string | null,
  maxLookback: number = DEFAULT_MAX_LOOKBACK,
): string[] {
  const currentIndex = toIndex(current);
  const oldestIndex =
    known === null
      ? currentIndex - (maxLookback - 1)
      : Math.max(toIndex(known) + 1, currentIndex - (maxLookback - 1));

  const months: string[] = [];
  for (let index = currentIndex; index >= oldestIndex; index--) {
    months.push(fromIndex(index));
  }
  return months;
}

export function monthsBetween(from: string, to: string): number {
  return toIndex(to) - toIndex(from);
}

export function isStale(
  found: string,
  current: string,
  thresholdMonths: number = DEFAULT_STALE_MONTHS,
): boolean {
  return monthsBetween(found, current) >= thresholdMonths;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/spec-url.test.ts`
Expected: PASS。失敗0件、`tests/unit/spec-url.test.ts` から13件以上

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run: `npm test`
Expected: PASS。失敗0件、合計112件以上（ベースライン99件 + 新規13件以上）

- [ ] **Step 6: コミット**

```bash
git add lib/spec-url.ts tests/unit/spec-url.test.ts
git commit -m "feat: 諸元表PDFの年月探索ロジックを追加"
```

---

## Task 2: PDFの事前検査

取得したPDFをLLMに渡す前に弾くための検査。外部から来るファイルなので、費用の暴発と意図しない文書の読み込みの両方を防ぐ。判定は純粋関数、ページ数の取得だけ `unpdf`（PDF.js）を使う。

**Files:**
- Create: `lib/pdf-guard.ts`
- Create: `pipeline/pdf.ts`
- Modify: `package.json`
- Test: `tests/unit/pdf-guard.test.ts`
- Test: `tests/unit/pipeline-pdf.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `class PdfRejectedError extends Error`
  - `assertPdfAcceptable(input: PdfCandidate): void`（`PdfCandidate = { contentType: string | null; bytes: Uint8Array; pageCount: number }`）
  - `looksLikePdf(bytes: Uint8Array): boolean`
  - `isEncryptedPdf(bytes: Uint8Array): boolean`（拒否はしない。記録用）
  - `MAX_PDF_BYTES`（10 MiB）, `MAX_PDF_PAGES`（50）
  - `countPdfPages(bytes: Uint8Array): Promise<number>`（`pipeline/pdf.ts`）

- [ ] **Step 1: 依存を追加**

```bash
npm install unpdf
```

**`pdf-lib` ではなく `unpdf`（PDF.js のサーバレス向けビルド）を使う。**
実物のトヨタ諸元表は編集制限のために暗号化されており（トレーラに `/Encrypt` がある）、
`pdf-lib` は `ignoreEncryption: true` を付けても本文を復号しないためページツリーの
解決に失敗する。PDF.js は空のユーザーパスワードで復号できる。

```
pdf-lib: Error: Expected instance of PDFDict, but got instance of undefined
unpdf  : 6（正しい）
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/unit/pdf-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PdfRejectedError,
  assertPdfAcceptable,
  looksLikePdf,
} from '@/lib/pdf-guard';

const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n');

function candidate(overrides: Partial<Parameters<typeof assertPdfAcceptable>[0]> = {}) {
  return {
    contentType: 'application/pdf',
    bytes: PDF_HEADER,
    pageCount: 6,
    ...overrides,
  };
}

describe('looksLikePdf', () => {
  it('%PDF- で始まれば真', () => {
    expect(looksLikePdf(PDF_HEADER)).toBe(true);
  });

  it('HTMLのエラーページは偽', () => {
    expect(looksLikePdf(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
  });

  it('空バイト列は偽', () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe('assertPdfAcceptable', () => {
  it('正常な諸元表は通る', () => {
    expect(() => assertPdfAcceptable(candidate())).not.toThrow();
  });

  it('Content-Type が application/pdf でなければ拒否', () => {
    expect(() => assertPdfAcceptable(candidate({ contentType: 'text/html' }))).toThrow(
      PdfRejectedError,
    );
  });

  it('charset 付きの Content-Type は通す', () => {
    expect(() =>
      assertPdfAcceptable(candidate({ contentType: 'application/pdf; charset=binary' })),
    ).not.toThrow();
  });

  it('マジックナンバーが違えば拒否（404のHTMLを掴んだ場合）', () => {
    expect(() =>
      assertPdfAcceptable(candidate({ bytes: new TextEncoder().encode('<html>404</html>') })),
    ).toThrow(PdfRejectedError);
  });

  it('サイズ上限を超えたら拒否', () => {
    const huge = new Uint8Array(MAX_PDF_BYTES + 1);
    huge.set(PDF_HEADER);
    expect(() => assertPdfAcceptable(candidate({ bytes: huge }))).toThrow(/10/);
  });

  it('ページ数上限を超えたら拒否（取説PDFを掴んだ場合）', () => {
    expect(() => assertPdfAcceptable(candidate({ pageCount: MAX_PDF_PAGES + 1 }))).toThrow(
      /ページ/,
    );
  });

  it('ページ数0は拒否', () => {
    expect(() => assertPdfAcceptable(candidate({ pageCount: 0 }))).toThrow(PdfRejectedError);
  });

  it('拒否の理由がメッセージに入る', () => {
    expect(() => assertPdfAcceptable(candidate({ contentType: 'text/html' }))).toThrow(
      /text\/html/,
    );
  });
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npx vitest run tests/unit/pdf-guard.test.ts`
Expected: FAIL（`lib/pdf-guard.ts` が存在しない）

- [ ] **Step 4: 実装する**

`lib/pdf-guard.ts`:

```ts
/**
 * 取得したPDFをLLMに渡す前の検査。
 *
 * PDFは外部から来るファイルであり、こちらの想定どおりとは限らない。
 * サイトの構成が変わって取説PDF（数百ページ）を掴むこともあれば、
 * 404のHTMLが application/pdf として返ってくることもある。
 * そのままモデルに渡すと、費用が跳ね上がるうえに意図しない文書を読ませることになる。
 *
 * 判定を純粋関数に切り出し、ページ数だけ呼び出し側が渡す形にしてあるのは、
 * PDFパーサを持ち込まずに単体テストできるようにするためである。
 */

/** 諸元表が10MBを超えることはない。超えたら別の文書を掴んでいる */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** 諸元表はせいぜい十数ページ。50を超えたら取説などを掴んでいる */
export const MAX_PDF_PAGES = 50;

export class PdfRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfRejectedError';
  }
}

export interface PdfCandidate {
  contentType: string | null;
  bytes: Uint8Array;
  pageCount: number;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

export function assertPdfAcceptable({ contentType, bytes, pageCount }: PdfCandidate): void {
  const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/pdf') {
    throw new PdfRejectedError(
      `Content-Type が application/pdf ではありません: ${contentType ?? '(なし)'}`,
    );
  }

  if (!looksLikePdf(bytes)) {
    throw new PdfRejectedError(
      'PDFのマジックナンバー（%PDF-）で始まっていません。エラーページを取得した可能性があります',
    );
  }

  if (bytes.length > MAX_PDF_BYTES) {
    throw new PdfRejectedError(
      `PDFが大きすぎます: ${bytes.length} バイト（上限 ${MAX_PDF_BYTES} = 10MiB）`,
    );
  }

  if (pageCount < 1) {
    throw new PdfRejectedError('ページ数が0です。PDFとして読めていません');
  }

  if (pageCount > MAX_PDF_PAGES) {
    throw new PdfRejectedError(
      `ページ数が多すぎます: ${pageCount} ページ（上限 ${MAX_PDF_PAGES}）。` +
        '諸元表ではなく取扱説明書などを取得した可能性があります',
    );
  }
}
```

`pipeline/pdf.ts`:

```ts
import { getDocumentProxy } from 'unpdf';

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  // 必ず複製を渡す。PDF.js は受け取ったバッファの所有権を奪い、
  // 呼び出し側の Uint8Array を長さ0にしてしまう。複製しないと、
  // ページ数を数えた直後に本体のバイト列が消え、
  // sha256 の計算もマジックナンバーの検査も空データに対して行われる。
  const document = await getDocumentProxy(new Uint8Array(bytes));
  return document.numPages;
}
```

`tests/unit/pipeline-pdf.test.ts` には、最小のPDFをその場で組み立てて次を確かめるテストを書く。

- ページ数が数えられる（6ページ / 1ページ）
- **呼び出し側のバイト列が破壊されない**（`bytes.length` が呼び出し前後で同じ）
- 二度続けて呼んでも同じ結果になる
- PDFとして読めないものは例外

3つ目のテストが最も重要である。複製を忘れると単体テストは通るのに
実際の収集で本体が消えるという、見つけにくい壊れ方をする。

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/unit/pdf-guard.test.ts`
Expected: PASS。失敗0件、`tests/unit/pdf-guard.test.ts` から12件以上、`tests/unit/pipeline-pdf.test.ts` から5件以上

- [ ] **Step 6: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc がエラー0件で終了し、テストは失敗0件・合計124件以上

- [ ] **Step 7: コミット**

```bash
git add lib/pdf-guard.ts pipeline/pdf.ts tests/unit/pdf-guard.test.ts tests/unit/pipeline-pdf.test.ts package.json package-lock.json
git commit -m "feat: PDFの事前検査（Content-Type・マジックナンバー・サイズ・ページ数）"
```

---

## Task 3: slug 生成規則にパワートレインと駆動方式を織り込む

プリウスの諸元表には同名の「Z」「G」がパワートレイン違いで2つずつある。現在の `gradeSlug` はグレード名だけから作るため、`unique(model_id, slug)` に衝突する。既存103件の slug は変えずに、新規取り込みぶんだけ識別子を足す。

**Files:**
- Modify: `lib/slug.ts`
- Modify: `tests/unit/slug.test.ts`（既存ファイルに追記。既存の describe は消さない）

**Interfaces:**
- Consumes: なし
- Produces: `gradeSlug(grade: string, discriminator?: GradeDiscriminator): string`
  - `GradeDiscriminator = { powertrain?: string | null; driveSystem?: string | null }`
  - 第2引数を省略、または両方が空なら**従来と完全に同じ文字列**を返す

- [ ] **Step 1: 失敗するテストを既存ファイルに追記**

`tests/unit/slug.test.ts` の末尾に追加する（既存の describe は消さない）:

```ts
describe('gradeSlug — パワートレイン・駆動方式による識別', () => {
  it('第2引数が無ければ従来と同じ結果（既存103件の slug を変えないため）', () => {
    expect(gradeSlug('Z')).toBe('z');
    expect(gradeSlug('G')).toBe('g');
    expect(gradeSlug('X')).toBe('x');
  });

  it('空の識別子も従来と同じ扱い', () => {
    expect(gradeSlug('Z', {})).toBe('z');
    expect(gradeSlug('Z', { powertrain: '', driveSystem: null })).toBe('z');
  });

  it('プリウスの同名グレードが別の slug になる', () => {
    const phev = gradeSlug('Z', { powertrain: '2.0L プラグインハイブリッド車', driveSystem: 'FF' });
    const hybrid = gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: 'FF' });

    expect(phev).not.toBe(hybrid);
    expect(phev).toBe('z-20phev-ff');
    expect(hybrid).toBe('z-20hv-ff');
  });

  it('駆動方式だけが違う場合も分かれる', () => {
    expect(gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: '4WD' })).toBe(
      'z-20hv-4wd',
    );
  });

  it('排気量が違えば分かれる', () => {
    expect(gradeSlug('U', { powertrain: '1.8L ハイブリッド車', driveSystem: 'FF' })).toBe(
      'u-18hv-ff',
    );
  });

  it('ガソリン・ディーゼル・EVも短縮される', () => {
    expect(gradeSlug('G', { powertrain: '1.5L ガソリン車', driveSystem: 'FF' })).toBe('g-15gas-ff');
    expect(gradeSlug('G', { powertrain: '2.2L ディーゼル車', driveSystem: '4WD' })).toBe(
      'g-22diesel-4wd',
    );
  });

  it('未知のパワートレイン表記はハッシュで区別する（衝突させない）', () => {
    const a = gradeSlug('Z', { powertrain: '謎の動力源A', driveSystem: 'FF' });
    const b = gradeSlug('Z', { powertrain: '謎の動力源B', driveSystem: 'FF' });

    expect(a).not.toBe(b);
    expect(a).toMatch(/^z-[0-9a-f]{6}-ff$/);
  });

  it('駆動方式だけがある場合も従来の slug とは別になる', () => {
    expect(gradeSlug('Z', { driveSystem: 'FF' })).toBe('z-ff');
  });

  it('非ASCIIのグレード名でも従来の後方互換を保つ', () => {
    const legacy = gradeSlug('ハイブリッドG');
    expect(gradeSlug('ハイブリッドG', {})).toBe(legacy);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/slug.test.ts`
Expected: FAIL（`gradeSlug` が第2引数を無視するため `z-20phev-ff` にならない）

- [ ] **Step 3: `lib/slug.ts` の `gradeSlug` を差し替える**

既存の `gradeSlug` を次で置き換える。ファイル内の他の関数（`manufacturerSlug` / `modelSlug` / `asciiSlug` / `shortHash` / `hasNonAscii` / `urlTailSegment`）は変更しない。

```ts
/** パワートレイン表記に現れる動力源と、slug に使う短縮形 */
const POWERTRAIN_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  // 「プラグインハイブリッド」は「ハイブリッド」を含むため、必ず先に判定する
  [/プラグインハイブリッド|PHEV/i, 'phev'],
  [/ハイブリッド|HV/i, 'hv'],
  [/ディーゼル|DIESEL/i, 'diesel'],
  [/ガソリン|GASOLINE/i, 'gas'],
  [/電気自動車|BEV|(?<![A-Za-z])EV(?![A-Za-z])/i, 'ev'],
];

export interface GradeDiscriminator {
  powertrain?: string | null;
  driveSystem?: string | null;
}

/**
 * パワートレイン表記を slug 用の短い記号にする。
 * 「2.0L プラグインハイブリッド車」→「20phev」
 *
 * 排気量まで含めるのは、同じ動力源で排気量だけが違う設定があるためである
 * （プリウスの 2.0L ハイブリッドと 1.8L ハイブリッド）。
 * どの規則にも当てはまらない表記はハッシュにする。捨てて衝突させるより、
 * 読めない文字列でも区別できるほうがよい。
 */
function powertrainToken(powertrain: string): string {
  const displacement = /(\d)\.(\d)\s*L/i.exec(powertrain);
  const size = displacement ? `${displacement[1]}${displacement[2]}` : '';

  for (const [pattern, token] of POWERTRAIN_TOKENS) {
    if (pattern.test(powertrain)) return `${size}${token}`;
  }
  return shortHash(powertrain);
}

/**
 * グレードの slug。公開URL `/cars/<maker>/<model>/<grade>` の最後の要素になる。
 *
 * 第2引数を省略すると従来どおりグレード名だけから作る。既にDBに入っている
 * 103件の slug を変えないためであり、省略時の結果を変えてはいけない
 * （slug は一度発行したら変えないという規約がサブプロジェクト1にある）。
 *
 * 諸元表から取り込む場合は識別子を渡す。1つの車種に同名のグレードが
 * パワートレイン違いで並ぶため（プリウスの「Z」は 2.0L PHEV と 2.0L HV に
 * 1つずつある）、名前だけでは unique(model_id, slug) に衝突する。
 */
export function gradeSlug(grade: string, discriminator?: GradeDiscriminator): string {
  const base = hasNonAscii(grade)
    ? (asciiSlug(grade) ? `${asciiSlug(grade)}-${shortHash(grade)}` : `grade-${shortHash(grade)}`)
    : (asciiSlug(grade) || `grade-${shortHash(grade)}`);

  const parts = [base];

  const powertrain = discriminator?.powertrain?.trim();
  if (powertrain) parts.push(powertrainToken(powertrain));

  const driveSystem = discriminator?.driveSystem?.trim();
  if (driveSystem) parts.push(asciiSlug(driveSystem) || shortHash(driveSystem));

  return parts.join('-');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/slug.test.ts`
Expected: PASS。失敗0件。既存の slug テストも全て通ること（後方互換が壊れていない証拠）

- [ ] **Step 5: 既存の103件の slug が変わらないことを実データで確認**

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { grades } from './db/schema';
import { gradeSlug } from './lib/slug';
void (async () => {
  const rows = await db.select({ name: grades.name, slug: grades.slug }).from(grades);
  const changed = rows.filter((r) => gradeSlug(r.name) !== r.slug);
  console.log('総数:', rows.length, '/ 変化する件数:', changed.length);
  if (changed.length) { console.log(changed.slice(0, 5)); process.exit(1); }
})();
"
```

Run: 上のコマンド
Expected: `総数: 103 / 変化する件数: 0` と表示され、終了コード0

- [ ] **Step 6: コミット**

```bash
git add lib/slug.ts tests/unit/slug.test.ts
git commit -m "feat: gradeSlug にパワートレイン・駆動方式の識別子を追加"
```

---

## Task 4: grades のスキーマ変更（識別単位の修正）

同名グレードを別レコードとして持てるようにする。`powertrain` を **NOT NULL** にすることが要点。nullable にすると PostgreSQL は NULL 同士を異なる値として扱い、一意制約がまったく効かない。

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0002_*.sql`（`npm run db:generate` が生成する名前をそのまま使う）
- Create: `drizzle/meta/0002_snapshot.json`（自動生成）
- Modify: `drizzle/meta/_journal.json`（自動生成）
- Test: `tests/integration/grade-identity.test.ts`

**Interfaces:**
- Consumes: `grades`（`db/schema.ts`）
- Produces:
  - `grades.typeDesignation`（`type_designation text`、null 可）
  - `grades.powertrain`（`powertrain text NOT NULL DEFAULT ''`）
  - 制約 `grades_model_powertrain_drive_name_key` = `unique(model_id, powertrain, drive_system, name)`
  - 制約 `grades_type_designation_key` = `unique(type_designation)`
  - `grades_model_name_key` は削除。`grades_model_slug_key` は**残す**

- [ ] **Step 1: 失敗する統合テストを書く**

`tests/integration/grade-identity.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

// このテストは行を追加するが、必ず削除して元の件数に戻す。
// 全103件が draft のままであることが正しい状態であり、増減させてはいけない。
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(grades).where(eq(grades.id, id));
  }
});

async function anyModelId(): Promise<string> {
  const [row] = await db.select({ id: models.id }).from(models).limit(1);
  return row.id;
}

function gradeRow(modelId: string, overrides: Record<string, unknown> = {}) {
  return {
    modelId,
    name: '__test_Z',
    slug: `__test_${Math.random().toString(36).slice(2, 10)}`,
    price: 4_000_000,
    engineType: 'ハイブリッド' as const,
    driveSystem: 'FF' as const,
    seating: 5,
    powertrain: '2.0L ハイブリッド車',
    ...overrides,
  };
}

describe('grades の識別単位', () => {
  it('同名グレードでもパワートレインが違えば両方入る', async () => {
    const modelId = await anyModelId();

    const [phev] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: '2.0L プラグインハイブリッド車' }))
      .returning({ id: grades.id });
    created.push(phev.id);

    const [hybrid] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: '2.0L ハイブリッド車' }))
      .returning({ id: grades.id });
    created.push(hybrid.id);

    expect(phev.id).not.toBe(hybrid.id);
  });

  it('車種・パワートレイン・駆動方式・名前がすべて同じなら拒否される', async () => {
    const modelId = await anyModelId();

    const [first] = await db.insert(grades).values(gradeRow(modelId)).returning({ id: grades.id });
    created.push(first.id);

    await expect(db.insert(grades).values(gradeRow(modelId))).rejects.toThrow();
  });

  it('powertrain は NOT NULL で、既定値は空文字', async () => {
    const { rows } = await db.execute(sql`
      select is_nullable, column_default
      from information_schema.columns
      where table_name = 'grades' and column_name = 'powertrain'
    `);

    expect(rows[0].is_nullable).toBe('NO');
    expect(String(rows[0].column_default)).toContain("''");
  });

  it('powertrain 未指定の行を2件入れると、空文字どうしで衝突して拒否される', async () => {
    // nullable のままだと NULL 同士が「異なる値」と見なされ、
    // 一意制約をすり抜けて何行でも入ってしまう。NOT NULL にした理由がこれ。
    const modelId = await anyModelId();

    const [first] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: undefined }))
      .returning({ id: grades.id });
    created.push(first.id);

    await expect(
      db.insert(grades).values(gradeRow(modelId, { powertrain: undefined })),
    ).rejects.toThrow();
  });

  it('type_designation は一意だが、null は何件あってもよい', async () => {
    const modelId = await anyModelId();
    const designation = `__TEST-${Math.random().toString(36).slice(2, 8)}`;

    const [first] = await db
      .insert(grades)
      .values(gradeRow(modelId, { typeDesignation: designation, powertrain: 'A' }))
      .returning({ id: grades.id });
    created.push(first.id);

    await expect(
      db.insert(grades).values(gradeRow(modelId, { typeDesignation: designation, powertrain: 'B' })),
    ).rejects.toThrow();

    // null は衝突しない。型式が公開されていない車種が複数あってよいのは要件どおり
    const [nullA] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: 'C' }))
      .returning({ id: grades.id });
    created.push(nullA.id);
    const [nullB] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: 'D' }))
      .returning({ id: grades.id });
    created.push(nullB.id);

    expect(nullA.id).not.toBe(nullB.id);
  });

  it('既存の103件は移行後も無傷で、全て draft のまま', async () => {
    const { rows } = await db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where publication_status = 'draft')::int as drafts
      from grades
      where name not like '__test_%'
    `);

    expect(rows[0].total).toBe(103);
    expect(rows[0].drafts).toBe(103);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm run test:integration -- tests/integration/grade-identity.test.ts`
Expected: FAIL（`powertrain` 列が存在しない）

- [ ] **Step 3: `db/schema.ts` の grades を変更**

カラム定義の `sourceUrl` の直前に追加する:

```ts
    /**
     * 車両型式（例 6LA-MXWH61-AHXHB）。国交省の型式指定で、バリアントごとに一意。
     * 業界が実際に使う識別子であり、これがあれば同名グレード問題は構造的に解決する。
     * 諸元表に載っていない車種もあるため null 可。
     */
    typeDesignation: text('type_designation'),

    /**
     * 諸元表の列見出しの原文（例「2.0L プラグインハイブリッド車」）。
     *
     * NOT NULL は必須である。nullable にすると PostgreSQL は UNIQUE 制約で
     * NULL 同士を「異なる値」として扱うため、下の複合一意制約をすり抜けて
     * 同名グレードが何行でも入る。値が取れない場合は空文字を入れる。
     *
     * engine_type（正規化した分類）とは別物。同じ「ハイブリッド」の中で
     * 排気量違いを区別するために原文が要る。transmission を raw と type に
     * 分けたのと同じ理屈である。
     */
    powertrain: text('powertrain').notNull().default(''),
```

制約の配列を変更する:

```ts
    // unique('grades_model_name_key') は削除した。
    // プリウスの諸元表には同名の「Z」「G」がパワートレイン違いで2つずつあり、
    // 車種と名前だけでは1車種のうちに衝突する（設計書2.4）。
    unique('grades_model_powertrain_drive_name_key').on(
      t.modelId,
      t.powertrain,
      t.driveSystem,
      t.name,
    ),
    unique('grades_type_designation_key').on(t.typeDesignation),
    // slug は公開URLの識別子なので車種内で一意のまま。衝突は slug の生成規則側で
    // 避ける（lib/slug.ts の gradeSlug に識別子を渡す）
    unique('grades_model_slug_key').on(t.modelId, t.slug),
```

- [ ] **Step 4: マイグレーションを生成して適用**

```bash
npm run db:generate
npm run db:migrate
```

Run: `npm run db:generate && npm run db:migrate`
Expected: `drizzle/0002_*.sql` が生成され、migrate がエラーなく完了する

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS。失敗0件、合計24件以上（ベースライン18件 + 新規6件以上）

- [ ] **Step 6: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc がエラー0件、build が ESLint 警告0で成功

- [ ] **Step 7: コミット**

```bash
git add db/schema.ts drizzle/ tests/integration/grade-identity.test.ts
git commit -m "feat: grades に type_designation と powertrain を追加し一意制約を張り替え"
```

---

## Task 5: 収集パイプライン用の4テーブル

`spec_sources`（登録済みベースパス）、`spec_documents`（取得したPDF）、`extractions`（LLMの生結果）、`change_requests`（承認キュー）を作る。

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/enums.ts`
- Create: `drizzle/0003_*.sql`（自動生成）
- Create: `drizzle/meta/0003_snapshot.json`（自動生成）
- Modify: `drizzle/meta/_journal.json`（自動生成）
- Test: `tests/integration/pipeline-schema.test.ts`

**Interfaces:**
- Consumes: `models`, `grades`（Task 4 の変更後）
- Produces: `specSources`, `specDocuments`, `extractions`, `changeRequests`（`db/schema.ts` から export）
  - `CHANGE_KINDS = ['new_model','new_grade','price_change','spec_change','discontinued']`
  - `CHANGE_STATUSES = ['pending','approved','rejected','applied','stale']`

- [ ] **Step 1: 列挙を `db/enums.ts` に追加**

ファイル末尾に追加する:

```ts
/** change_requests.kind。承認ルール（pipeline/approval-rules.ts）がこの値で分岐する */
export const CHANGE_KINDS = [
  'new_model', 'new_grade', 'price_change', 'spec_change', 'discontinued',
] as const;

/**
 * change_requests.status。
 * stale は「適用しようとしたら対象行が既に変わっていた」状態で、
 * 上書きせず人間に戻すために使う（トランザクションが無い前提の冪等性、設計書5.4）。
 */
export const CHANGE_STATUSES = [
  'pending', 'approved', 'rejected', 'applied', 'stale',
] as const;
```

- [ ] **Step 2: 失敗する統合テストを書く**

`tests/integration/pipeline-schema.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { changeRequests, models, specDocuments, specSources } from '@/db/schema';

const createdSources: string[] = [];

afterEach(async () => {
  // spec_documents / change_requests は cascade で消える
  for (const id of createdSources.splice(0)) {
    await db.delete(specSources).where(eq(specSources.id, id));
  }
});

async function newSource(overrides: Record<string, unknown> = {}) {
  const [model] = await db.select({ id: models.id }).from(models).limit(1);
  const [row] = await db
    .insert(specSources)
    .values({
      modelId: model.id,
      pdfBaseUrl: `https://example.com/${Math.random().toString(36).slice(2)}/spec_`,
      ...overrides,
    })
    .returning();
  createdSources.push(row.id);
  return row;
}

describe('spec_sources', () => {
  it('登録できて、既定値が入る', async () => {
    const source = await newSource();
    expect(source.knownMonth).toBeNull();
    expect(source.consecutiveFailures).toBe(0);
    expect(source.lastCheckedAt).toBeNull();
  });

  it('同じベースパスは二重登録できない', async () => {
    const source = await newSource();
    const [model] = await db.select({ id: models.id }).from(models).limit(1);

    await expect(
      db.insert(specSources).values({ modelId: model.id, pdfBaseUrl: source.pdfBaseUrl }),
    ).rejects.toThrow();
  });

  it('known_month は YYYY-MM 形式しか受け付けない', async () => {
    await expect(newSource({ knownMonth: '202607' })).rejects.toThrow();
  });
});

describe('spec_documents', () => {
  it('同じ source に同じ sha256 は二度入らない（再取得しても増えない）', async () => {
    const source = await newSource();
    const values = {
      specSourceId: source.id,
      pdfUrl: 'https://example.com/spec_202607.pdf',
      documentMonth: '2026-07',
      sha256: 'a'.repeat(64),
      byteSize: 455_398,
      pageCount: 6,
    };

    await db.insert(specDocuments).values(values);
    await expect(db.insert(specDocuments).values(values)).rejects.toThrow();
  });
});

describe('change_requests', () => {
  it('同じ文書・種別・対象は二重に積まれない（cronの重複起動対策）', async () => {
    const source = await newSource();
    const [document] = await db
      .insert(specDocuments)
      .values({
        specSourceId: source.id,
        pdfUrl: 'https://example.com/spec_202607.pdf',
        documentMonth: '2026-07',
        sha256: 'b'.repeat(64),
        byteSize: 1000,
        pageCount: 6,
      })
      .returning();

    const values = {
      specDocumentId: document.id,
      kind: 'price_change' as const,
      targetKey: '6LA-MXWH61-AHXHB',
      diff: { price: { before: 4_000_000, after: 4_200_000 } },
    };

    await db.insert(changeRequests).values(values);
    await expect(db.insert(changeRequests).values(values)).rejects.toThrow();
  });

  it('status の既定は pending', async () => {
    const source = await newSource();
    const [document] = await db
      .insert(specDocuments)
      .values({
        specSourceId: source.id,
        pdfUrl: 'https://example.com/spec_202607.pdf',
        documentMonth: '2026-07',
        sha256: 'c'.repeat(64),
        byteSize: 1000,
        pageCount: 6,
      })
      .returning();

    const [request] = await db
      .insert(changeRequests)
      .values({
        specDocumentId: document.id,
        kind: 'new_grade',
        targetKey: 'Z/2.0L PHEV/FF',
        diff: {},
      })
      .returning();

    expect(request.status).toBe('pending');
    expect(request.decidedBy).toBeNull();
    expect(request.appliedAt).toBeNull();
  });
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npm run test:integration -- tests/integration/pipeline-schema.test.ts`
Expected: FAIL（`spec_sources` テーブルが存在しない）

- [ ] **Step 4: `db/schema.ts` にテーブルを追加**

既存の import に `CHANGE_KINDS`, `CHANGE_STATUSES` を足し、ファイル末尾に追加する:

```ts
export const changeKindEnum = pgEnum('change_kind', CHANGE_KINDS);
export const changeStatusEnum = pgEnum('change_status', CHANGE_STATUSES);

/**
 * 車種ごとの諸元表PDFのベースパス。人が一度だけ登録する。
 *
 * ページを描画してリンクを拾うのではなく、ベースパスに年月を付けて
 * HEAD で探索する（設計書7.1）。ベースパス中のセクションID（005_p_001 など）は
 * 車種ごとに違い推測できないため、ここだけは人の登録に頼る。
 */
export const specSources = pgTable(
  'spec_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
    /** 例: https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_ */
    pdfBaseUrl: text('pdf_base_url').notNull(),
    /** 前回200が返った年月。初回は null で、maxLookback ぶん遡って探す */
    knownMonth: text('known_month'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** 3に達したら「取得不能」として人間に上げる（設計書8章） */
    consecutiveFailures: smallint('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    unique('spec_sources_base_url_key').on(t.pdfBaseUrl),
    index('spec_sources_model_id_idx').on(t.modelId),
    check('spec_sources_known_month_check', sql`${t.knownMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/**
 * 実際に取得したPDF。同じ内容を二度登録しないよう sha256 に一意制約を張る。
 *
 * stored_path にPDF原本を保存する。Structured Outputs はスキーマで要求した項目しか
 * 返さないため、後から項目を足したくなったとき extractions.raw_output には入っていない。
 * メーカーのURLは改定のたびに差し替わるので、後から取り直せる保証もない（設計書5.2）。
 */
export const specDocuments = pgTable(
  'spec_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specSourceId: uuid('spec_source_id')
      .notNull()
      .references(() => specSources.id, { onDelete: 'cascade' }),
    pdfUrl: text('pdf_url').notNull(),
    documentMonth: text('document_month').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    pageCount: smallint('page_count').notNull(),
    storedPath: text('stored_path'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('spec_documents_source_sha_key').on(t.specSourceId, t.sha256),
    index('spec_documents_source_id_idx').on(t.specSourceId),
    check('spec_documents_month_check', sql`${t.documentMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/**
 * LLM抽出の生結果。成功・失敗を問わず残す。
 *
 * PDFのLLM処理が唯一の実コストなので、二度払わない設計にする。
 * スキーマを後から変えても、既存項目の作り直しは raw_output からできる。
 */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specDocumentId: uuid('spec_document_id')
      .notNull()
      .references(() => specDocuments.id, { onDelete: 'cascade' }),
    modelIdUsed: text('model_id_used').notNull(),
    rawOutput: jsonb('raw_output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    succeeded: boolean('succeeded').notNull(),
    error: text('error'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('extractions_document_id_idx').on(t.specDocumentId)],
);

/**
 * 承認キュー。
 *
 * unique(spec_document_id, kind, target_key) が冪等性の要である。
 * neon-http にトランザクションが無いため、cronの重複起動や再実行で
 * 同じ変更が二重に積まれるのを制約で防ぐ（設計書5.4）。
 */
export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specDocumentId: uuid('spec_document_id')
      .notNull()
      .references(() => specDocuments.id, { onDelete: 'cascade' }),
    kind: changeKindEnum('kind').notNull(),
    /** 適用対象を一意に指す文字列。グレードなら型式、無ければ 名前/パワートレイン/駆動方式 */
    targetKey: text('target_key').notNull(),
    /** 適用前後の値。ロールバックは これを逆適用する */
    diff: jsonb('diff').notNull(),
    status: changeStatusEnum('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('change_requests_document_kind_target_key').on(t.specDocumentId, t.kind, t.targetKey),
    index('change_requests_status_idx').on(t.status),
  ],
);
```

`check` と `sql` が未 import なら import に足す（既存の CHECK 制約が同じものを使っている）。

- [ ] **Step 5: マイグレーションを生成して適用**

Run: `npm run db:generate && npm run db:migrate`
Expected: `drizzle/0003_*.sql` が生成され、migrate がエラーなく完了する

- [ ] **Step 6: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS。失敗0件、合計30件以上

- [ ] **Step 7: 既存の103件が無傷であることを確認**

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { sql } from 'drizzle-orm';
void (async () => {
  const { rows } = await db.execute(sql\`
    select (select count(*) from models)::int m,
           (select count(*) from grades)::int g,
           (select count(*) from grades where publication_status='published')::int pub
  \`);
  console.log(rows[0]);
  const r = rows[0] as Record<string, number>;
  if (r.m !== 100 || r.g !== 103 || r.pub !== 0) process.exit(1);
})();
"
```

Run: 上のコマンド
Expected: `{ m: 100, g: 103, pub: 0 }` が表示され、終了コード0

- [ ] **Step 8: コミット**

```bash
git add db/schema.ts db/enums.ts drizzle/ tests/integration/pipeline-schema.test.ts
git commit -m "feat: 収集パイプライン用の4テーブルを追加"
```

---

## Task 6: PDFの探索と取得

登録済みベースパスから最新版のPDFを見つけて取得する。HTTPは注入できる形にして、ネットワークに触らずに単体テストする。

**Files:**
- Create: `pipeline/http.ts`
- Create: `pipeline/fetch.ts`
- Test: `tests/unit/pipeline-fetch.test.ts`

**Interfaces:**
- Consumes: `candidateMonths`, `buildPdfUrl`, `isStale`（Task 1）/ `assertPdfAcceptable`（Task 2）/ `countPdfPages`（Task 2）
- Produces:
  - `interface Http { head(url): Promise<number>; get(url): Promise<HttpResponse> }`
  - `createFetchHttp(): Http`（`pipeline/http.ts`。実ネットワーク）
  - `findLatestMonth(source, http, now): Promise<FindResult>`
    - `FindResult = { found: string } | { deadBaseUrl: true }`
  - `fetchAndValidate(url, http, countPages): Promise<FetchedPdf>`
    - `FetchedPdf = { bytes: Uint8Array; sha256: string; pageCount: number; byteSize: number }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pipeline-fetch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchAndValidate, findLatestMonth } from '@/pipeline/fetch';
import type { Http } from '@/pipeline/http';
import { PdfRejectedError } from '@/lib/pdf-guard';

const BASE = 'https://example.com/prius_spec_';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nfake');

/** 200 を返すURLの集合だけを持つ偽のHTTP */
function fakeHttp(ok: Set<string>, body = PDF_BYTES, contentType = 'application/pdf'): Http {
  return {
    head: async (url) => (ok.has(url) ? 200 : 404),
    get: async (url) =>
      ok.has(url)
        ? { status: 200, contentType, bytes: body }
        : { status: 404, contentType: 'text/html', bytes: new TextEncoder().encode('<html>') },
  };
}

describe('findLatestMonth', () => {
  it('既知より新しい版があればそれを返す', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`]));
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-05' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
  });

  it('新しい版が無ければ既知の年月を返す（更新なし）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-07' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-07' });
  });

  it('既知も含めて全て404ならベースパスが死んでいる', async () => {
    const http = fakeHttp(new Set());
    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-07' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ deadBaseUrl: true });
  });

  it('初回（既知なし）でも遡って見つけられる', async () => {
    const http = fakeHttp(new Set([`${BASE}202605.pdf`]));
    const result = await findLatestMonth({ pdfBaseUrl: BASE, knownMonth: null }, http, '2026-08');

    expect(result).toEqual({ found: '2026-05' });
  });

  it('新しい順に探し、最初に見つかったところで止める', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`, `${BASE}202606.pdf`]));
    const spy = vi.spyOn(http, 'head');

    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-01' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
    expect(spy).toHaveBeenCalledTimes(1); // 202607 以前は試さない
  });

  it('既知が今月と同じなら、既知の生存確認だけを行う', async () => {
    const http = fakeHttp(new Set([`${BASE}202608.pdf`]));
    const spy = vi.spyOn(http, 'head');

    const result = await findLatestMonth(
      { pdfBaseUrl: BASE, knownMonth: '2026-08' },
      http,
      '2026-08',
    );

    expect(result).toEqual({ found: '2026-08' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('fetchAndValidate', () => {
  const countPages = async () => 6;

  it('取得して sha256 とページ数を返す', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const result = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);

    expect(result.byteSize).toBe(PDF_BYTES.length);
    expect(result.pageCount).toBe(6);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ内容なら同じ sha256 になる（変更検知の土台）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    const first = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);
    const second = await fetchAndValidate(`${BASE}202607.pdf`, http, countPages);

    expect(first.sha256).toBe(second.sha256);
  });

  it('200以外は例外', async () => {
    const http = fakeHttp(new Set());
    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, countPages)).rejects.toThrow(/404/);
  });

  it('検査に落ちるPDFは PdfRejectedError（LLMに渡さない）', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]), PDF_BYTES, 'text/html');
    await expect(fetchAndValidate(`${BASE}202607.pdf`, http, countPages)).rejects.toThrow(
      PdfRejectedError,
    );
  });

  it('ページ数が上限超なら PdfRejectedError', async () => {
    const http = fakeHttp(new Set([`${BASE}202607.pdf`]));
    await expect(
      fetchAndValidate(`${BASE}202607.pdf`, http, async () => 500),
    ).rejects.toThrow(PdfRejectedError);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/pipeline-fetch.test.ts`
Expected: FAIL（`pipeline/fetch.ts` が存在しない）

- [ ] **Step 3: 実装する**

`pipeline/http.ts`:

```ts
export interface HttpResponse {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
}

/**
 * HTTPを差し替え可能にしてある。探索ロジックの単体テストで
 * 実際にメーカーのサイトを叩かずに済ませるためである。
 */
export interface Http {
  head(url: string): Promise<number>;
  get(url: string): Promise<HttpResponse>;
}

/** ASCII だけで書くこと。HTTPヘッダは latin-1 しか通らない */
export const USER_AGENT =
  'CarSiteBot/1.0 (+personal car comparison site; spec PDFs only, weekly)';

export function createFetchHttp(): Http {
  return {
    async head(url) {
      const response = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
      return response.status;
    },
    async get(url) {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}
```

`pipeline/fetch.ts`:

```ts
import { createHash } from 'node:crypto';
import { assertPdfAcceptable } from '@/lib/pdf-guard';
import { buildPdfUrl, candidateMonths } from '@/lib/spec-url';
import type { Http } from './http';

export interface SourceLocation {
  pdfBaseUrl: string;
  knownMonth: string | null;
}

export type FindResult = { found: string } | { deadBaseUrl: true };

/**
 * 最新の諸元表がどの年月かを HEAD だけで突き止める。
 *
 * 新しい順に試し、最初に 200 が返ったところで止める。実測では同時に存在する年月は
 * 1つだけなので、これで最新版が確定する。候補が全て404なら既知の年月を確認し、
 * それも404ならベースパス自体が死んでいる（サイト構成が変わった）。
 *
 * 定常状態では「今月ぶんが404 → 既知が200」の2回で終わる。
 */
export async function findLatestMonth(
  source: SourceLocation,
  http: Http,
  now: string,
): Promise<FindResult> {
  for (const month of candidateMonths(now, source.knownMonth)) {
    if ((await http.head(buildPdfUrl(source.pdfBaseUrl, month))) === 200) {
      return { found: month };
    }
  }

  if (source.knownMonth === null) return { deadBaseUrl: true };

  const stillThere = await http.head(buildPdfUrl(source.pdfBaseUrl, source.knownMonth));
  return stillThere === 200 ? { found: source.knownMonth } : { deadBaseUrl: true };
}

export interface FetchedPdf {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  byteSize: number;
}

/**
 * PDFを取得し、LLMに渡してよいものかを検査したうえでハッシュを計算する。
 *
 * 検査に落ちたものは例外にする。壊れたPDFや取説PDFを黙ってモデルに渡すと、
 * 費用が跳ね上がるうえに誤ったデータが承認キューに流れ込む。
 */
export async function fetchAndValidate(
  url: string,
  http: Http,
  countPages: (bytes: Uint8Array) => Promise<number>,
): Promise<FetchedPdf> {
  const response = await http.get(url);
  if (response.status !== 200) {
    throw new Error(`PDFの取得に失敗しました: HTTP ${response.status} ${url}`);
  }

  // ページ数を数えるにはPDFとして開く必要がある。開けなければそこで失敗する
  let pageCount = 0;
  try {
    pageCount = await countPages(response.bytes);
  } catch {
    pageCount = 0; // assertPdfAcceptable が「PDFとして読めていません」で弾く
  }

  assertPdfAcceptable({
    contentType: response.contentType,
    bytes: response.bytes,
    pageCount,
  });

  return {
    bytes: response.bytes,
    sha256: createHash('sha256').update(response.bytes).digest('hex'),
    pageCount,
    byteSize: response.bytes.length,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/pipeline-fetch.test.ts`
Expected: PASS。失敗0件、15件以上

- [ ] **Step 5: 実物のトヨタのURLで探索が成立することを一度だけ確認**

```bash
npx tsx -e "
import { findLatestMonth } from './pipeline/fetch';
import { createFetchHttp } from './pipeline/http';
void (async () => {
  const base = 'https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_';
  const now = new Date().toISOString().slice(0, 7);
  console.log(await findLatestMonth({ pdfBaseUrl: base, knownMonth: null }, createFetchHttp(), now));
})();
"
```

Run: 上のコマンド
Expected: `{ found: '2026-07' }`（メーカーが改定していれば別の年月。`deadBaseUrl` でなければ合格）

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、テスト失敗0件・合計135件以上

- [ ] **Step 7: コミット**

```bash
git add pipeline/http.ts pipeline/fetch.ts tests/unit/pipeline-fetch.test.ts
git commit -m "feat: 諸元表PDFの探索と取得"
```

---

## Task 7: 抽出スキーマと駆動方式の正規化

LLMに返させる構造の定義。Zod で書き、`z.toJSONSchema()` で Structured Outputs に渡す形に変換する。駆動方式は諸元表の表記（2WD / E-Four）で受け取り、コード側で enum に写す。

**Files:**
- Create: `pipeline/extraction-schema.ts`
- Test: `tests/unit/extraction-schema.test.ts`

**Interfaces:**
- Consumes: `DRIVE_SYSTEMS`, `ENGINE_TYPES`, `FEATURE_AVAILABILITIES`（`db/enums.ts`）
- Produces:
  - `ExtractedSpecSchema`（Zod）, `type ExtractedSpec`, `type ExtractedGrade`
  - `extractionJsonSchema(): unknown`（**Structured Outputs 互換に整形済み**）
  - `normalizeDriveSystem(raw: string): DriveSystem`（未知の表記は `UnknownEnumValueError`）
  - `class UnknownEnumValueError extends Error`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/extraction-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ExtractedSpecSchema,
  UnknownEnumValueError,
  extractionJsonSchema,
  normalizeDriveSystem,
} from '@/pipeline/extraction-schema';

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
      features: { collision_mitigation_brake: 'standard', sunroof: 'option' },
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
      grades: [{ ...GOLDEN.grades[0], features: { sunroof: 'yes' } }],
    };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });

  it('powertrain が空文字なら拒否（一意制約の識別子になるため）', () => {
    const bad = { ...GOLDEN, grades: [{ ...GOLDEN.grades[0], powertrain: '' }] };
    expect(() => ExtractedSpecSchema.parse(bad)).toThrow();
  });
});

describe('extractionJsonSchema', () => {
  it('JSON Schema に変換できる', () => {
    const schema = extractionJsonSchema() as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).toContain('grades');
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

  it('未知の表記は例外にする。黙って既定値に倒さない', () => {
    expect(() => normalizeDriveSystem('6WD')).toThrow(UnknownEnumValueError);
    expect(() => normalizeDriveSystem('6WD')).toThrow(/6WD/);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/extraction-schema.test.ts`
Expected: FAIL（`pipeline/extraction-schema.ts` が存在しない）

- [ ] **Step 3: 実装する**

`pipeline/extraction-schema.ts`:

```ts
import { z } from 'zod';
import { DRIVE_SYSTEMS, ENGINE_TYPES, FEATURE_AVAILABILITIES } from '@/db/enums';

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
   * FEATURE_COLUMNS の20項目をすべて必須にする。z.record は使えない —
   * Structured Outputs は additionalProperties に false 以外を許さないため、
   * 任意のキーを持つオブジェクトはそもそも表現できない。
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
 * Structured Outputs（output_config.format）に渡す JSON Schema。
 *
 * Zod のオブジェクトをそのまま渡すのではなく変換する。変換元が1つなので、
 * APIに強制させる形と、返ってきた値を検証する形が食い違わない。
 */
export function extractionJsonSchema(): unknown {
  return sanitize(z.toJSONSchema(ExtractedSpecSchema));
}
```

**`z.toJSONSchema()` の出力をそのまま渡してはいけない。** Structured Outputs は
次を受け付けず、送ると 400 になる。

| 送れないもの | Zod が出すもの |
|---|---|
| `$schema` | 常に付く |
| `minLength` / `maxLength` / `pattern` | `.min(1)` など |
| `minItems` / `maxItems` | `.min(1)` on array |
| `minimum` / `maximum` / `exclusiveMinimum` / `multipleOf` | `.positive()` `.int()` など |
| `additionalProperties` が `false` 以外 | `z.record()` |

`sanitize()` でこれらを落とし、すべてのオブジェクトに
`additionalProperties: false` を付ける。落としても検証は緩まない —
返ってきた値は結局 `ExtractedSpecSchema.safeParse` を通すため、
「APIには構造を強制させ、細かい制約は手元で確かめる」という二段構えになる。

整形後の実際の出力:

```
トップレベル: [ 'type', 'properties', 'required', 'additionalProperties' ]
price: {"anyOf":[{"type":"integer"},{"type":"null"}]}    ← exclusiveMinimum が消えている
features のキー数: 20
全体サイズ: 2946 文字
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/extraction-schema.test.ts`
Expected: PASS。失敗0件、19件以上

- [ ] **Step 5: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、テスト失敗0件・合計178件以上

- [ ] **Step 6: コミット**

```bash
git add pipeline/extraction-schema.ts tests/unit/extraction-schema.test.ts
git commit -m "feat: 抽出スキーマと駆動方式の正規化"
```

---

## Task 8: Claude によるPDF構造化

PDFをそのまま Claude に投入し、Structured Outputs で構造を強制する。API クライアントは注入できる形にして、キーが無くても単体テストが回るようにする。

**Files:**
- Create: `pipeline/extract.ts`
- Modify: `package.json`
- Test: `tests/unit/extract.test.ts`

**Interfaces:**
- Consumes: `ExtractedSpecSchema`, `extractionJsonSchema`（Task 7）
- Produces:
  - `interface ExtractionClient { extract(input: ExtractionInput): Promise<ExtractionRaw> }`
  - `createAnthropicClient(apiKey: string): ExtractionClient`
  - `extractSpec(pdf: Uint8Array, client: ExtractionClient): Promise<ExtractionOutcome>`
    - `ExtractionOutcome = { succeeded: true; spec: ExtractedSpec; raw: unknown; inputTokens: number; outputTokens: number } | { succeeded: false; raw: unknown; error: string; inputTokens: number; outputTokens: number }`
  - `EXTRACTION_MODEL = 'claude-opus-5'`
  - `EXTRACTION_SYSTEM_PROMPT`

**SDK の `zodOutputFormat()` は使わない。** 実際に動かして比べたところ、
`z.array().min(1)` 由来の `minItems` を落とさずに残す。仕様上は非対応の
キーワードなので、自前の `sanitize()`（Task 7）を通した JSON Schema を
`output_config.format` に直接渡す。SDK の `JSONOutputFormat` 型は
`{ type: 'json_schema', schema }` なので、型アサーションなしで渡せる。

```
SDK版:   4,066文字（minItems が残る）
自前版:  2,946文字（非対応キーワードなし）
```

- [ ] **Step 1: 依存を追加**

```bash
npm install @anthropic-ai/sdk
```

実物のPDFでリクエストの大きさを確かめてある。

```
PDF 455,398バイト -> base64 607,200 -> リクエスト全体 0.58 MB（上限 32MB）
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/unit/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionClient,
  extractSpec,
} from '@/pipeline/extract';

const PDF = new TextEncoder().encode('%PDF-1.7\nfake');

const VALID = {
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
      features: { sunroof: 'option' },
    },
  ],
};

function clientReturning(raw: unknown): ExtractionClient {
  return {
    extract: async () => ({ raw, inputTokens: 25_000, outputTokens: 8_000 }),
  };
}

describe('extractSpec', () => {
  it('スキーマに合う結果は成功', async () => {
    const result = await extractSpec(PDF, clientReturning(VALID));

    expect(result.succeeded).toBe(true);
    if (result.succeeded) {
      expect(result.spec.grades).toHaveLength(1);
      expect(result.spec.grades[0].typeDesignation).toBe('6LA-MXWH61-AHXHB');
    }
  });

  it('トークン数を必ず返す（費用の記録に使う）', async () => {
    const result = await extractSpec(PDF, clientReturning(VALID));
    expect(result.inputTokens).toBe(25_000);
    expect(result.outputTokens).toBe(8_000);
  });

  it('検証に落ちても生の結果は保持する（再抽出せずに作り直せるように）', async () => {
    const broken = { modelName: 'プリウス', grades: [] };
    const result = await extractSpec(PDF, clientReturning(broken));

    expect(result.succeeded).toBe(false);
    expect(result.raw).toEqual(broken);
    if (!result.succeeded) expect(result.error).toMatch(/grades/);
  });

  it('検証に落ちたとき spec を返さない（部分的にも書き込ませない）', async () => {
    const result = await extractSpec(PDF, clientReturning({ modelName: 'X' }));
    expect(result.succeeded).toBe(false);
    expect('spec' in result).toBe(false);
  });

  it('APIが例外を投げても、失敗として記録できる形で返す', async () => {
    const failing: ExtractionClient = {
      extract: async () => {
        throw new Error('529 overloaded');
      },
    };

    const result = await extractSpec(PDF, failing);
    expect(result.succeeded).toBe(false);
    if (!result.succeeded) expect(result.error).toMatch(/529/);
  });
});

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('同名グレードを別々に出すよう指示している', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/同名/);
  });

  it('括弧記法の意味を説明している', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('［');
  });

  it('推測を禁じている', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/推測|null/);
  });
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npx vitest run tests/unit/extract.test.ts`
Expected: FAIL（`pipeline/extract.ts` が存在しない）

- [ ] **Step 4: 実装する**

`pipeline/extract.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import {
  ExtractedSpecSchema,
  type ExtractedSpec,
  extractionJsonSchema,
} from './extraction-schema';

/**
 * 字間が壊れた日本語PDFから括弧記法の「意味」まで読み取り、
 * パワートレイン列とグレード行という2次元の対応を解釈する必要がある。
 * ここを削ると誤抽出が増え、人間の確認作業が増える。
 * トークン単価より人間の確認コストのほうが高い。
 */
export const EXTRACTION_MODEL = 'claude-opus-5';

export const EXTRACTION_SYSTEM_PROMPT = `あなたは日本の自動車メーカーが公開する「主要諸元表・装備一覧」PDFを読み、構造化データに起こす担当です。

## 表の読み方

諸元表は横方向にパワートレイン（例「2.0L プラグインハイブリッド車」「2.0L ハイブリッド車」「1.8L ハイブリッド車」）で区切られ、
その下に駆動方式（2WD / E-Four など）とグレード名（Z / G / U など）が並びます。

- **同名のグレードが別のパワートレインに現れます。** 例えば「Z」は 2.0L PHEV にも 2.0L HV にもあります。
  これらは別の車です。必ず別の要素として出力し、統合しないでください。
- **1つの列が複数の駆動方式を兼ねることがあります。** 見出しが「2WD/E-Four」なら、2WD と E-Four で
  それぞれ1要素を出力してください。
- **［　］は駆動方式ごとの値です。** 例えば「車両重量 1,420 ［1,480］」は
  2WD が 1,420kg、E-Four が 1,480kg という意味です。値を取り違えないでください。

## 出力の決まり

- driveSystemRaw には諸元表の表記をそのまま入れてください（「2WD」「E-Four」など）。変換しないでください。
- powertrain には列見出しの原文をそのまま入れてください。
- typeDesignation には車両型式（例 6LA-MXWH61-AHXHB）を入れてください。記載が無ければ null。
- **表に書かれていない値は推測せず null にしてください。** 他のグレードの値で埋めないでください。
- 装備は凡例に従って standard（標準設定）/ option（設定あり・メーカーオプション）/ none（設定なし）に分類し、
  判断できないものは unknown にしてください。`;

export interface ExtractionInput {
  pdf: Uint8Array;
  jsonSchema: unknown;
  systemPrompt: string;
}

export interface ExtractionRaw {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

/**
 * API呼び出しを差し替え可能にしてある。
 * この環境には ANTHROPIC_API_KEY が無く、実APIを叩くテストは回せないため、
 * 検証・失敗時の扱い・トークン記録は偽のクライアントで単体テストする。
 */
export interface ExtractionClient {
  extract(input: ExtractionInput): Promise<ExtractionRaw>;
}

export function createAnthropicClient(apiKey: string): ExtractionClient {
  const client = new Anthropic({ apiKey });

  return {
    async extract({ pdf, jsonSchema, systemPrompt }) {
      const response = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 32_000,
        system: systemPrompt,
        output_config: { format: { type: 'json_schema', schema: jsonSchema } },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: Buffer.from(pdf).toString('base64'),
                },
              },
              { type: 'text', text: 'この諸元表を構造化してください。' },
            ],
          },
        ],
      } as never);

      const message = response as unknown as {
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };
      const text = message.content.find((block) => block.type === 'text')?.text ?? '';

      return {
        raw: JSON.parse(text),
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    },
  };
}

export type ExtractionOutcome =
  | {
      succeeded: true;
      spec: ExtractedSpec;
      raw: unknown;
      inputTokens: number;
      outputTokens: number;
    }
  | { succeeded: false; raw: unknown; error: string; inputTokens: number; outputTokens: number };

/**
 * 検証に落ちても生の結果は必ず返す。
 *
 * PDFのLLM処理が唯一の実コストなので、失敗しても捨てない。
 * ただし部分的にも書き込ませない — 半分正しいデータは、
 * 全部間違っているデータより見つけにくい。
 */
export async function extractSpec(
  pdf: Uint8Array,
  client: ExtractionClient,
): Promise<ExtractionOutcome> {
  let raw: unknown = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const response = await client.extract({
      pdf,
      jsonSchema: extractionJsonSchema(),
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });
    raw = response.raw;
    inputTokens = response.inputTokens;
    outputTokens = response.outputTokens;
  } catch (error) {
    return {
      succeeded: false,
      raw,
      error: error instanceof Error ? error.message : String(error),
      inputTokens,
      outputTokens,
    };
  }

  const parsed = ExtractedSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      succeeded: false,
      raw,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / '),
      inputTokens,
      outputTokens,
    };
  }

  return { succeeded: true, spec: parsed.data, raw, inputTokens, outputTokens };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/unit/extract.test.ts`
Expected: PASS。失敗0件、8件以上

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、テスト失敗0件・合計156件以上

- [ ] **Step 7: コミット**

```bash
git add pipeline/extract.ts tests/unit/extract.test.ts package.json package-lock.json
git commit -m "feat: Claude によるPDF構造化"
```

---

## Task 9: 差分計算

抽出結果とDBの現状を突き合わせ、何が変わったかを `change_requests` の草案にする。純粋関数なのでDBに触らない。

**Files:**
- Create: `pipeline/diff.ts`
- Modify: `db/schema.ts`（`ChangeKind` / `ChangeStatus` 型のエクスポートを追加）
- Test: `tests/unit/diff.test.ts`

**Interfaces:**
- Consumes: `ExtractedSpec`, `normalizeDriveSystem`（Task 7）
- Produces:
  - `gradeKey(grade: { typeDesignation: string | null; name: string; powertrain: string; driveSystem: string }): string`
  - `normalizeGrades(spec: ExtractedSpec): NormalizedGrade[]`
  - `computeChanges(existing: ExistingGrade[], incoming: NormalizedGrade[]): ChangeDraft[]`
  - `interface ChangeDraft { kind: ChangeKind; targetKey: string; diff: Record<string, unknown> }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeChanges, gradeKey, normalizeGrades } from '@/pipeline/diff';

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
    features: {},
    ...overrides,
  };
}

function existing(overrides: Record<string, unknown> = {}) {
  return { id: 'uuid-1', ...incoming(), ...overrides };
}

describe('gradeKey', () => {
  it('型式があればそれを使う', () => {
    expect(gradeKey(incoming())).toBe('6LA-MXWH61-AHXHB');
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
});

describe('normalizeGrades', () => {
  it('駆動方式を諸元表の表記からDBの列挙に写す', () => {
    const rows = normalizeGrades({
      modelName: 'プリウス',
      grades: [
        { ...incoming(), driveSystemRaw: '2WD' } as never,
        { ...incoming(), driveSystemRaw: 'E-Four' } as never,
      ],
    } as never);

    expect(rows.map((r) => r.driveSystem)).toEqual(['FF', '4WD']);
  });
});

describe('computeChanges', () => {
  it('DBに無いグレードは new_grade', () => {
    const changes = computeChanges([], [incoming()]);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_grade');
    expect(changes[0].targetKey).toBe('6LA-MXWH61-AHXHB');
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

  it('価格と諸元の両方が違えば2件に分かれる', () => {
    const changes = computeChanges(
      [existing()],
      [incoming({ price: 4_700_000, weight: 1650 })],
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(['price_change', 'spec_change']);
  });

  it('何も変わっていなければ0件', () => {
    expect(computeChanges([existing()], [incoming()])).toEqual([]);
  });

  it('抽出結果に無いグレードは discontinued', () => {
    const changes = computeChanges([existing()], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('discontinued');
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

  it('diff には変わった項目だけが入る', () => {
    const changes = computeChanges([existing()], [incoming({ weight: 1650, seating: 4 })]);
    expect(Object.keys(changes[0].diff).sort()).toEqual(['seating', 'weight']);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: FAIL（`pipeline/diff.ts` が存在しない）

- [ ] **Step 3: 実装する**

`pipeline/diff.ts` を作る。要点:

```ts
/** 比較する項目。price は price_change、それ以外は spec_change に振り分ける */
const SPEC_FIELDS = [
  'seating', 'weight', 'displacement', 'wltcMode', 'engineType', 'transmission',
] as const;

/**
 * グレードを一意に指す文字列。
 *
 * 車両型式があればそれが真の自然キーである（国交省の型式指定で、
 * バリアントごとに一意）。無い場合は 名前・パワートレイン・駆動方式 の複合で識別する。
 * 名前だけで突き合わせると、プリウスの2つの「Z」を取り違える。
 */
export function gradeKey(grade: {
  typeDesignation: string | null;
  name: string;
  powertrain: string;
  driveSystem: string;
}): string {
  return grade.typeDesignation ?? `${grade.name}/${grade.powertrain}/${grade.driveSystem}`;
}
```

- `normalizeGrades` は `spec.grades` を写し、`driveSystemRaw` を `normalizeDriveSystem` に通して `driveSystem` にする。未知の表記はここで例外になる（黙って倒さない）
- `computeChanges` は両側を `gradeKey` で `Map` に入れ、
  - incoming にあって existing に無い → `new_grade`（`diff` は全項目）
  - 両方にある → `price` が違えば `price_change`、`SPEC_FIELDS` のいずれかが違えば `spec_change`。両方違えば2件出す
  - existing にあって incoming に無い → `discontinued`
- `diff` の形は `{ <field>: { before, after } }` で統一する。ロールバックが逆適用でできる形である

**数値の同値判定を素朴に `===` でやってはいけない。** drizzle の `numeric` 列は
**文字列で返る**。実DBで確認済み。

```
wltcMode: "32.6" 型: string      ← DBから
price   : 2750000 型: number
```

抽出結果の `26` と DB の `"26.0"` を `===` で比べると常に不一致になり、
**何も変わっていないのに毎週すべてのグレードに `spec_change` が立つ**。
承認キューが空振りで埋まって使い物にならなくなる。
`sameValue()` で数値として比較できるものは数値に寄せる。

**突き合わせは型式と複合キーの両方で行う。** 型式が後から付いた場合
（既存は null、抽出結果には型式がある）に片方だけで引くと、
「廃止 + 新規」という誤った2件になる。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/diff.test.ts`
Expected: PASS。失敗0件、13件以上

- [ ] **Step 5: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、テスト失敗0件・合計169件以上

- [ ] **Step 6: コミット**

```bash
git add pipeline/diff.ts tests/unit/diff.test.ts
git commit -m "feat: 抽出結果とDBの差分計算"
```

---

## Task 10: 自動承認ルール

どの変更を自動で通し、どれを人間に回すかを決める純粋関数。価格改定だけが条件付きで自動になる。

**Files:**
- Create: `pipeline/approval-rules.ts`
- Test: `tests/unit/approval-rules.test.ts`

**Interfaces:**
- Consumes: `ChangeDraft`（Task 9）
- Produces:
  - `decideApproval(draft: ChangeDraft, context: DocumentContext): ApprovalDecision`
    - `DocumentContext = { totalGrades: number; priceChangeCount: number }`
    - `ApprovalDecision = { auto: true } | { auto: false; reason: string }`
  - `MAX_PRICE_CHANGE_RATIO = 0.2`, `MIN_PLAUSIBLE_PRICE = 500_000`, `MAX_PLAUSIBLE_PRICE = 30_000_000`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/approval-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideApproval } from '@/pipeline/approval-rules';

const CONTEXT = { totalGrades: 6, priceChangeCount: 1 };

function priceChange(before: number, after: number) {
  return {
    kind: 'price_change' as const,
    targetKey: '6LA-MXWH61-AHXHB',
    diff: { price: { before, after } },
  };
}

describe('decideApproval — 人間に回すもの', () => {
  it('new_model は人間', () => {
    expect(decideApproval({ kind: 'new_model', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('new_grade は人間', () => {
    expect(decideApproval({ kind: 'new_grade', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('spec_change は人間（誤抽出と区別がつかない）', () => {
    expect(decideApproval({ kind: 'spec_change', targetKey: 'x', diff: {} }, CONTEXT).auto).toBe(
      false,
    );
  });

  it('discontinued は人間。抽出漏れを廃止と誤認して非公開にしないため', () => {
    const decision = decideApproval({ kind: 'discontinued', targetKey: 'x', diff: {} }, CONTEXT);
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/廃止|抽出/);
  });
});

describe('decideApproval — price_change の歯止め', () => {
  it('小幅な改定は自動', () => {
    expect(decideApproval(priceChange(4_000_000, 4_200_000), CONTEXT).auto).toBe(true);
  });

  it('値下げも自動', () => {
    expect(decideApproval(priceChange(4_000_000, 3_800_000), CONTEXT).auto).toBe(true);
  });

  it('±20%を超えたら人間', () => {
    const decision = decideApproval(priceChange(4_000_000, 5_000_000), CONTEXT);
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/20/);
  });

  it('境界（ちょうど20%）は自動', () => {
    expect(decideApproval(priceChange(4_000_000, 4_800_000), CONTEXT).auto).toBe(true);
  });

  it('安すぎる値は人間（桁の取り違えを疑う）', () => {
    expect(decideApproval(priceChange(500_000, 460_000), CONTEXT).auto).toBe(false);
  });

  it('高すぎる値は人間', () => {
    expect(decideApproval(priceChange(29_000_000, 31_000_000), CONTEXT).auto).toBe(false);
  });

  it('同じPDFでグレードの半数超の価格が動いたら人間（列の取り違えを疑う）', () => {
    const decision = decideApproval(priceChange(4_000_000, 4_100_000), {
      totalGrades: 6,
      priceChangeCount: 4,
    });
    expect(decision.auto).toBe(false);
    if (!decision.auto) expect(decision.reason).toMatch(/半数|4/);
  });

  it('ちょうど半数なら自動', () => {
    expect(
      decideApproval(priceChange(4_000_000, 4_100_000), { totalGrades: 6, priceChangeCount: 3 })
        .auto,
    ).toBe(true);
  });

  it('before が null（価格が無かった）なら人間', () => {
    const decision = decideApproval(
      { kind: 'price_change', targetKey: 'x', diff: { price: { before: null, after: 4_000_000 } } },
      CONTEXT,
    );
    expect(decision.auto).toBe(false);
  });

  it('after が null（価格が消えた）なら人間', () => {
    const decision = decideApproval(
      { kind: 'price_change', targetKey: 'x', diff: { price: { before: 4_000_000, after: null } } },
      CONTEXT,
    );
    expect(decision.auto).toBe(false);
  });

  it('diff の形が想定外なら人間（安全側に倒す）', () => {
    expect(
      decideApproval({ kind: 'price_change', targetKey: 'x', diff: {} }, CONTEXT).auto,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/unit/approval-rules.test.ts`
Expected: FAIL（`pipeline/approval-rules.ts` が存在しない）

- [ ] **Step 3: 実装する**

`pipeline/approval-rules.ts` を作る。要点:

```ts
/**
 * 自動承認は price_change だけ。しかも無条件ではない。
 *
 * 価格は公開ページの絞り込みと並び替えに直接効く（db/queries.ts）ため、
 * 誤った値がそのまま検索結果を歪める。3つの歯止めを置く。
 *
 * discontinued を自動にしないのは、「PDFに載っていない」ことの原因が
 * 「本当に廃止された」と「抽出が失敗した」の2つあり、区別がつかないためである。
 * 自動で通すと販売中のグレードを誤って非公開にする。
 * 取得失敗時に古いデータを黙って使わないのと同じ理由で、
 * 消える方向の変更も黙って通してはいけない。
 */
export const MAX_PRICE_CHANGE_RATIO = 0.2;
export const MIN_PLAUSIBLE_PRICE = 500_000;
export const MAX_PLAUSIBLE_PRICE = 30_000_000;
```

`decideApproval` の判定順:
1. `kind !== 'price_change'` → `{ auto: false, reason: 種別ごとの説明 }`
2. `diff.price` が `{ before: number, after: number }` の形でなければ → `auto: false`
3. `after` が `MIN_PLAUSIBLE_PRICE`〜`MAX_PLAUSIBLE_PRICE` の外 → `auto: false`
4. `|after - before| / before > MAX_PRICE_CHANGE_RATIO` → `auto: false`（浮動小数の誤差で境界がぶれないよう、`Math.abs(after - before) * 5 > before` のように整数で比較する）
5. `priceChangeCount * 2 > totalGrades` → `auto: false`
6. どれにも当たらなければ `{ auto: true }`

`reason` には必ず具体的な数値を入れる（「変化率 25% が上限 20% を超えています」）。管理画面にそのまま出す。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/unit/approval-rules.test.ts`
Expected: PASS。失敗0件、15件以上

- [ ] **Step 5: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: tsc エラー0件、テスト失敗0件・合計184件以上

- [ ] **Step 6: コミット**

```bash
git add pipeline/approval-rules.ts tests/unit/approval-rules.test.ts
git commit -m "feat: 自動承認ルール（price_change のみ条件付き自動）"
```

---

## Task 11: 変更の適用（冪等）

承認された `change_request` をグレードに反映する。neon-http にトランザクションが無いため、制約と状態遷移ガードで二重適用を防ぐ。

**Files:**
- Create: `pipeline/apply.ts`
- Test: `tests/integration/apply.test.ts`

**Interfaces:**
- Consumes: `changeRequests`, `grades`（`db/schema.ts`）/ `gradeSlug`（Task 3）/ `assertModelVerifiedForPublish`（`lib/publication.ts`）
- Produces:
  - `applyChangeRequest(id: string, decidedBy: string): Promise<ApplyResult>`
    - `ApplyResult = 'applied' | 'noop' | 'stale' | 'not_approved'`
  - `approveChangeRequest(id: string, decidedBy: string): Promise<boolean>`
  - `rejectChangeRequest(id: string, decidedBy: string): Promise<boolean>`

- [ ] **Step 1: 失敗する統合テストを書く**

`tests/integration/apply.test.ts` に次を含める。**行を作ったら必ず `afterEach` で消し、`grades` の件数と `publication_status` を元に戻すこと。**

- 承認していない `change_request` を適用すると `'not_approved'` が返り、DBが変わらない
- 承認済みを適用すると `'applied'` になり、`grades.price` が `diff.after` になる
- **同じものをもう一度適用すると `'noop'` が返り、二度目は何も起きない**（冪等性の核心）
- 適用前に対象行の値が `diff.before` と食い違っていたら `'stale'` になり、**上書きしない**
- `stale` になった `change_request` の `status` が `'stale'` に変わっている
- `applied` になった行の `applied_at` と `decided_by` が埋まっている
- 適用しても `publication_status` は `draft` のまま変わらない（公開は別の操作である）
- `new_grade` を適用すると行が1件増え、その `slug` が `gradeSlug(name, { powertrain, driveSystem })` と一致する
- 同じ `new_grade` をもう一度適用しても行は増えない（`'noop'` が返る）
- 同名・同パワートレイン・同駆動方式の `new_grade` を2件適用しようとすると、
  2件目は一意制約に弾かれ、`change_request` が `applied` にならない

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm run test:integration -- tests/integration/apply.test.ts`
Expected: FAIL（`pipeline/apply.ts` が存在しない）

- [ ] **Step 3: 実装する**

`pipeline/apply.ts` の要点:

```ts
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
```

処理順:
1. `change_request` を読む。`status !== 'approved'` なら `'not_approved'`（`'applied'` だった場合は `'noop'`）
2. 対象グレードを `target_key` で引き、`diff` の各項目の現在値が `before` と一致するか確認する。1つでも食い違えば `status` を `'stale'` にして `'stale'` を返す。**上書きしない**
3. `update change_requests set status='applied', applied_at=now(), decided_by=$2 where id=$1 and status='approved'` を先に実行する。更新行数が0なら他のプロセスが先に取ったので `'noop'`
4. 取れたときだけ本体を書き換える。単一行の UPDATE / INSERT に収める

種別ごとの本体処理:

| kind | 処理 |
|---|---|
| `price_change` / `spec_change` | `target_key` で引いた1行を UPDATE |
| `new_grade` | `grades` に INSERT。`slug` は `gradeSlug(name, { powertrain, driveSystem })` で作る。`publication_status` は既定の `draft` のまま。**公開はしない** |
| `new_model` | `models` に INSERT。`verified_at` は null のまま（人間が管理画面で検証する） |
| `discontinued` | `discontinued_at` を埋める。**`publication_status` は触らない**。非公開にするかは別の判断である |

`new_grade` の INSERT が一意制約で失敗した場合は、`change_request` を `applied` に
戻さず `stale` にする。既に同じグレードが別経路で入っている状態であり、
黙って上書きしてはいけない。

`approveChangeRequest` / `rejectChangeRequest` も同じ形の条件付き UPDATE にする（`where status='pending'`）。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS。失敗0件、合計37件以上

- [ ] **Step 5: DBが元の状態に戻っていることを確認**

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { sql } from 'drizzle-orm';
void (async () => {
  const { rows } = await db.execute(sql\`
    select (select count(*) from grades)::int g,
           (select count(*) from grades where publication_status='draft')::int d,
           (select count(*) from change_requests)::int c
  \`);
  console.log(rows[0]);
  const r = rows[0] as Record<string, number>;
  if (r.g !== 103 || r.d !== 103) process.exit(1);
})();
"
```

Run: 上のコマンド
Expected: `g: 103, d: 103` が表示され、終了コード0

- [ ] **Step 6: コミット**

```bash
git add pipeline/apply.ts tests/integration/apply.test.ts
git commit -m "feat: 変更の冪等な適用と承認・却下"
```

---

## Task 12: 承認キューの管理画面

車種単位（＝PDF1つ）で差分を確認して承認する画面。既存の管理画面と同じ認可の作法に従う。

**Files:**
- Create: `app/admin/changes/page.tsx`
- Create: `app/actions/changes.ts`
- Create: `components/ChangeRequestList.tsx`
- Modify: `db/admin-queries.ts`
- Test: `tests/integration/changes-authz.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`（`auth-guard.ts`）/ `approveChangeRequest`, `rejectChangeRequest`, `applyChangeRequest`（Task 11）
- Produces:
  - `listPendingChangeRequests(): Promise<GroupedChangeRequests[]>`（`db/admin-queries.ts`。`spec_document_id` ごとにまとめる）
  - Server Action `approveDocument(specDocumentId: string)` / `rejectDocument(specDocumentId: string)`

- [ ] **Step 1: 認可の統合テストを書く**

`tests/integration/changes-authz.test.ts`。既存の `tests/integration/authz.test.ts` と同じ作法（`vi.mock('@/auth')` でセッションを差し替える）で:

- 未認証で `approveDocument` を呼ぶと `AuthorizationError`
- 許可リストに無い GitHub ID で呼ぶと `AuthorizationError`
- 許可された ID なら通り、`change_requests.status` が `approved` になる

さらに**公開の可視性**を確かめる（設計書10章の完了条件9・10）:

- `new_grade` を承認・適用しても、そのグレードは `draft` のままで公開ページに出ない
  （`listPublishedGrades` の結果に含まれない）
- 親の車種が未検証のまま、そのグレードを `published` にしようとすると `UnverifiedModelError`
- 未承認（`pending`）の `change_request` は `listPublishedGrades` の結果に一切影響しない

このテストで `published` に変えた行は、必ず同じテスト内で `draft` に戻すこと。
全103件が draft であるのが正しい状態である。

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm run test:integration -- tests/integration/changes-authz.test.ts`
Expected: FAIL（`app/actions/changes.ts` が存在しない）

- [ ] **Step 3: 実装する**

- `app/admin/changes/page.tsx` は **必ず冒頭で `await requireAdmin()` を呼ぶ**。`app/admin/layout.tsx` の判定に頼らない（レイアウトはソフトナビゲーションで再実行されないことがある。既存の `app/admin/add/page.tsx` に同じコメントがある）
- 一覧は `spec_document_id` ごとにまとめて表示する。1つのPDFが1つの承認単位である（設計書7.2）
- 各変更には `kind`、対象、`diff` の before → after、そして**自動承認されなかった理由**（Task 10 の `reason`）を出す
- `discontinued` は目立つ色にする。非公開になる操作だからである
- Server Action は `requireAdmin()` を呼び、成功したら `revalidateTag('cars')` する

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS。失敗0件、合計40件以上

- [ ] **Step 5: ビルドと認可の実地確認**

```bash
npm run build
npm run dev &
sleep 5
curl -s -o /dev/null -w "/admin/changes -> %{http_code}\n" -L --max-redirs 0 http://localhost:3000/admin/changes
curl -s -o /dev/null -w "/ -> %{http_code}\n" http://localhost:3000/
kill %1
```

Run: 上のコマンド
Expected: build が ESLint 警告0で成功。`/admin/changes -> 307`（未認証はリダイレクト）、`/ -> 200`

- [ ] **Step 6: コミット**

```bash
git add app/admin/changes/page.tsx app/actions/changes.ts components/ChangeRequestList.tsx db/admin-queries.ts tests/integration/changes-authz.test.ts
git commit -m "feat: 承認キューの管理画面"
```

---

## Task 13: ゴールデンPDFによる回帰テスト

実物のプリウス諸元表をリポジトリに置き、抽出の正解を固定する。このPDF1つで「同名グレード問題」と「括弧記法」の両方を同時に担保できる。

**Files:**
- Create: `tests/fixtures/prius_spec_202607.pdf`
- Create: `tests/unit/golden-pdf.test.ts`
- Create: `.gitattributes`（PDFをバイナリ扱いにする）

**Interfaces:**
- Consumes: `countPdfPages`（Task 2）/ `assertPdfAcceptable`（Task 2）/ `extractSpec`, `createAnthropicClient`（Task 8）/ `normalizeGrades`（Task 9）
- Produces: なし（テストのみ）

- [ ] **Step 1: 実物のPDFを取得して固定する**

```bash
curl -sL -o tests/fixtures/prius_spec_202607.pdf \
  https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_202607.pdf
shasum -a 256 tests/fixtures/prius_spec_202607.pdf
wc -c tests/fixtures/prius_spec_202607.pdf
```

Run: 上のコマンド
Expected: 455398 バイト前後のファイルが保存される（メーカーが差し替えていればサイズは変わる。その場合は次のステップの期待値も実物に合わせる）

- [ ] **Step 2: 常に走るテストを書く（APIキー不要）**

`tests/unit/golden-pdf.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPdfAcceptable } from '@/lib/pdf-guard';
import { countPdfPages } from '@/pipeline/pdf';

const PDF_PATH = path.resolve(__dirname, '../fixtures/prius_spec_202607.pdf');
const bytes = new Uint8Array(readFileSync(PDF_PATH));

describe('ゴールデンPDF', () => {
  it('PDFとして読める', async () => {
    await expect(countPdfPages(bytes)).resolves.toBeGreaterThan(0);
  });

  it('事前検査を通る（本物の諸元表が弾かれないことの確認）', async () => {
    const pageCount = await countPdfPages(bytes);
    expect(() =>
      assertPdfAcceptable({ contentType: 'application/pdf', bytes, pageCount }),
    ).not.toThrow();
  });

  it('sha256 が安定している（変更検知の土台）', () => {
    const first = createHash('sha256').update(bytes).digest('hex');
    const second = createHash('sha256').update(bytes).digest('hex');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: 実APIを叩くテストを書く（キーが無ければ skip）**

同じファイルに追加する:

```ts
const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

// この環境に ANTHROPIC_API_KEY は無い。キーがあるときだけ走らせる。
// モックでは表構造の解釈という肝心な部分を検証できないため、実APIで確かめる。
describe.runIf(hasApiKey)('ゴールデンPDFの抽出', () => {
  it('同名グレードが別のレコードとして出る', async () => {
    const { createAnthropicClient, extractSpec } = await import('@/pipeline/extract');
    const { normalizeGrades } = await import('@/pipeline/diff');
    const { gradeKey } = await import('@/pipeline/diff');

    const result = await extractSpec(bytes, createAnthropicClient(process.env.ANTHROPIC_API_KEY!));
    expect(result.succeeded).toBe(true);
    if (!result.succeeded) return;

    const rows = normalizeGrades(result.spec);

    // 「Z」は 2.0L PHEV と 2.0L HV に1つずつある。統合されていないこと
    const zRows = rows.filter((row) => row.name === 'Z');
    expect(zRows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(zRows.map((row) => row.powertrain)).size).toBeGreaterThanOrEqual(2);

    // キーが全て異なる = 一意制約に衝突しない
    const keys = rows.map(gradeKey);
    expect(new Set(keys).size).toBe(keys.length);

    // 括弧記法が分解されている = 2WD と E-Four で重量が違う行がある
    const hybridRows = rows.filter((row) => row.powertrain.includes('2.0L ハイブリッド'));
    const weights = new Set(hybridRows.map((row) => row.weight));
    expect(weights.size).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
```

- [ ] **Step 4: テストが通る（またはskipされる）ことを確認**

Run: `npx vitest run tests/unit/golden-pdf.test.ts`
Expected: PASS。失敗0件。`ANTHROPIC_API_KEY` が無い環境では抽出テストが skip され、常時テスト3件が通る

- [ ] **Step 5: 全テストとビルド**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc エラー0件、テスト失敗0件・合計187件以上、build が ESLint 警告0で成功

- [ ] **Step 6: コミット**

```bash
git add tests/fixtures/prius_spec_202607.pdf tests/unit/golden-pdf.test.ts .gitattributes
git commit -m "test: ゴールデンPDFによる回帰テスト"
```

---

## Task 14: 収集スクリプトと GitHub Actions

ここまでの部品を1本につなぎ、週1回動かす。

**Files:**
- Create: `scripts/collect.ts`
- Create: `scripts/register-source.ts`
- Create: `.github/workflows/collect.yml`
- Modify: `package.json`
- Modify: `db/schema.ts`（`change_requests.reason` の追加）
- Modify: `db/admin-queries.ts`（保存された理由を優先する）
- Test: `tests/integration/collect.test.ts`

**Interfaces:**
- Consumes: Task 6〜10 の全て
- Produces:
  - `npm run collect`（`scripts/collect.ts`）
  - `npm run collect -- --dry-run`（DBに書かず、何が起きるかだけ出す）
  - `npm run register-source -- --model-slug <slug> --base-url <url>`

- [ ] **Step 1: `scripts/register-source.ts` を書く**

車種の slug と PDF ベースパスを受け取り `spec_sources` に1行入れる。ベースパスが `http` で始まらない、あるいは末尾が `_` でない場合は拒否する（年月を後ろに付ける前提のため）。

**パイロットではEV（bZ4X など）を登録しない。** 既存の `wltc_mode` は km/L を入れる想定で、
EVの電費（Wh/km）とは単位が違う。同じ列に混ぜると公開ページの並び替えと絞り込みが壊れる
（設計書3章・11章）。`engine_type` が `EV` になる車種を登録しようとしたら、
スクリプトは理由を示して拒否する。

- [ ] **Step 2: `scripts/collect.ts` を書く**

`spec_sources` を1件ずつ処理する。1件の失敗が他を止めないよう、各件を try/catch で囲む。

1. `findLatestMonth` で最新の年月を得る
   - `deadBaseUrl` → `consecutive_failures` を +1、`last_error` に理由を書いて次へ。3に達したら人間に上げる印を付ける
   - `isStale(found, now)` が真 → 「要確認」の印を付ける（別セクションIDに移った可能性）
2. `fetchAndValidate` で取得。既存の `spec_documents` に同じ `sha256` があれば `last_checked_at` だけ更新して次へ（**LLMを呼ばない**）
3. `spec_documents` に行を作り、PDF原本を `stored_path` に保存する
4. `extractSpec` を呼ぶ。結果は成否にかかわらず `extractions` に記録する
5. 成功したら `normalizeGrades` → `computeChanges` → `decideApproval`
6. `change_requests` に積む。`decideApproval` が `auto` なら `status='approved'`, `decided_by='system'` で入れ、続けて `applyChangeRequest` を呼ぶ。
   **`auto` でない場合は `reason` をそのまま `change_requests.reason` に保存する**（下記）
7. 成功時は `consecutive_failures` を0に戻し、`known_month` を更新する

`--dry-run` では 3 以降の書き込みを行わず、標準出力に何をするつもりかだけ出す。

**`change_requests.reason` を足す。** Task 12 の承認キュー画面は「自動承認されなかった理由」を
出すが、`decideApproval` の `reason` を保存する列がどのタスクにも無かったため、
`db/admin-queries.ts` が表示時に `decideApproval` を呼び直して復元している。

その復元は近似でしかない。`price_change` の判定は `DocumentContext.totalGrades`
（＝その諸元表に載っていたグレード総数）を見るが、抽出結果はその時点のものが残らないので、
親の車種の**現在の**グレード数で代用している。収集時から車種のグレード構成が変われば、
画面に出る理由が実際に人間へ回された理由とずれる。

判定した本人（`scripts/collect.ts`）がその場で書き残すのが正しい。

- `db/schema.ts` の `changeRequests` に `reason: text('reason')` を足し、`npm run db:generate` → `npm run db:migrate`
- `scripts/collect.ts` は `decideApproval` の戻りが `auto: false` のとき `reason` を一緒に INSERT する
- `db/admin-queries.ts` の `listPendingChangeRequests` は保存された `reason` を優先し、
  無い行（この変更より前に積まれたもの）だけ従来どおり `decideApproval` で復元する

- [ ] **Step 3: 統合テストを書く**

`tests/integration/collect.test.ts`。実ネットワークと実APIには触れず、`Http` と `ExtractionClient` を注入して:

- 同じ内容のPDFを2回処理すると、2回目は `extractions` が増えない（LLMを呼んでいない証拠）
- 2回続けて走らせても `change_requests` が重複しない
- 1件が失敗しても他の `spec_sources` の処理が続く
- `consecutive_failures` が3に達したら人間に上げる印が付く

テストで作った `spec_sources` は `afterEach` で必ず削除する（cascade で下位も消える）。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test:integration`
Expected: PASS。失敗0件、合計44件以上

- [ ] **Step 5: `.github/workflows/collect.yml` を書く**

```yaml
name: collect-specs
on:
  schedule:
    - cron: '0 20 * * 0'   # 毎週月曜 05:00 JST
  workflow_dispatch:

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run collect
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

ヘッドレスブラウザを入れない。年月探索方式にしたことで不要になった（設計書4章）。

- [ ] **Step 6: dry-run が通ることを確認**

Run: `npm run collect -- --dry-run`
Expected: エラーなく終了し、登録が0件なら「spec_sources に登録がありません」と表示される。DBの行数が変わらないこと

- [ ] **Step 7: 型チェックとビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc エラー0件、build が ESLint 警告0で成功

- [ ] **Step 8: コミット**

```bash
git add scripts/collect.ts scripts/register-source.ts .github/workflows/collect.yml package.json tests/integration/collect.test.ts
git commit -m "feat: 収集スクリプトと週1回の定期実行"
```

---

## Task 15: 【要確認】バックアップ手順の確立

**このタスクはループに乗せない。ユーザーの Neon アカウント操作が必要である。**

実データを1行でも書き込む前に、戻せることを確かめる。`npm run db:seed -- --force` が不可逆なのと同じ理由で、収集パイプラインも本物のデータを書き込む以上、復旧の道が要る。

**Files:**
- Create: `docs/operations/backup.md`

**手順:**

1. Neon のコンソールでプロジェクトの **PITR の保持期間**を確認し、`docs/operations/backup.md` に記録する
2. 収集を初めて走らせる直前に、Neon のブランチを1つ切る（例 `before-first-collect`）
3. **復旧を1度実演する** — ブランチから読み取り、`grades` が103件・全て `draft` であることを確認する
4. 実演した手順とコマンドを `docs/operations/backup.md` に書く

**完了の判断:** 復旧を実際に1度行い、その記録が `docs/operations/backup.md` にあること。手順を書いただけでは完了としない。

- [ ] **検証: 復旧したブランチの中身を確認**

```bash
npx tsx -e "
import { neon } from '@neondatabase/serverless';
void (async () => {
  const sql = neon(process.env.BACKUP_BRANCH_URL!);
  const [r] = await sql\`select count(*)::int g,
    count(*) filter (where publication_status='draft')::int d from grades\`;
  console.log(r);
  if (r.g !== 103 || r.d !== 103) process.exit(1);
})();
"
```

Run: 上のコマンド（`BACKUP_BRANCH_URL` に復旧ブランチの接続文字列を渡す）
Expected: `{ g: 103, d: 103 }` が表示され、終了コード0。**接続文字列そのものは表示しない**

- [ ] **コミット**

```bash
git add docs/operations/backup.md
git commit -m "docs: バックアップと復旧の手順"
```

---

## Task 16: 【要確認】トークン数の実測とコスト見積もり

**このタスクはループに乗せない。`ANTHROPIC_API_KEY` の設定が必要である。**

設計書のコスト概算（1車種あたり約$0.4、Batch API で半額）は公式ドキュメントの数値からの推定であり、実測していない。本実行の前に確かめる。

**Files:**
- Create: `scripts/estimate-cost.ts`
- Modify: `docs/superpowers/specs/2026-08-14-collection-pipeline-design.md`（6.4 に実測値を追記）

**手順:**

1. `ANTHROPIC_API_KEY` を `.env.local` に追加する（**このファイルの中身は絶対に出力しない**）
2. `scripts/estimate-cost.ts` を書く。ゴールデンPDFを `count_tokens` に通し、入力トークン数を出す
3. 1件だけ実際に抽出し、出力トークン数を測る
4. 設計書6.4の概算と突き合わせる。**桁が違えばモデル選択を見直す**
5. **暗号化されたPDFが受け付けられるかを、この最初の実呼び出しで必ず確かめる。**
   トヨタの諸元表は編集制限のために暗号化されている（`isEncryptedPdf` が true を返す）。
   一方 Claude API のPDF要件は「パスワード/暗号化なしの標準PDF」と書かれている。
   実際には空のユーザーパスワードなので通る見込みだが、確認していない。
   **拒否された場合は、収集の前段に復号の工程を足す**（GitHub Actions のランナーに
   `qpdf --decrypt` を入れるのが最も手軽である）。この確認を飛ばすと、
   Task 14 を全部組んだあとで全件が失敗することになる

- [ ] **検証**

Run: `npx tsx scripts/estimate-cost.ts`
Expected: 入力・出力のトークン数と、150件ぶんの見積もり金額が表示される

- [ ] **コミット**

```bash
git add scripts/estimate-cost.ts docs/superpowers/specs/2026-08-14-collection-pipeline-design.md
git commit -m "chore: トークン数の実測とコスト見積もり"
```

---

## 完了条件の達成状況（2026-08-29 時点）

設計書10章の11項目に対する現在地。**11項目中9つが達成、1つが部分達成、1つが未達。**

| # | 完了条件 | 状態 | 根拠 |
|---|---|---|---|
| 1 | build が ESLint 警告0で通り、テストが通る | ✅ | 単体255件 / 統合67件 PASS、警告0 |
| 2 | バックアップ手順が確立し、復旧を1度実演してある | ✅ | `docs/operations/backup.md`。`before-first-collect` ブランチで `{g:103, d:103}` を確認 |
| 3 | `spec_sources` にトヨタの数車種が登録され、年月探索で最新PDFを特定・取得できる | ✅ | プリウス→2026-07 / ヤリス→**2026-04**（遡って発見）。455,398 と 511,777 バイトを取得 |
| 4 | 同じPDFに2回実行したとき、2回目はLLMを呼ばない | ✅ | `tests/integration/collect.test.ts` が抽出クライアントの呼び出し回数で検証 |
| 5 | ゴールデンPDFの抽出結果が9章の期待値と一致する | ⚠️ **部分** | 同名グレード・括弧記法の**同定は正解データで検証済み**（APIキー不要、`golden-pdf.test.ts` 11件）。実抽出の突き合わせはキー待ち |
| 6 | `change_requests` に差分が積まれ、管理画面から車種単位で承認できる | ✅ | `/admin/changes`。`changes-authz.test.ts` |
| 7 | 2回続けて走らせても `change_requests` が重複しない | ✅ | `collect.test.ts`。`onConflictDoNothing` + 一意制約 |
| 8 | 承認の適用を2回実行しても、2回目は何も起きない | ✅ | `apply.test.ts` が `'noop'` を検証 |
| 9 | 承認したグレードだけが公開ページに現れる | ✅ | `changes-authz.test.ts`。適用後も `draft` のまま公開されない |
| 10 | 未承認・未検証車種配下のものが公開されない | ✅ | 同上 + `publication.test.ts` |
| 11 | トークン数とコストが記録され、150件展開時の見積もりが出せる | ❌ **未達** | `ANTHROPIC_API_KEY` が必要（Task 16） |

### 条件3の実行記録

```
$ npm run collect -- --dry-run
収集（dry-run: 書き込みません）
  トヨタ プリウス: 2026-07 を取得して抽出する（455398 バイト / 6 ページ）
  トヨタ ヤリス: 2026-04 を取得して抽出する（511777 バイト / 6 ページ）
対象 2 件 / 変更なし 2 / 抽出 0 / 失敗 0 / 変更 0 件（自動適用 0）/ 要確認 0
```

ヤリスが 2026-04 で見つかったことが年月探索の実証になっている。今月ぶんから
順に遡り、200 が返った最初の年月で止まるという設計どおりに動いた。
dry-run 前後で `spec_documents` / `extractions` / `change_requests` はいずれも0のまま。

取得したプリウスPDFの sha256 は
`392d766fcd286955c5193c8595a0e41a6925c40759972af37a80c711fde96bb6` で、
`tests/fixtures/prius_spec_202607.pdf` と**一致した**。
フィクスチャは現行の公開文書そのものであり、変更検知の基準として正しい。

また `register-source` の2つの防御も実地で確認した。

- bZ4X（EV）は「wltc_mode は km/L の列で電費とは単位が違う」と理由を示して拒否
- 末尾が `_` でないベースパスも拒否
- 同じベースパスの二重登録は「既に登録済みです」で何もしない

### 残る2つについて

**条件11（未達）** は `ANTHROPIC_API_KEY` が要る。無人の定期実行にも同じキーが要るため、
本番運用に進む段階で避けられない。ただし収集を始める前提条件ではない。

**条件5（部分）** は、抽出そのものを走らせない範囲で確かめられることを先に済ませてある。
実物から起こした正解データに対し、同名グレードが別レコードになること・
括弧記法が展開されていること・複合キーが8件とも異なることを検証済み。
キーが入れば、実抽出の型式8件と件数を正解データと突き合わせるテストがそのまま走る。

### Task 5: プリウスの実データ取り込み（承認キューまで）

正解データから起こした `tests/fixtures/prius.spec.json`（8グレード）を
`npm run ingest-spec -- --model-slug prius` でそのまま取り込んだ（APIキー不要）。

```
$ npm run collect
  トヨタ プリウス: 2026-07 は前回と同じ内容
  トヨタ ヤリス: 2026-04 は前回と同じ内容
$ npm run ingest-spec -- --model-slug prius
プリウス: 変更 9 件を積みました（重複で飛ばした分 0 件）
```

`change_requests` に `new_grade` 8件・`discontinued` 1件が `pending` で積まれ、
`grades` は103件・全 `draft` のまま変わっていない（未承認のため）。条件6・7は
これで実データでも成立を確認できた。

**この工程で「価格の壁」が確定した。** `new_grade` を承認・適用しようとすると
`grades.price` が NOT NULL である一方、諸元表に車両本体価格が載っていないため、
`pipeline/apply.ts` の `buildNewGradeValues` が価格の無い作成を拒み `stale` になる。
これはバグではなく正しい挙動である（詳細は設計書7.4末尾の2026-08-29追記）。
このため Task 5 の検証範囲は「承認キューに積まれるところまで」とし、
プリウスの8件は承認せず `pending` のまま残してある。

---

## 積み残し（このサブプロジェクトの範囲外）

サブプロジェクト1から持ち越し、まだ解消していないもの。

- ~~`modelId` がグレード更新時に無防備（別の車種に付け替えられる）~~ → 2026-08-29 に解消。`assertModelUnchanged` を追加し、公開ゲートの回避を統合テストで再現・確認したうえで塞いだ
- **価格の壁（2026-08-29 確定）**: 諸元表からの取り込みは既存グレードの諸元更新に
  限られ、新規グレード（`new_grade`）の作成は現状のスキーマ・パイプラインでは
  できない。`grades.price` が NOT NULL で、諸元表に車両本体価格が無いため。
  解消には価格の取得元（案B、設計書7.4）か、管理画面での人手入力が要る。
  プリウスの `new_grade` 8件は承認キューに `pending` のまま残っている
- 車種メタデータの編集UIが無い
- `npm audit` の残り7件（3 high / 4 moderate）。いずれも Next 16 か drizzle-kit のダウングレードが必要
- GitHub OAuth App の作成と Vercel へのデプロイ（ユーザーの作業。サブプロジェクト1の完了条件11が未達のまま）

