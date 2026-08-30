import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';

/**
 * 装備の表記とDB列の対応。
 *
 * 同じ機能をメーカーごとに違う名前で書く。衝突被害軽減ブレーキひとつでも
 * トヨタは「プリクラッシュセーフティ」、ホンダは「衝突軽減ブレーキ〈CMBS〉」、
 * 日産は「インテリジェント エマージェンシーブレーキ」、スバルは「プリクラッシュ
 * ブレーキ」と書く。対応づけを毎回その場で判断していると車種ごとに基準がぶれ、
 * ぶれても誰も気づけない。
 *
 * **トヨタの表記を基準にし、他社をそれに寄せる。** 最初に取り込んだ2車種が
 * トヨタで、実物を読んで確かめた表記がそこにあるためである。
 *
 * この辞書は判断を置き換えない。`scripts/read-equipment.ts` が候補を出し、
 * 知らない表記を見逃さないようにするためのもので、括弧の中身や注記まで含めた
 * 最終判断は人が行う。PDFの読み取りで取っている立場と同じである。
 */

/** 表記を確認したメーカー。実際にその諸元表を読んだときだけ足す */
export type Manufacturer = 'トヨタ' | 'ホンダ' | '日産' | 'スバル' | 'マツダ' | 'スズキ' | 'ダイハツ' | '三菱';

export interface FeatureTerms {
  /** 比較表の表示名 */
  label: string;
  /**
   * 基準となるトヨタの表記。実物の諸元表から取ったものだけを入れる。
   * 推測で書くと、その推測に他社を合わせることになる。
   */
  toyota: string[];
  /**
   * 実物で確認できた出所。空なら「トヨタの表記もまだ実物で見ていない」という意味で、
   * 他社の対応づけの基準にしてはいけない。
   */
  observedIn: string[];
  /** 他社の表記。実際にその諸元表を読んだときに足す */
  others: Partial<Record<Exclude<Manufacturer, 'トヨタ'>, string[]>>;
}

