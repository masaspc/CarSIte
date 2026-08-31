import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS } from '@/db/schema';
import { matchFeature } from '@/lib/feature-vocabulary';
import { normalizeGrades } from '@/pipeline/diff';
import { ExtractedSpecSchema } from '@/pipeline/extraction-schema';

/*
 * ホンダ フィットの取り込み用JSONを守る。
 *
 * トヨタと構造が違う点が多いので、取り違えやすいところを固定しておく。
 * 経緯は docs/research/2026-08-31-honda-structure.md。
 */
const raw = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/fit.spec.json'), 'utf8'),
) as {
  grades: Array<Record<string, unknown>>;
  _featureProvenance?: { rowMapping?: Record<string, string> };
};
const spec = ExtractedSpecSchema.parse(raw);

describe('フィットの取り込み用JSON', () => {
  it('通常モデル11グレード（福祉車両は含めない）', () => {
    expect(spec.grades).toHaveLength(11);
    for (const grade of spec.grades) {
      expect(grade.name, grade.name).not.toContain('助手席回転シート車');
    }
  });

  it('グレード識別子が一意である', () => {
    const keys = normalizeGrades(spec).map((r) => `${r.name}/${r.powertrain}/${r.driveSystem}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('型式は一意でない（ホンダでは1つが複数バリアントを覆う）', () => {
    /*
     * 6AA-GR3 は e:HEV X(FF) / e:HEV Z(FF) / e:HEV RS(FF) を覆う。
     * 型式を自然キーにできないことの実例であり、複合キーで同定している理由。
     */
    const types = spec.grades.map((g) => g.typeDesignation);
    expect(new Set(types).size).toBeLessThan(types.length);
    expect(types.filter((t) => t === '6AA-GR3')).toHaveLength(3);
  });

  it('powertrain は排気量＋動力源に正規化されている', () => {
    // e:HEV をそのまま入れると gradeSlug がハッシュになり、
    // メーカーをまたいだ比較もできなくなる
    for (const grade of spec.grades) {
      expect(['1.5L ハイブリッド車', '1.5L ガソリン車']).toContain(grade.powertrain);
      expect(grade.powertrain).not.toContain('e:HEV');
    }
    // ホンダの商品名は name に残る
    expect(spec.grades.map((g) => g.name)).toContain('e:HEV CROSSTAR');
  });

  it('〈 〉はオプション装着車の値なので採らない（トヨタの ［ ］とは違う）', () => {
    /*
     * 原本は全高を 1.515〈1.540〉と書く。〈 〉内はメーカーオプション装着車の値で、
     * トヨタの ［ ］（E-Four/4WD の値）とは意味が違う。素の値を採っている。
     */
    const height = (name: string, drive: string) =>
      spec.grades.find((g) => g.name === name && g.driveSystemRaw === drive)!.dimensions!.height;

    expect(height('e:HEV X', 'FF')).toBe(1515);
    expect(height('e:HEV X', '4WD')).toBe(1540);
    // 〈1.540〉を4WDの値と取り違えると FF と 4WD が同じ 1540 になる
    expect(height('e:HEV X', 'FF')).not.toBe(height('e:HEV X', '4WD'));
  });

  it('寸法は mm に直してある（原本は m）', () => {
    for (const grade of spec.grades) {
      expect(grade.dimensions!.length).toBeGreaterThan(3000);
      expect(grade.dimensions!.wheelbase).toBe(2530);
    }
  });

  it('4WD は同じグレードの2WDより重く、燃費が悪い', () => {
    const byKey = new Map(spec.grades.map((g) => [`${g.name}/${g.driveSystemRaw}`, g]));
    for (const grade of spec.grades.filter((g) => g.driveSystemRaw === '4WD')) {
      const two = byKey.get(`${grade.name}/FF`);
      expect(two, grade.name).toBeDefined();
      expect(grade.weight!).toBeGreaterThan(two!.weight!);
      expect(grade.wltcMode!).toBeLessThan(two!.wltcMode!);
    }
  });

  it('燃費の総合値が3モードの範囲に収まる', () => {
    // 列を1つずらして読んでいれば壊れる
    for (const grade of spec.grades) {
      const modes = [
        grade.fuelDetail!.cityMode,
        grade.fuelDetail!.suburbanMode,
        grade.fuelDetail!.highwayMode,
      ].filter((v): v is number => typeof v === 'number');
      const label = `${grade.name}/${grade.driveSystemRaw}`;
      expect(grade.wltcMode!, label).toBeGreaterThanOrEqual(Math.min(...modes));
      expect(grade.wltcMode!, label).toBeLessThanOrEqual(Math.max(...modes));
    }
  });

  it('ハイブリッドはガソリンより燃費が良く、出力表記が違う', () => {
    const hv = spec.grades.filter((g) => g.engineType === 'ハイブリッド');
    const gas = spec.grades.filter((g) => g.engineType === 'ガソリン');
    expect(Math.min(...hv.map((g) => g.wltcMode!))).toBeGreaterThan(
      Math.max(...gas.map((g) => g.wltcMode!)),
    );
    expect(hv[0].performance!.maxPower).toBe('78［106］/6,000-6,400');
    expect(gas[0].performance!.maxPower).toBe('87［118］/6,600');
  });

  it('Honda SENSING の5項目が全グレード標準', () => {
    // 1行が5列を埋める。トヨタは1行1機能だった
    for (const column of [
      'collisionMitigationBrake',
      'falseStartSuppression',
      'laneDepartureWarning',
      'laneKeepingAssist',
      'adaptiveCruiseControl',
    ] as const) {
      for (const grade of spec.grades) {
        expect(grade.features?.[column], `${grade.name} の ${column}`).toBe('standard');
      }
    }
  });

  it('ガソリンXはLEDヘッドライトとオートエアコンを持たない（ハロゲン・マニュアル）', () => {
    const x = spec.grades.filter((g) => g.name === 'X');
    expect(x).toHaveLength(2);
    for (const grade of x) {
      expect(grade.features?.ledHeadlight).toBe('none');
      expect(grade.features?.autoAircon).toBe('none');
    }
  });

  it('フィットに設定の無い装備は全グレード none', () => {
    for (const column of ['parkingAssist', 'powerSeat', 'powerBackDoor', 'handsFreeBackDoor', 'sunroof'] as const) {
      for (const grade of spec.grades) {
        expect(grade.features?.[column], `${grade.name} の ${column}`).toBe('none');
      }
    }
  });

  it('バックカメラは根拠が無いところを unknown にしてある', () => {
    /*
     * 原本に単独の行が無い。カメラの記載はマルチビューカメラシステムだけで、
     * これが ◎ のグレードは option とした。それ以外は原本が何も述べていない。
     * none にすると「後方カメラが無い」と主張することになるが根拠が無いため
     * unknown を残している。埋めるには別の資料が要る。
     */
    const values = spec.grades.map((g) => g.features?.backCamera);
    expect(values).toContain('unknown');
    expect(values).toContain('option');
    expect(values).not.toContain('standard');
  });

  it('rowMapping が20項目あり、辞書と食い違わない', () => {
    const mapping = raw._featureProvenance?.rowMapping ?? {};
    expect(Object.keys(mapping).sort()).toEqual([...FEATURE_COLUMNS].sort());

    for (const column of FEATURE_COLUMNS) {
      const note = mapping[column];
      if (note.startsWith('記載なし') || note.startsWith('【不確実】')) continue;
      expect(matchFeature(note).map((m) => m.column), `${column}: ${note.slice(0, 30)}`).toContain(
        column,
      );
    }
  });
});
