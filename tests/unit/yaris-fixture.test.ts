import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtractedSpecSchema } from '@/pipeline/extraction-schema';
import { normalizeGrades } from '@/pipeline/diff';

/*
 * ヤリスの取り込み用JSONを守る。
 *
 * 諸元表は12列（HV 1.5L: Z/G/X/U、ガソリン1.5L CVT: Z/G/X、ガソリン1.0L: G/X、
 * ガソリン1.5L 6MT: Z/G/X）で、各列に 2WD と E-Four/4WD の型式が別々に載っている。
 * 4WD が「ー」の列は 2WD のみ。展開すると19グレードになる。
 *
 * pdftotext は12列のうち10列しか出さないため画像から目視で読んだ。読み違いは
 * ここで止める。
 */
const spec = ExtractedSpecSchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/yaris.spec.json'), 'utf8')),
);

describe('ヤリスの取り込み用JSON', () => {
  it('19グレードある', () => {
    expect(spec.grades).toHaveLength(19);
  });

  it('型式が一意である', () => {
    const types = spec.grades.map((g) => g.typeDesignation);
    expect(new Set(types).size).toBe(types.length);
  });

  it('グレード識別子（名前/パワートレイン/駆動方式）が一意である', () => {
    // computeChanges はこの組でグレードを突き合わせる。重複すると取り違える
    const keys = normalizeGrades(spec).map((r) => `${r.name}/${r.powertrain}/${r.driveSystem}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('KINTO専用の U 2件だけが価格を持たない', () => {
    const unpriced = spec.grades.filter((g) => g.price === null);
    expect(unpriced.map((g) => g.typeDesignation).sort()).toEqual([
      '6AA-MXPH14-AHXKB',
      '6AA-MXPH17-AHXKB',
    ]);
    expect(unpriced.every((g) => g.name === 'U')).toBe(true);
  });

  it('型式の頭文字がパワートレインと対応する', () => {
    // 6AA- はハイブリッド、5BA- はガソリン。取り違えると別の車の諸元が混ざる
    for (const g of spec.grades) {
      const hybrid = g.engineType === 'ハイブリッド';
      expect(g.typeDesignation?.startsWith(hybrid ? '6AA-' : '5BA-')).toBe(true);
    }
  });

  it('4WD が設定されているのはハイブリッドと1.5LガソリンCVTだけ', () => {
    // 1.0L と 6MT は諸元表の E-Four/4WD 行が「ー」
    const fourWheel = normalizeGrades(spec).filter((r) => r.driveSystem === '4WD');
    expect(fourWheel).toHaveLength(7);
    for (const row of fourWheel) {
      expect(['1.5L ハイブリッド車', '1.5L ガソリン車・CVT']).toContain(row.powertrain);
    }
  });

  it('4WD は同じグレードの2WDより重く、燃費が悪い', () => {
    const rows = normalizeGrades(spec);
    const twoWheel = new Map(
      rows
        .filter((r) => r.driveSystem === 'FF')
        .map((r) => [`${r.name}/${r.powertrain}`, r] as const),
    );

    for (const row of rows.filter((r) => r.driveSystem === '4WD')) {
      const pair = twoWheel.get(`${row.name}/${row.powertrain}`);
      expect(pair, `${row.name}/${row.powertrain} の2WDが無い`).toBeDefined();
      expect(row.weight!).toBeGreaterThan(pair!.weight!);
      expect(Number(row.wltcMode)).toBeLessThan(Number(pair!.wltcMode));
    }
  });

  it('同じパワートレインでは Z が G より、G が X より高い', () => {
    // 目視の読み取りで価格と型式を取り違えていないかの検算
    const priceOf = (name: string, powertrain: string, drive: string) =>
      spec.grades.find(
        (g) => g.name === name && g.powertrain === powertrain && g.driveSystemRaw === drive,
      )?.price;

    for (const [powertrain, drive] of [
      ['1.5L ハイブリッド車', '2WD'],
      ['1.5L ハイブリッド車', 'E-Four'],
      ['1.5L ガソリン車・CVT', '2WD'],
      ['1.5L ガソリン車・CVT', '4WD'],
      ['1.5L ガソリン車・6MT', '2WD'],
    ] as const) {
      const z = priceOf('Z', powertrain, drive)!;
      const g = priceOf('G', powertrain, drive)!;
      const x = priceOf('X', powertrain, drive)!;
      expect(z, `${powertrain} ${drive}`).toBeGreaterThan(g);
      expect(g, `${powertrain} ${drive}`).toBeGreaterThan(x);
    }
  });

  it('全19グレードが装備20項目を持ち、unknown を残していない', () => {
    // 部分的に入れてはいけない。ingest-spec は全グレードが features を持つときだけ
    // 装備を比較する（compareOptionsFor）
    for (const g of spec.grades) {
      expect(Object.keys(g.features ?? {})).toHaveLength(20);
      expect(Object.values(g.features ?? {})).not.toContain('unknown');
    }
  });

  it('ヤリスに設定の無い装備は全グレード none', () => {
    // PDF全体を検索しても記載が無い6項目。ヤリスはコンパクトカーで、
    // アドバンストパークやパワーバックドアの設定そのものが存在しない
    for (const column of [
      'parkingAssist',
      'powerSeat',
      'steeringHeater',
      'powerBackDoor',
      'handsFreeBackDoor',
      'sunroof',
    ] as const) {
      for (const g of spec.grades) {
        expect(g.features?.[column], `${g.name} の ${column}`).toBe('none');
      }
    }
  });

  it('装備の数がグレードの序列と矛盾しない', () => {
    // 20項目×7列を目視で読み取っているため、上位グレードが下位より
    // 標準装備が少ないという結果は読み違いの兆候になる
    const count = (name: string, powertrain: string) => {
      const row = spec.grades.find((g) => g.name === name && g.powertrain === powertrain);
      if (!row?.features) throw new Error(`${powertrain} の ${name} が見つかりません`);
      return Object.values(row.features).filter((v) => v === 'standard').length;
    };

    for (const powertrain of ['1.5L ハイブリッド車', '1.5L ガソリン車・CVT'] as const) {
      expect(count('Z', powertrain)).toBeGreaterThan(count('X', powertrain));
    }
  });

  it('1.0L はレーダークルーズを持たない（脚注＊33）', () => {
    // 「1.0Lには、レーダークルーズコントロールの設定がありません」
    const litre10 = spec.grades.filter((g) => g.displacement === 996);
    expect(litre10).toHaveLength(2);
    for (const g of litre10) expect(g.features?.adaptiveCruiseControl).toBe('none');
  });

  it('6MT の G と X は駐車支援系を持たない（装備表の「CVT」注記）', () => {
    /*
     * ガソリンの G/X 列のセルには「CVT」と注記があり、その版にだけ適用される
     * ことを示す。6MT版には代わりにクリアランスソナー＆バックソナーが入る
     * 対の行があり、この読み方の裏付けになっている。
     */
    const mt = spec.grades.filter(
      (g) => g.powertrain.includes('6MT') && (g.name === 'G' || g.name === 'X'),
    );
    expect(mt).toHaveLength(2);
    for (const g of mt) {
      expect(g.features?.falseStartSuppression).toBe('none');
      expect(g.features?.adaptiveCruiseControl).toBe('none');
    }

    // Z の6MTには注記が無いので限定を及ぼさない
    const zmt = spec.grades.find((g) => g.powertrain.includes('6MT') && g.name === 'Z');
    expect(zmt?.features?.falseStartSuppression).toBe('standard');
  });

  it('読み取りの根拠と、判断が割れた点が記録されている', () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(__dirname, '../fixtures/yaris.spec.json'), 'utf8'),
    ) as { _featureProvenance?: Record<string, unknown> };

    // レーダークルーズの注記は原本から一意に読めない。どう判断したかを残す
    expect(raw._featureProvenance?.ambiguity).toBeTruthy();
    expect(raw._featureProvenance?.appliedExceptions).toBeTruthy();
  });
});
