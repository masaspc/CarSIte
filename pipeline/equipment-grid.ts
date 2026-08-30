import type { FeatureAvailability } from '@/db/schema';

/**
 * 装備一覧表の読み取り。
 *
 * 諸元表の主要諸元はテキストとして取れるが、装備一覧表は「緑＝標準装備／
 * 橙＝メーカーオプション／青＝販売店装着オプション／白＝設定なし」という色でしか
 * 情報を持っていない。テキスト抽出ではセルが空になる。
 *
 * そこでページを画像に書き出し、セルの背景色を判定する。ここにあるのはその
 * 純粋な部分（PPMの解析・色の分類・行の帯の検出）で、外部コマンドの実行と
 * 画面出力は scripts/read-equipment.ts にある。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Bitmap {
  width: number;
  height: number;
  at(x: number, y: number): Rgb;
}

/**
 * pdftoppm が出す PPM（P6）を読む。
 *
 * 画像ライブラリを足さずに済ませるための選択である。P6 は
 * 「P6・空白・幅・空白・高さ・空白・最大値・空白1文字」のあとに RGB が
 * 3バイトずつ並ぶだけの形式で、解析に依存関係が要らない。
 */
export function parsePpm(bytes: Uint8Array): Bitmap {
  let offset = 0;

  const token = (): string => {
    // コメント行（#〜改行）と空白を読み飛ばす
    for (;;) {
      while (offset < bytes.length && isWhitespace(bytes[offset])) offset += 1;
      if (bytes[offset] !== 0x23) break; // '#'
      while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1;
    }
    const start = offset;
    while (offset < bytes.length && !isWhitespace(bytes[offset])) offset += 1;
    return new TextDecoder().decode(bytes.subarray(start, offset));
  };

  const magic = token();
  if (magic !== 'P6') {
    throw new Error(`PPM の形式が P6 ではありません（${magic}）`);
  }
  const width = Number(token());
  const height = Number(token());
  const maxValue = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PPM のサイズを読めません（${width}x${height}）`);
  }
  if (maxValue !== 255) {
    throw new Error(`PPM の最大値が 255 ではありません（${maxValue}）。8bit のみ扱う`);
  }
  offset += 1; // 最大値の直後の空白1文字だけがデータの区切り

  const pixels = bytes.subarray(offset);
  const expected = width * height * 3;
  if (pixels.length < expected) {
    throw new Error(`PPM の画素数が足りません（${pixels.length} < ${expected}）`);
  }

  return {
    width,
    height,
    at(x, y) {
      const i = (y * width + x) * 3;
      return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
    },
  };
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/**
 * 凡例のスウォッチから実測した基準色。
 *
 * トヨタの諸元表2種（プリウス2026-07 / ヤリス2026-04）で同一だった。
 * 別のメーカーで違えば --legend で上書きできるようにしてある。
 */
export const DEFAULT_LEGEND: Record<string, Rgb> = {
  standard: { r: 193, g: 223, b: 196 },
  option: { r: 255, g: 233, b: 192 },
  dealerOption: { r: 188, g: 228, b: 250 },
  none: { r: 255, g: 255, b: 255 },
};

/**
 * 販売店装着オプションは option に畳む。
 *
 * feature_availability は standard / option / none / unknown の4値しかなく、
 * 工場装着かどうかを区別する値を持たない。買い手から見れば「追加費用を払えば付く」
 * という点でメーカーオプションと同じである。
 */
export function toFeatureAvailability(key: string): FeatureAvailability {
  if (key === 'standard') return 'standard';
  if (key === 'option' || key === 'dealerOption') return 'option';
  if (key === 'none') return 'none';
  return 'unknown';
}

/** 基準色からの距離がこれを超えたら「分からない」として報告する */
const MAX_DISTANCE = 40;

export function classify(color: Rgb, legend: Record<string, Rgb> = DEFAULT_LEGEND): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const [name, reference] of Object.entries(legend)) {
    const distance = Math.hypot(
      color.r - reference.r,
      color.g - reference.g,
      color.b - reference.b,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }

  return bestDistance <= MAX_DISTANCE ? best : null;
}

/** 罫線と文字は暗い。背景色を見たいので落とす */
const DARK_THRESHOLD = 430;

/**
 * セルの背景色を「明るい画素の最頻値」で決める。
 *
 * 平均にすると、価格が書き込まれたセルで文字の黒が混ざって色が沈む。
 * 最頻値なら文字が何割を占めても背景の色が残る。
 */
export function sampleCell(
  bitmap: Bitmap,
  scale: number,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
): Rgb | null {
  const counts = new Map<number, number>();
  const x0 = Math.max(0, Math.round((centerX - halfWidth) * scale));
  const x1 = Math.min(bitmap.width - 1, Math.round((centerX + halfWidth) * scale));
  const y0 = Math.max(0, Math.round((centerY - halfHeight) * scale));
  const y1 = Math.min(bitmap.height - 1, Math.round((centerY + halfHeight) * scale));

  for (let x = x0; x <= x1; x += 2) {
    for (let y = y0; y <= y1; y += 2) {
      const { r, g, b } = bitmap.at(x, y);
      if (r + g + b <= DARK_THRESHOLD) continue;
      // 8階調に丸めて量子化ノイズを潰す
      const key = ((r >> 3) << 16) | ((g >> 3) << 8) | (b >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  let bestKey = -1;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  if (bestKey < 0) return null;

  return {
    r: ((bestKey >> 16) & 0xff) << 3,
    g: ((bestKey >> 8) & 0xff) << 3,
    b: (bestKey & 0xff) << 3,
  };
}

export interface Band {
  /** PDF座標（pt）での帯の上端と下端 */
  top: number;
  bottom: number;
  /** 列ごとの判定結果。判定できなかった列は null */
  values: Array<string | null>;
}

export interface ScanOptions {
  from: number;
  to: number;
  /** 走査の刻み（pt）。既定 0.5 */
  step?: number;
  /** これより短い帯は罫線をまたいだ一瞬の値として捨てる（pt）。既定 1.5 */
  minHeight?: number;
}

/**
 * y方向に走査して、判定結果が変わらない区間（＝表の行）に切り分ける。
 *
 * 罫線から行を検出する方式は使わない。複数行にわたるラベルは開始位置が行の上端より
 * 3〜5pt 上に出るため、ラベルの y をそのまま使うと1行ずれる。実際に
 * 「ETCの行を読んでいるつもりでスピーカーの行を読む」取り違えが起きた。
 * 値そのものの変化で切れば、ラベルの位置に依存しない。
 *
 * そのかわり、どの帯がどの装備の行かは人が確かめる必要がある。
 */
export function scanBands(
  sample: (y: number) => Array<string | null>,
  options: ScanOptions,
): Band[] {
  const step = options.step ?? 0.5;
  const minHeight = options.minHeight ?? 1.5;
  const bands: Band[] = [];

  for (let y = options.from; y <= options.to; y += step) {
    const values = sample(y);
    const last = bands[bands.length - 1];
    if (last && sameValues(last.values, values)) {
      last.bottom = y;
    } else {
      bands.push({ top: y, bottom: y, values });
    }
  }

  return bands.filter((band) => band.bottom - band.top >= minHeight);
}

function sameValues(a: Array<string | null>, b: Array<string | null>): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface Word {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
}

/** pdftotext -bbox が出す XHTML から語と位置を取り出す */
export function parseBbox(xml: string): Word[] {
  const pattern =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  const words: Word[] = [];

  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    words.push({
      xMin: Number(match[1]),
      yMin: Number(match[2]),
      xMax: Number(match[3]),
      yMax: Number(match[4]),
      text: decodeEntities(match[5]),
    });
  }
  return words;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface Column {
  label: string;
  center: number;
}

/**
 * 表頭からグレード列を見つける。
 *
 * 装備一覧表の列見出しは1文字のグレード名（Z / G / X / U など）が並ぶ。
 * ページ上部にある1〜2文字の英字を左から順に拾えば列の中心が取れる。
 */
export function findColumns(words: Word[], headerBelow = 80): Column[] {
  return words
    .filter((word) => word.yMin < headerBelow && /^[A-Z][A-Z0-9]?$/.test(word.text))
    .map((word) => ({ label: word.text, center: (word.xMin + word.xMax) / 2 }))
    .sort((a, b) => a.center - b.center);
}

/**
 * 帯に対応しうる行ラベルを、左端の列から拾う。
 *
 * ラベルの上端は行の上端より上に出ることがあるため、帯の上に少し広げて探す。
 * 候補を複数返すのは、正解を1つに決めるのが自動化できないからである
 * （決められると誤解したことが読み違いの原因になった）。
 */
export function labelsNear(words: Word[], band: Band, labelRightOf: number, slack = 6): string[] {
  return words
    .filter(
      (word) =>
        word.xMin < labelRightOf && word.yMin >= band.top - slack && word.yMin <= band.bottom,
    )
    .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
    .map((word) => word.text);
}
