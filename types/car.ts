/**
 * 移行前のフラットな `Car` モデル（Car / Engine / Safety / Comfort /
 * FilterParams / SortOption / Transmission）はすべて削除した。
 *
 * それらはDBの構造と食い違っており、特に Transmission の union は
 * '6AT' / '10AT' を表現できない — この移行で直した欠陥そのものだった。
 * 列挙型は db/schema.ts（値の実体は db/enums.ts）、行の型は
 * grades.$inferSelect / db/queries.ts の戻り値型を使うこと。
 * 検索条件は db/queries.ts の GradeFilters、並び順は同ファイルの sort が持つ。
 *
 * ここに残すのは、DBのどの行にも対応しない純粋な表示用の型だけ。
 */

/** PriceHistoryChart が受け取る1点。price_history テーブルの (date, price) に対応する */
export interface PriceHistoryPoint {
  date: string;    // YYYY-MM
  price: number;   // 価格（円）
}
