import { describe, expect, it } from 'vitest';
import { gradeSlug, manufacturerSlug, modelSlug } from '@/lib/slug';

describe('manufacturerSlug', () => {
  it('既知の9メーカーをローマ字にする', () => {
    expect(manufacturerSlug('トヨタ')).toBe('toyota');
    expect(manufacturerSlug('日産')).toBe('nissan');
    expect(manufacturerSlug('レクサス')).toBe('lexus');
    expect(manufacturerSlug('三菱')).toBe('mitsubishi');
  });

  it('未知のメーカーは決定的なハッシュにする', () => {
    const first = manufacturerSlug('未知自動車');
    expect(first).toMatch(/^maker-[0-9a-f]{6}$/);
    expect(manufacturerSlug('未知自動車')).toBe(first);
  });
});

describe('modelSlug', () => {
  it('officialUrl の末尾セグメントを最優先する', () => {
    expect(modelSlug('プリウス', 'https://toyota.jp/prius/')).toBe('prius');
    expect(modelSlug('クラウンクロスオーバー', 'https://toyota.jp/crown/crossover/')).toBe('crossover');
  });

  it('URLが使えないときはASCII名から作る', () => {
    expect(modelSlug('C-HR', '')).toBe('c-hr');
    expect(modelSlug('N-BOX', '')).toBe('n-box');
    expect(modelSlug('MAZDA2', '')).toBe('mazda2');
    expect(modelSlug('WRX S4', '')).toBe('wrx-s4');
  });

  it('どちらも使えないときは決定的なハッシュにする', () => {
    const first = modelSlug('カローラ', '');
    expect(first).toMatch(/^model-[0-9a-f]{6}$/);
    expect(modelSlug('カローラ', '')).toBe(first);
  });

  it('異なる車種名は異なるハッシュになる', () => {
    expect(modelSlug('カローラ', '')).not.toBe(modelSlug('カムリ', ''));
  });

  it('非ASCII名から作った異なる車種のslugが衝突しない', () => {
    expect(modelSlug('eKワゴン', '')).not.toBe(modelSlug('eKスペース', ''));
  });

  it('非ASCII混じりの名前は読める接頭辞とハッシュを持つ', () => {
    expect(modelSlug('eKワゴン', '')).toMatch(/^ek-[0-9a-f]{6}$/);
  });

  it('全ASCIIの名前はハッシュを付けない', () => {
    expect(modelSlug('C-HR', '')).toBe('c-hr');
    expect(modelSlug('WRX S4', '')).toBe('wrx-s4');
  });

  it('officialUrl があるときは非ASCII名でもURL由来を優先する', () => {
    expect(modelSlug('プリウス', 'https://toyota.jp/prius/')).toBe('prius');
  });
});

describe('gradeSlug', () => {
  it('記号と空白をハイフンに畳む', () => {
    expect(gradeSlug('S-Z')).toBe('s-z');
    expect(gradeSlug('HYBRID G')).toBe('hybrid-g');
    expect(gradeSlug('Type S')).toBe('type-s');
  });

  it('ASCIIにできないグレード名はハッシュにする', () => {
    expect(gradeSlug('標準')).toMatch(/^grade-[0-9a-f]{6}$/);
  });
});

