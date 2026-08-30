import { describe, expect, it } from 'vitest';
import { FEATURE_COLUMNS } from '@/db/schema';
import {
  FEATURE_VOCABULARY,
  matchFeature,
  normalizeTerm,
} from '@/lib/feature-vocabulary';

describe('辞書の完全性', () => {
  it('20項目すべてに表記がある', () => {
    for (const column of FEATURE_COLUMNS) {
      const entry = FEATURE_VOCABULARY[column];
      expect(entry, column).toBeDefined();
      expect(entry.toyota.length, column).toBeGreaterThan(0);
      expect(entry.label, column).toBeTruthy();
    }
  });

  it('比較表の表示名と一致する', () => {
    // lib/comparison-diff.ts の FEATURE_NAME と食い違うと、
    // 画面の名前と辞書の名前が別物になる
    expect(FEATURE_VOCABULARY.collisionMitigationBrake.label).toBe('衝突被害軽減ブレーキ');
    expect(FEATURE_VOCABULARY.adaptiveCruiseControl.label).toBe('ACC');
    expect(FEATURE_VOCABULARY.camera360.label).toBe('360度カメラ');
  });

  it('実物で確認していない表記は observedIn が空である', () => {
    /*
     * 他社をトヨタの表記に合わせる以上、基準のトヨタ側が実物由来でなければ
     * 推測に推測を重ねることになる。確認済みかどうかを持たせておく。
     */
    const unverified = FEATURE_COLUMNS.filter(
      (column) => FEATURE_VOCABULARY[column].observedIn.length === 0,
    );
    // この2車種の諸元表に記載が無かったのはハンズフリーバックドアだけ
    expect(unverified).toEqual(['handsFreeBackDoor']);
  });

  it('他社の表記はまだ入っていない（読んでから足す）', () => {
    // 読まずに書くと推測が混ざる。実際にその諸元表を読んだときに足す
    for (const column of FEATURE_COLUMNS) {
      expect(Object.keys(FEATURE_VOCABULARY[column].others), column).toEqual([]);
    }
  });
});

describe('normalizeTerm', () => {
  it('全角と半角の違いを吸収する', () => {
    // 同一PDF内で全角と半角が混在する（発見4）
    expect(normalizeTerm('ＥＴＣ２.０ユニット')).toBe(normalizeTerm('ETC2.0ユニット'));
  });

  it('記号と空白を落とす', () => {
    expect(normalizeTerm('●スマートエントリー＆スタートシステム（スマートキー×2）')).toContain(
      'スマートエントリー',
    );
    expect(normalizeTerm('トヨタ チームメイト')).toBe(normalizeTerm('トヨタチームメイト'));
  });
});

describe('matchFeature — 実物の行ラベル', () => {
  const cases: Array<[string, string]> = [
    ['プリクラッシュセーフティ（歩行者［昼夜］・自転車［昼夜］', 'collisionMitigationBrake'],
    ['パーキングサポートブレーキ（前後方静止物）', 'falseStartSuppression'],
    ['レーンディパーチャーアラート（ステアリング制御機能付）［LDA］', 'laneDepartureWarning'],
    ['レーントレーシングアシスト［LTA］', 'laneKeepingAssist'],
    ['レーダークルーズコントロール（全車速追従機能付）', 'adaptiveCruiseControl'],
    ['レーダークルーズ', 'adaptiveCruiseControl'],
    ['パノラミックビューモニター（床下透過表示機能付）❷', 'camera360'],
    ['バックガイドモニター', 'backCamera'],
    ['ディスプレイオーディオ（コネクティッドナビ対応）Plus', 'navigation'],
    ['ETC2.0ユニット（VICS機能付）', 'etc'],
    ['ETC車載器', 'etc'],
    ['前席シートヒーター（3段階温度設定）', 'seatHeater'],
    ['シートヒーター（運転席・助手席）', 'seatHeater'],
    ['ステアリングヒーター・タッチセンサー付', 'steeringHeater'],
    ['オートエアコン＆ダイヤル式ヒーターコントロールパネル（ピアノブラックパネル）', 'autoAircon'],
    ['Bi-Beam LEDヘッドランプ＋LEDターンランプ', 'ledHeadlight'],
    ['3灯式フルLEDヘッドランプ（マニュアルレベリング機能付）', 'ledHeadlight'],
    ['●スマートエントリー＆スタートシステム（スマートキー×2）', 'smartKey'],
    ['スマートエントリー（運転席・助手席・バックドア/アンサーバック機能付）', 'smartKey'],
    ['パワーバックドア', 'powerBackDoor'],
    ['パノラマルーフ（手動サンシェード付）', 'sunroof'],
    ['運転席8ウェイパワースポーティ（前後スライド・リクライニング', 'powerSeat'],
  ];

  it.each(cases)('「%s」→ %s', (label, column) => {
    // 実物の諸元表から取った行ラベルそのもの。読み直しの手間を減らすのが目的なので、
    // 実物が当たらなければ意味がない
    expect(matchFeature(label)[0]?.column).toBe(column);
  });

  it('知らない表記は空を返す（黙って近いものに倒さない）', () => {
    // 新しいメーカーの初回は必ずこうなる。警告の材料にする
    expect(matchFeature('Honda SENSING 360')).toEqual([]);
    expect(matchFeature('アイサイトX')).toEqual([]);
  });

  it('当たったものを全部返し、長い表記を先に置く', () => {
    /*
     * 「パワーバックドア」は「ハンズフリーパワーバックドア」の一部でもある。
     * 機械的に1つ選ぶと取り違えるため、全部返して人に選ばせる。
     */
    const matches = matchFeature('ハンズフリーパワーバックドア');
    expect(matches.map((m) => m.column)).toEqual(['handsFreeBackDoor', 'powerBackDoor']);
  });

  it('どの表記で当たったかを返す', () => {
    const [match] = matchFeature('パーキングサポートブレーキ（前後方静止物）＊6');
    expect(match.term).toBe('パーキングサポートブレーキ（前後方静止物）');
    expect(match.manufacturer).toBe('トヨタ');
  });

  it('駐車支援の別の行を誤発進抑制に入れない', () => {
    /*
     * 「パーキングサポートブレーキ」には（前後方静止物）（後方接近車両）
     * （後方歩行者）（周囲静止物）の4行がある。（周囲静止物）はアドバンストパークと
     * 同じ行で、誤発進抑制ではない。表記を短くすると全部に当たってしまう。
     */
    expect(matchFeature('パーキングサポートブレーキ（後方接近車両）')).toEqual([]);
    expect(matchFeature('パーキングサポートブレーキ（周囲静止物）')).toEqual([]);
  });
});
