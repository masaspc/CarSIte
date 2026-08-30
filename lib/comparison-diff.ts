import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import type { ComparisonRow } from '@/db/queries';
import { sameValue } from '@/lib/same-value';

/**
 * 行の状態。**二値ではなく三値である。**
 *
 * 装備は取り込みが先送りされており（収集パイプライン設計書6.0）、片方だけ
 * 既知という状態が起きる。`standard` と `unknown` を「相違」に含めると
 * 「装備が違う」という誤情報になる。不明を含む行は別扱いにする。
 */
export type RowState = 'same' | 'different' | 'unknown';

export interface ComparisonCell {
  /** 判定に使う生値。整形前 */
  raw: unknown;
  /** セルに表示する文字列 */
  text: string;
}

export interface ComparisonRowDef {
  label: string;
  cells: ComparisonCell[];
  state: RowState;
}

export interface ComparisonSection {
  label: string;
  rows: ComparisonRowDef[];
}

const EMPTY = '−';

const FEATURE_LABEL: Record<string, string> = {
  standard: '○',
  option: 'OP',
  none: '×',
  unknown: EMPTY,
};

const FEATURE_NAME: Record<FeatureColumn, string> = {
  collisionMitigationBrake: '衝突被害軽減ブレーキ',
  falseStartSuppression: '誤発進抑制機能',
  laneDepartureWarning: '車線逸脱警報',
  laneKeepingAssist: '車線維持支援',
  adaptiveCruiseControl: 'ACC',
  blindSpotMonitor: 'ブラインドスポットモニター',
  camera360: '360度カメラ',
  parkingAssist: '駐車支援システム',
  navigation: 'カーナビ',
  etc: 'ETC',
  backCamera: 'バックカメラ',
  powerSeat: 'パワーシート',
  seatHeater: 'シートヒーター',
  steeringHeater: 'ステアリングヒーター',
  autoAircon: 'オートエアコン',
  ledHeadlight: 'LEDヘッドライト',
  smartKey: 'スマートキー',
  powerBackDoor: 'パワーバックドア',
  handsFreeBackDoor: 'ハンズフリーバックドア',
  sunroof: 'サンルーフ',
};

const SAFETY_FEATURES: FeatureColumn[] = [
  'collisionMitigationBrake', 'falseStartSuppression', 'laneDepartureWarning',
  'laneKeepingAssist', 'adaptiveCruiseControl', 'blindSpotMonitor',
  'camera360', 'parkingAssist',
];

const COMFORT_FEATURES: FeatureColumn[] = [
  'navigation', 'etc', 'backCamera', 'powerSeat', 'seatHeater', 'steeringHeater',
  'autoAircon', 'ledHeadlight', 'smartKey', 'powerBackDoor', 'handsFreeBackDoor', 'sunroof',
];

interface Dimensions { length?: number; width?: number; height?: number }
interface Performance { maxPower?: string; maxTorque?: string }
interface FuelDetail { cityMode?: number; highwayMode?: number }

/** 値が「不明」を表すか。装備の unknown と、値そのものが無い場合 */
function isUnknown(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 'unknown';
}

/**
 * 行の状態を決める。
 *
 * 不明を含む行は `different` にしない。「値が違う」と「片方が分からない」は
 * 別のことであり、後者を相違として見せると誤情報になる（設計書4.2）。
 */
function judge(values: unknown[]): RowState {
  if (values.length <= 1) return 'same';
  if (values.some(isUnknown)) {
    // 全部不明なら「同じく不明」として畳んでよい
    return values.every(isUnknown) ? 'same' : 'unknown';
  }
  const [first, ...rest] = values;
  return rest.every((v) => sameValue(first, v)) ? 'same' : 'different';
}

function makeRow(label: string, raws: unknown[], format: (v: unknown) => string): ComparisonRowDef {
  return {
    label,
    cells: raws.map((raw) => ({ raw, text: format(raw) })),
    state: judge(raws),
  };
}

