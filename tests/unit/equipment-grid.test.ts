import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEGEND,
  classify,
  findColumns,
  labelsNear,
  parseBbox,
  parsePpm,
  sampleCell,
  scanBands,
  toFeatureAvailability,
  type Rgb,
} from '@/pipeline/equipment-grid';

function ppm(width: number, height: number, pixel: (x: number, y: number) => Rgb): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const body = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { r, g, b } = pixel(x, y);
      const i = (y * width + x) * 3;
      body[i] = r;
      body[i + 1] = g;
      body[i + 2] = b;
    }
  }
  return new Uint8Array([...header, ...body]);
}

const GREEN = DEFAULT_LEGEND.standard;
const ORANGE = DEFAULT_LEGEND.option;
const WHITE = DEFAULT_LEGEND.none;
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

describe('parsePpm', () => {
  it('P6 を読んで画素を返す', () => {
    const bitmap = parsePpm(ppm(2, 2, (x, y) => ({ r: x * 10, g: y * 20, b: 30 })));
    expect(bitmap.width).toBe(2);
    expect(bitmap.height).toBe(2);
    expect(bitmap.at(1, 1)).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('コメント行を読み飛ばす', () => {
    const header = new TextEncoder().encode('P6\n# pdftoppm\n1 1\n255\n');
    const bitmap = parsePpm(new Uint8Array([...header, 7, 8, 9]));
    expect(bitmap.at(0, 0)).toEqual({ r: 7, g: 8, b: 9 });
  });

  it('P6 以外は拒否する', () => {
    // P3（ASCII形式）を黙って読むと画素がずれた結果を返してしまう
    const p3 = new TextEncoder().encode('P3\n1 1\n255\n0 0 0\n');
    expect(() => parsePpm(p3)).toThrow(/P6 ではありません/);
  });

  it('画素が足りなければ失敗する', () => {
    const header = new TextEncoder().encode('P6\n4 4\n255\n');
    expect(() => parsePpm(new Uint8Array([...header, 1, 2, 3]))).toThrow(/画素数が足りません/);
  });
});

describe('classify', () => {
  it('凡例の色をそのまま分類する', () => {
    expect(classify(GREEN)).toBe('standard');
    expect(classify(ORANGE)).toBe('option');
    expect(classify(DEFAULT_LEGEND.dealerOption)).toBe('dealerOption');
    expect(classify(WHITE)).toBe('none');
  });

  it('わずかな量子化のずれは吸収する', () => {
    expect(classify({ r: GREEN.r + 6, g: GREEN.g - 4, b: GREEN.b + 2 })).toBe('standard');
  });

  it('どの色にも遠ければ null を返す（黙って一番近い色に倒さない）', () => {
    // 別メーカーの凡例が違ったときに、間違った値を静かに書き込まないための線
    expect(classify({ r: 200, g: 40, b: 40 })).toBeNull();
  });
});

describe('toFeatureAvailability', () => {
  it('販売店装着オプションはメーカーオプションと同じ option に畳む', () => {
    // feature_availability に工場装着かどうかを区別する値が無いため
    expect(toFeatureAvailability('dealerOption')).toBe('option');
    expect(toFeatureAvailability('option')).toBe('option');
  });

  it('未知の分類は unknown', () => {
    expect(toFeatureAvailability('なにか')).toBe('unknown');
  });
});

describe('sampleCell', () => {
  it('文字が混じっていても背景色を返す', () => {
    // 価格が書き込まれたセルでは黒い画素が多く混ざる。平均を取ると色が沈むので最頻値を使う
    const bitmap = parsePpm(ppm(40, 40, (x, y) => (y % 3 === 0 ? BLACK : GREEN)));
    const color = sampleCell(bitmap, 1, 20, 20, 10, 10);
    expect(classify(color!)).toBe('standard');
  });

  it('全部が暗ければ null（章見出しの帯）', () => {
    const bitmap = parsePpm(ppm(20, 20, () => BLACK));
    expect(sampleCell(bitmap, 1, 10, 10, 5, 5)).toBeNull();
  });
});

describe('scanBands', () => {
  const sample = (y: number) => {
    if (y < 10) return ['standard', 'standard'];
    if (y < 20) return ['standard', 'none'];
    return ['option', 'option'];
  };

  it('値が変わらない区間を1つの帯にまとめる', () => {
    const bands = scanBands(sample, { from: 0, to: 30 });
    expect(bands).toHaveLength(3);
    expect(bands[0].values).toEqual(['standard', 'standard']);
    expect(bands[1].values).toEqual(['standard', 'none']);
    expect(bands[2].values).toEqual(['option', 'option']);
  });

  it('短すぎる帯は捨てる（罫線をまたいだ一瞬の値）', () => {
    const spike = (y: number) => (y >= 10 && y < 10.5 ? ['none'] : ['standard']);
    expect(scanBands(spike, { from: 0, to: 20 })).toHaveLength(2);
  });
});

describe('parseBbox / findColumns / labelsNear', () => {
  const xml = `<doc><page width="841" height="595">
    <word xMin="250.0" yMin="60.0" xMax="254.0" yMax="70.0">Z</word>
    <word xMin="305.0" yMin="60.0" xMax="309.0" yMax="70.0">G</word>
    <word xMin="48.0" yMin="100.0" xMax="120.0" yMax="106.0">&amp;バックソナー</word>
    <word xMin="48.0" yMin="112.0" xMax="120.0" yMax="118.0">パワーバックドア</word>
    <word xMin="600.0" yMin="112.0" xMax="640.0" yMax="118.0">脚注テキスト</word>
  </page></doc>`;
  const words = parseBbox(xml);

  it('実体参照を戻す', () => {
    expect(words[2].text).toBe('&バックソナー');
  });

  it('表頭の1文字を左から順に列にする', () => {
    const columns = findColumns(words);
    expect(columns.map((c) => c.label)).toEqual(['Z', 'G']);
    expect(columns[0].center).toBe(252);
  });

  it('行ラベルの候補は帯の上に広げて拾う', () => {
    /*
     * ラベルの上端は行の上端より3〜5pt上に出る。狭く取ると正解のラベルを
     * 取り逃がし、機械的に対応づけると1行ずれる。候補を複数返して人に判断させる。
     */
    const band = { top: 114, bottom: 120, values: [] };
    expect(labelsNear(words, band, 240)).toEqual(['パワーバックドア']);

    // 右端の脚注は行ラベルではないので拾わない
    expect(labelsNear(words, band, 240)).not.toContain('脚注テキスト');
  });

  it('帯の上端ぴったりのラベルも拾う', () => {
    const band = { top: 104, bottom: 110, values: [] };
    expect(labelsNear(words, band, 240)).toContain('&バックソナー');
  });
});
