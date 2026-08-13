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