const plain = (v: unknown): string => (isUnknown(v) ? EMPTY : String(v));
const yen = (v: unknown): string => (isUnknown(v) ? EMPTY : `¥${Number(v).toLocaleString()}`);
const suffix = (unit: string) => (v: unknown): string => (isUnknown(v) ? EMPTY : `${v}${unit}`);
const feature = (v: unknown): string => FEATURE_LABEL[String(v)] ?? EMPTY;
const ecoTax = (v: unknown): string => (v ? '対象' : '対象外');

export function buildComparison(grades: ComparisonRow[]): ComparisonSection[] {
  if (grades.length === 0) return [];

  const g = <T,>(pick: (row: ComparisonRow) => T): T[] => grades.map(pick);
  const dim = (key: keyof Dimensions) =>
    g((r) => (r.grade.dimensions as Dimensions | null)?.[key]);
  const perf = (key: keyof Performance) =>
    g((r) => (r.grade.performance as Performance | null)?.[key]);
  const fuel = (key: keyof FuelDetail) =>
    g((r) => (r.grade.fuelDetail as FuelDetail | null)?.[key]);

  const featureRow = (column: FeatureColumn) =>
    makeRow(FEATURE_NAME[column], g((r) => r.grade[column]), feature);

  return [
    {
      label: '基本情報',
      rows: [
        makeRow('価格', g((r) => r.grade.price), yen),
        makeRow('ボディタイプ', g((r) => r.bodyType), plain),
        makeRow('発売年月', g((r) => r.grade.releaseDate), plain),
        makeRow('乗車定員', g((r) => r.grade.seating), suffix('人')),
      ],
    },
    {
      label: 'サイズ',
      rows: [
        makeRow('全長 (mm)', dim('length'), plain),
        makeRow('全幅 (mm)', dim('width'), plain),
        makeRow('全高 (mm)', dim('height'), plain),
        makeRow('車両重量 (kg)', g((r) => r.grade.weight), plain),
      ],
    },
    {
      label: 'エンジン・性能',
      rows: [
        makeRow('エンジンタイプ', g((r) => r.grade.engineType), plain),
        makeRow('総排気量 (cc)', g((r) => r.grade.displacement), plain),
        makeRow('最高出力', perf('maxPower'), plain),
        makeRow('最大トルク', perf('maxTorque'), plain),
        makeRow('トランスミッション', g((r) => r.grade.transmission), plain),
        makeRow('駆動方式', g((r) => r.grade.driveSystem), plain),
      ],
    },
    {
      label: '燃費性能',
      rows: [
        makeRow('WLTCモード (km/L)', g((r) => r.grade.wltcMode), suffix(' km/L')),
        makeRow('市街地モード (km/L)', fuel('cityMode'), plain),
        makeRow('高速道路モード (km/L)', fuel('highwayMode'), plain),
        makeRow('航続可能距離 (km)', g((r) => r.grade.cruisingRange), plain),
        makeRow('エコカー減税', g((r) => r.grade.ecoCarTax), ecoTax),
        makeRow('エアバッグ', g((r) => r.grade.airbags), suffix('個')),
      ],
    },
    { label: '安全装備', rows: SAFETY_FEATURES.map(featureRow) },
    { label: '快適装備', rows: COMFORT_FEATURES.map(featureRow) },
  ];
}

export function countDifferent(sections: ComparisonSection[]) {
  const rows = sections.flatMap((s) => s.rows);
  return {
    different: rows.filter((r) => r.state === 'different').length,
    unknown: rows.filter((r) => r.state === 'unknown').length,
    total: rows.length,
  };
}

/**
 * 表示する行を絞る。
 *
 * 1台のときは絞らない。全行が same になるため、絞ると表が空になり
 * 故障のように見える（設計書5章）。
 */
export function visibleSections(
  sections: ComparisonSection[],
  showAll: boolean,
): ComparisonSection[] {
  if (showAll) return sections;

  const single = sections.every((s) => s.rows.every((r) => r.cells.length <= 1));
  if (single) return sections;

  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => r.state === 'different') }))
    .filter((s) => s.rows.length > 0);
}
