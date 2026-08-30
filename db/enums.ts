/**
 * DBの enum 型に入る値の唯一の定義。
 *
 * db/schema.ts がこの配列から pgEnum を作るので、ここが増減すればDBの型が増減する。
 * UI（絞り込み・診断）の選択肢もここを読む — 同じ列挙をファイルごとに書き直すと、
 * 片方だけ増えたときに「選べるのにDBに入らない値」や「DBにあるのに選べない値」が
 * 生まれる。
 *
 * drizzle-orm を import しない葉モジュールにしてある。Client Component が
 * db/schema.ts を実行時 import すると、ORM 一式がブラウザのバンドルに入るため。
 */

export const BODY_TYPES = [
  '軽自動車', 'コンパクトカー', 'セダン', 'ハッチバック',
  'ステーションワゴン', 'SUV', 'ミニバン', 'スポーツカー', 'クーペ',
] as const;

export const ENGINE_TYPES = ['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV'] as const;

export const DRIVE_SYSTEMS = ['FF', 'FR', '4WD', 'MR', 'RR'] as const;

export const TRANSMISSION_TYPES = [
  'CVT', 'AT', 'MT', 'DCT', '電気式無段変速機', 'other',
] as const;

export const FEATURE_AVAILABILITIES = ['standard', 'option', 'none', 'unknown'] as const;

export const PUBLICATION_STATUSES = ['draft', 'published', 'archived'] as const;

/** change_requests.kind。承認ルール（pipeline/approval-rules.ts）がこの値で分岐する */
export const CHANGE_KINDS = [
  'new_model', 'new_grade', 'price_change', 'spec_change', 'discontinued',
] as const;

/**
 * change_requests.status。
 *
 * stale は「適用しようとしたら対象行が既に変わっていた」状態で、
 * 上書きせず人間に戻すために使う（トランザクションが無い前提の冪等性、設計書5.4）。
 *
 * blocked は「承認されているが、必要な値が欠けていて適用できない」状態。
 * stale と分けているのは、対処がまったく違うためである。
 * stale は人間が差分を見直す話で、blocked は欠けている値を入れれば解決する。
 * 実例: 諸元表に車両本体価格が載っていないため、そこから起こした new_grade は
 * grades.price（NOT NULL）を埋められず blocked になる。
 * blocked は approved と同じく再適用できる。値が揃えば押し直せばよい。
 */
export const CHANGE_STATUSES = [
  'pending', 'approved', 'rejected', 'applied', 'stale', 'blocked',
] as const;
