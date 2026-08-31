import { createHash } from 'node:crypto';

const MANUFACTURERS: Record<string, string> = {
  トヨタ: 'toyota',
  日産: 'nissan',
  ホンダ: 'honda',
  マツダ: 'mazda',
  スバル: 'subaru',
  スズキ: 'suzuki',
  ダイハツ: 'daihatsu',
  三菱: 'mitsubishi',
  レクサス: 'lexus',
};

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 6);
}

/** 非ASCII文字を含むかチェック */
function hasNonAscii(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

/**
 * ローマ数字はグレード名によく出る（マツダの「15C Ⅱ」など）。
 *
 * 非ASCIIなので、そのままだと slug がハッシュ混じりになる（15c-adfbd1）。
 * 公開URLとして読めないので、ASCII に写してから slug にする。
 */
const ROMAN_NUMERALS: Record<string, string> = {
  '\u2160': 'i', '\u2161': 'ii', '\u2162': 'iii', '\u2163': 'iv', '\u2164': 'v',
  '\u2165': 'vi', '\u2166': 'vii', '\u2167': 'viii', '\u2168': 'ix', '\u2169': 'x',
};

function expandRomanNumerals(value: string): string {
  return value.replace(/[\u2160-\u2169]/g, (letter) => ROMAN_NUMERALS[letter] ?? letter);
}

/** ASCII英数字だけを残したslug。作れないときは空文字 */
function asciiSlug(value: string): string {
  return expandRomanNumerals(value)
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function manufacturerSlug(name: string): string {
  const known = MANUFACTURERS[name];
  if (known) return known;

  const ascii = asciiSlug(name);
  return ascii || `maker-${shortHash(name)}`;
}

export function modelSlug(model: string, officialUrl: string): string {
  const fromUrl = urlTailSegment(officialUrl);
  if (fromUrl) return fromUrl;

  if (hasNonAscii(model)) {
    const ascii = asciiSlug(model);
    return ascii ? `${ascii}-${shortHash(model)}` : `model-${shortHash(model)}`;
  } else {
    const ascii = asciiSlug(model);
    return ascii || `model-${shortHash(model)}`;
  }
}

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
 * パワートレイン表記に現れる変速機と、slug に使う短縮形。
 *
 * 排気量と動力源だけでは足りない。ヤリスには「1.5L ガソリン車・CVT」と
 * 「1.5L ガソリン車・6MT」が同じ Z/G/X で並び、どちらも 15gas になって
 * unique(model_id, slug) に衝突した。
 */
const TRANSMISSION_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  // 「6MT」「5MT」「MT」およびカタカナ表記。DCT を先に見ないと MT に食われる
  [/DCT|デュアルクラッチ/i, 'dct'],
  [/\d*\s*MT(?![A-Za-z])|マニュアル/i, 'mt'],
  [/CVT|無段変速/i, 'cvt'],
  [/\d*\s*AT(?![A-Za-z])|オートマチック/i, 'at'],
];

/**
 * パワートレイン表記を slug 用の短い記号にする。
 * 「2.0L プラグインハイブリッド車」→「20phev」
 * 「1.5L ガソリン車・6MT」→「15gas-mt」
 *
 * 排気量まで含めるのは、同じ動力源で排気量だけが違う設定があるためである
 * （プリウスの 2.0L ハイブリッドと 1.8L ハイブリッド）。
 * 変速機まで含めるのは、同じ動力源・同じ排気量で変速機だけが違う設定が
 * あるためである（ヤリスの 1.5L ガソリン CVT と 6MT）。
 *
 * 変速機の記載が無い表記には何も足さない。既に発行済みの slug を変えないためで、
 * プリウスの「2.0L ハイブリッド車」は 20hv のままである。
 *
 * どの規則にも当てはまらない表記はハッシュにする。捨てて衝突させるより、
 * 読めない文字列でも区別できるほうがよい。
 */
function powertrainToken(powertrain: string): string {
  // 軽自動車は 0.66L のように小数2桁で書く。1桁しか見ないと排気量が slug から落ちる
  const displacement = /(\d)\.(\d{1,2})\s*L/i.exec(powertrain);
  const size = displacement ? `${displacement[1]}${displacement[2]}` : '';

  let transmission = '';
  for (const [pattern, token] of TRANSMISSION_TOKENS) {
    if (pattern.test(powertrain)) {
      transmission = `-${token}`;
      break;
    }
  }

  for (const [pattern, token] of POWERTRAIN_TOKENS) {
    if (pattern.test(powertrain)) return `${size}${token}${transmission}`;
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
  const ascii = asciiSlug(grade);
  // ローマ数字を写したあとで判定する。写せた文字はハッシュで区別する必要が無い
  const base = hasNonAscii(expandRomanNumerals(grade))
    ? ascii
      ? `${ascii}-${shortHash(grade)}`
      : `grade-${shortHash(grade)}`
    : ascii || `grade-${shortHash(grade)}`;

  const parts = [base];

  const powertrain = discriminator?.powertrain?.trim();
  if (powertrain) parts.push(powertrainToken(powertrain));

  const driveSystem = discriminator?.driveSystem?.trim();
  if (driveSystem) parts.push(asciiSlug(driveSystem) || shortHash(driveSystem));

  return parts.join('-');
}

function urlTailSegment(officialUrl: string): string {
  if (!officialUrl) return '';
  try {
    const path = new URL(officialUrl).pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return '';
    const tail = path.split('/').pop() ?? '';
    return asciiSlug(tail);
  } catch {
    return '';
  }
}
