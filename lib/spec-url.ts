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