export const FEATURE_VOCABULARY: Record<FeatureColumn, FeatureTerms> = {
  collisionMitigationBrake: {
    label: '衝突被害軽減ブレーキ',
    toyota: ['プリクラッシュセーフティ'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  falseStartSuppression: {
    label: '誤発進抑制機能',
    // 「パーキングサポートブレーキ」だけにすると（後方接近車両）（周囲静止物）にも当たる。
    // （周囲静止物）はアドバンストパークと同じ行にあり、別の列に入る
    toyota: ['パーキングサポートブレーキ（前後方静止物）'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  laneDepartureWarning: {
    label: '車線逸脱警報',
    toyota: ['レーンディパーチャーアラート'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  laneKeepingAssist: {
    label: '車線維持支援',
    toyota: ['レーントレーシングアシスト'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  adaptiveCruiseControl: {
    label: 'ACC',
    // ヤリスは行ラベルが「レーダークルーズ」で改行され、続きが別セルにある
    toyota: ['レーダークルーズコントロール', 'レーダークルーズ'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  blindSpotMonitor: {
    label: 'ブラインドスポットモニター',
    toyota: ['ブラインドスポットモニター'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  camera360: {
    label: '360度カメラ',
    toyota: ['パノラミックビューモニター'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  parkingAssist: {
    label: '駐車支援システム',
    toyota: ['トヨタ チームメイト', 'アドバンスト パーク', 'アドバンストパーク'],
    observedIn: ['prius_spec_202607'],
    others: {},
  },
  navigation: {
    label: 'カーナビ',
    toyota: ['ディスプレイオーディオ'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  etc: {
    label: 'ETC',
    // X系グレードは ETC2.0 ではなく素の ETC車載器 が標準になる
    toyota: ['ETC2.0ユニット', 'ETC車載器'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  backCamera: {
    label: 'バックカメラ',
    toyota: ['バックガイドモニター'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  powerSeat: {
    label: 'パワーシート',
    // 諸元表は座面調整の方式で書く。「8ウェイパワー」が電動、「6ウェイマニュアル」が手動
    toyota: ['ウェイパワー', 'パワーシート'],
    observedIn: ['prius_spec_202607'],
    others: {},
  },
  seatHeater: {
    label: 'シートヒーター',
    toyota: ['シートヒーター'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  steeringHeater: {
    label: 'ステアリングヒーター',
    toyota: ['ステアリングヒーター'],
    observedIn: ['prius_spec_202607'],
    others: {},
  },
  autoAircon: {
    label: 'オートエアコン',
    toyota: ['オートエアコン'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  ledHeadlight: {
    label: 'LEDヘッドライト',
    toyota: ['Bi-Beam LEDヘッドランプ', '3灯式フルLEDヘッドランプ', 'LEDヘッドランプ'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  smartKey: {
    label: 'スマートキー',
    toyota: ['スマートエントリー'],
    observedIn: ['prius_spec_202607', 'yaris_spec_202604'],
    others: {},
  },
  powerBackDoor: {
    label: 'パワーバックドア',
    toyota: ['パワーバックドア'],
    observedIn: ['prius_spec_202607'],
    others: {},
  },
  handsFreeBackDoor: {
    label: 'ハンズフリーバックドア',
    /*
     * この2車種の諸元表には記載が無い（どちらも全グレード none）。
     * トヨタの他車種にある表記だが、実物で確かめていないので observedIn は空にしてある。
     * 他社を合わせる前に、まずトヨタの実物で確認すること。
     */
    toyota: ['ハンズフリーパワーバックドア'],
    observedIn: [],
    others: {},
  },
  sunroof: {
    label: 'サンルーフ',
    // プリウスは「パノラマルーフ」。ムーンルーフ/サンルーフは他車種の表記で未確認
    toyota: ['パノラマルーフ'],
    observedIn: ['prius_spec_202607'],
    others: {},
  },
};

/**
 * 表記を突き合わせるための正規化。
 *
 * 同一PDF内で全角と半角が混在する（docs/research/2026-08-24-manufacturer-pdf-survey.md
 * の発見4）。NFKC で幅を揃え、記号と空白を落として比べる。
 */
export function normalizeTerm(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・/／,，.。]/g, '')
    .replace(/[()（）[\]［］{}｛｝〈〉《》【】「」＋+＊*※❶❷❸●○◆■□]/g, '');
}

export interface TermMatch {
  column: FeatureColumn;
  /** 当たった表記。どれで当たったかが分かると、辞書を直すときに迷わない */
  term: string;
  manufacturer: Manufacturer;
}

/**
 * 行ラベルに当たる装備列を探す。
 *
 * **当たったものを全部返す。** 1つに決めない。
 * 「パワーバックドア」は「ハンズフリーパワーバックドア」の一部でもあり、
 * 機械的に1つ選ぶと取り違える。長い表記から順に並べて返し、選ぶのは人に任せる。
 *
 * 何も当たらなければ空を返す。これは「その表記を知らない」という意味であり、
 * 黙って捨てずに警告する材料になる（新しいメーカーの初回は必ずこうなる）。
 */
export function matchFeature(label: string): TermMatch[] {
  const target = normalizeTerm(label);
  if (!target) return [];

  const matches: TermMatch[] = [];
  for (const column of FEATURE_COLUMNS) {
    const entry = FEATURE_VOCABULARY[column];
    for (const term of entry.toyota) {
      if (target.includes(normalizeTerm(term))) {
        matches.push({ column, term, manufacturer: 'トヨタ' });
      }
    }
    for (const [maker, terms] of Object.entries(entry.others)) {
      for (const term of terms ?? []) {
        if (target.includes(normalizeTerm(term))) {
          matches.push({ column, term, manufacturer: maker as Manufacturer });
        }
      }
    }
  }

  return matches.sort((a, b) => normalizeTerm(b.term).length - normalizeTerm(a.term).length);
}