describe('gradeSlug — パワートレイン・駆動方式による識別', () => {
  it('第2引数が無ければ従来と同じ結果（既存103件の slug を変えないため）', () => {
    expect(gradeSlug('Z')).toBe('z');
    expect(gradeSlug('G')).toBe('g');
    expect(gradeSlug('X')).toBe('x');
  });

  it('空の識別子も従来と同じ扱い', () => {
    expect(gradeSlug('Z', {})).toBe('z');
    expect(gradeSlug('Z', { powertrain: '', driveSystem: null })).toBe('z');
  });

  it('プリウスの同名グレードが別の slug になる', () => {
    const phev = gradeSlug('Z', { powertrain: '2.0L プラグインハイブリッド車', driveSystem: 'FF' });
    const hybrid = gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: 'FF' });

    expect(phev).not.toBe(hybrid);
    expect(phev).toBe('z-20phev-ff');
    expect(hybrid).toBe('z-20hv-ff');
  });

  it('駆動方式だけが違う場合も分かれる', () => {
    expect(gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: '4WD' })).toBe(
      'z-20hv-4wd',
    );
  });

  it('排気量が違えば分かれる', () => {
    expect(gradeSlug('U', { powertrain: '1.8L ハイブリッド車', driveSystem: 'FF' })).toBe(
      'u-18hv-ff',
    );
  });

  it('ガソリン・ディーゼル・EVも短縮される', () => {
    expect(gradeSlug('G', { powertrain: '1.5L ガソリン車', driveSystem: 'FF' })).toBe('g-15gas-ff');
    expect(gradeSlug('G', { powertrain: '2.2L ディーゼル車', driveSystem: '4WD' })).toBe(
      'g-22diesel-4wd',
    );
  });

  it('変速機だけが違うパワートレインを区別する', () => {
    /*
     * ヤリスの実データで実際に衝突した。1.5L ガソリンの Z/G/X には CVT と 6MT が
     * あり、どちらも 15gas に潰れて unique(model_id, slug) に弾かれ、
     * 適用が stale になっていた（先に適用された6MT側が z-15gas-ff を取った）。
     */
    const cvt = gradeSlug('Z', { powertrain: '1.5L ガソリン車・CVT', driveSystem: 'FF' });
    const mt = gradeSlug('Z', { powertrain: '1.5L ガソリン車・6MT', driveSystem: 'FF' });

    expect(cvt).toBe('z-15gas-cvt-ff');
    expect(mt).toBe('z-15gas-mt-ff');
    expect(cvt).not.toBe(mt);
  });

  it('変速機の記載が無ければ何も足さない（発行済みの slug を変えない）', () => {
    // slug は一度発行したら変えないという規約がある。プリウスは既に公開中で、
    // ここが変わると共有URLと訪問者の localStorage の参照が壊れる
    expect(gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: 'FF' })).toBe(
      'z-20hv-ff',
    );
    expect(gradeSlug('Z', { powertrain: '2.0L プラグインハイブリッド車', driveSystem: 'FF' })).toBe(
      'z-20phev-ff',
    );
    expect(gradeSlug('G', { powertrain: '1.5L ガソリン車', driveSystem: 'FF' })).toBe('g-15gas-ff');
  });

  it('DCT を MT に食わせない', () => {
    // 「デュアルクラッチ」も「MT」の正規表現に当たりうるため、判定順が要る
    expect(gradeSlug('S', { powertrain: '1.6L ガソリン車・DCT', driveSystem: 'FF' })).toBe(
      's-16gas-dct-ff',
    );
  });

  it('実物のヤリスの全19構成が衝突しない', () => {
    // yaris_spec_202604.pdf の12列を 2WD / E-Four・4WD に展開したもの
    const rows: Array<readonly [string, string, string]> = [];
    for (const name of ['Z', 'G', 'X', 'U']) {
      rows.push([name, '1.5L ハイブリッド車', 'FF'], [name, '1.5L ハイブリッド車', '4WD']);
    }
    for (const name of ['Z', 'G', 'X']) {
      rows.push(
        [name, '1.5L ガソリン車・CVT', 'FF'],
        [name, '1.5L ガソリン車・CVT', '4WD'],
        [name, '1.5L ガソリン車・6MT', 'FF'],
      );
    }
    for (const name of ['G', 'X']) rows.push([name, '1.0L ガソリン車・CVT', 'FF']);

    const slugs = rows.map(([name, powertrain, driveSystem]) =>
      gradeSlug(name, { powertrain, driveSystem }),
    );

    expect(new Set(slugs).size).toBe(rows.length);
    expect(slugs).toContain('z-15gas-cvt-ff');
    expect(slugs).toContain('z-15gas-mt-ff');
    expect(slugs).toContain('g-10gas-cvt-ff');
  });

  it('軽自動車の小数2桁の排気量も slug に入る', () => {
    // 0.66L は小数1桁しか見ない規則だと排気量が落ちて a-gas-ff になっていた
    expect(gradeSlug('HYBRID X', { powertrain: '0.66L ハイブリッド車', driveSystem: 'FF' })).toBe(
      'hybrid-x-066hv-ff',
    );
    expect(gradeSlug('L', { powertrain: '0.66L ガソリン車', driveSystem: '4WD' })).toBe(
      'l-066gas-4wd',
    );
  });

  it('小数1桁の既存表記は変わらない（発行済みの slug を守る）', () => {
    expect(gradeSlug('Z', { powertrain: '2.0L ハイブリッド車', driveSystem: 'FF' })).toBe('z-20hv-ff');
    expect(gradeSlug('Z', { powertrain: '1.5L ガソリン車・CVT', driveSystem: 'FF' })).toBe(
      'z-15gas-cvt-ff',
    );
  });

  it('未知のパワートレイン表記はハッシュで区別する（衝突させない）', () => {
    const a = gradeSlug('Z', { powertrain: '謎の動力源A', driveSystem: 'FF' });
    const b = gradeSlug('Z', { powertrain: '謎の動力源B', driveSystem: 'FF' });

    expect(a).not.toBe(b);
    expect(a).toMatch(/^z-[0-9a-f]{6}-ff$/);
  });

  it('駆動方式だけがある場合も従来の slug とは別になる', () => {
    expect(gradeSlug('Z', { driveSystem: 'FF' })).toBe('z-ff');
  });

  it('非ASCIIのグレード名でも従来の後方互換を保つ', () => {
    const legacy = gradeSlug('ハイブリッドG');
    expect(gradeSlug('ハイブリッドG', {})).toBe(legacy);
  });

  it('実物のプリウスの全8構成が衝突しない', () => {
    // prius_spec_202607.pdf の列構成そのもの。
    // 2.0L PHEV は 2WD のみ、2.0L HV と 1.8L HV は 2WD/E-Four の両方がある。
    // このタスクが存在する理由がこの8行であり、旧規則では3種類に潰れていた。
    const rows = [
      ['Z', '2.0L プラグインハイブリッド車', 'FF'],
      ['G', '2.0L プラグインハイブリッド車', 'FF'],
      ['Z', '2.0L ハイブリッド車', 'FF'],
      ['Z', '2.0L ハイブリッド車', '4WD'],
      ['G', '2.0L ハイブリッド車', 'FF'],
      ['G', '2.0L ハイブリッド車', '4WD'],
      ['U', '1.8L ハイブリッド車', 'FF'],
      ['U', '1.8L ハイブリッド車', '4WD'],
    ] as const;

    const slugs = rows.map(([name, powertrain, driveSystem]) =>
      gradeSlug(name, { powertrain, driveSystem }),
    );

    expect(new Set(slugs).size).toBe(rows.length);
    expect(slugs).toContain('z-20phev-ff');
    expect(slugs).toContain('z-20hv-ff');
    expect(slugs).toContain('z-20hv-4wd');

    // 旧規則（名前のみ）では Z/G/U の3種類に潰れることを明示しておく
    expect(new Set(rows.map(([name]) => gradeSlug(name))).size).toBe(3);
  });
});
