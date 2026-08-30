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
