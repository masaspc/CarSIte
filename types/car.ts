export type BodyType =
  | '軽自動車'
  | 'コンパクトカー'
  | 'セダン'
  | 'ハッチバック'
  | 'ステーションワゴン'
  | 'SUV'
  | 'ミニバン'
  | 'スポーツカー'
  | 'クーペ';

export type EngineType =
  | 'ガソリン'
  | 'ハイブリッド'
  | 'EV'
  | 'ディーゼル'
  | 'PHEV';

export type DriveSystem =
  | 'FF'
  | 'FR'
  | '4WD'
  | 'MR'
  | 'RR';

export type Transmission =
  | 'CVT'
  | 'AT'
  | 'MT'
  | '電気式無段変速機'
  | 'DCT';

export interface Dimensions {
  length: number;        // 全長 (mm)
  width: number;         // 全幅 (mm)
  height: number;        // 全高 (mm)
  wheelbase: number;     // ホイールベース (mm)
  weight: number;        // 車両重量 (kg)
  minTurningRadius: number; // 最小回転半径 (m)
  groundClearance: number;  // 最低地上高 (mm)
}

export interface Capacity {
  seating: number;       // 乗車定員
}

export interface Engine {
  type: EngineType;
  displacement?: number;  // 総排気量 (cc)
  maxPower: string;      // 最高出力
  maxTorque: string;     // 最大トルク
  transmission: Transmission;
  driveSystem: DriveSystem;
}

export interface FuelEfficiency {
  wltcMode?: number;     // WLTCモード燃費 (km/L)
  cityMode?: number;     // 市街地モード燃費 (km/L)
  suburbanMode?: number; // 郊外モード燃費 (km/L)
  highwayMode?: number;  // 高速道路モード燃費 (km/L)
  cruisingRange?: number; // 航続可能距離 (km) ※EVの場合
  ecoCarTax: boolean;    // エコカー減税対象
}

export interface Safety {
  collisionMitigationBrake: boolean;  // 衝突被害軽減ブレーキ
  falseStartSuppression: boolean;     // 誤発進抑制機能
  laneDepartureWarning: boolean;      // 車線逸脱警報
  laneKeepingAssist: boolean;         // 車線維持支援システム
  adaptiveCruiseControl: boolean;     // アダプティブクルーズコントロール
  blindSpotMonitor: boolean;          // ブラインドスポットモニター
  camera360: boolean;                 // 360度カメラ
  parkingAssist: boolean;             // 駐車支援システム
  airbags: number;                    // エアバッグ個数
}

export interface Comfort {
  navigation: boolean;         // カーナビゲーション
  etc: boolean;                // ETC
  backCamera: boolean;         // バックカメラ
  powerSeat: boolean;          // パワーシート
  seatHeater: boolean;         // シートヒーター
  steeringHeater: boolean;     // ステアリングヒーター
  autoAircon: boolean;         // オートエアコン
  ledHeadlight: boolean;       // LEDヘッドライト
  smartKey: boolean;           // スマートキー
  powerBackDoor: boolean;      // パワーバックドア
  handsFreeBackDoor: boolean;  // ハンズフリーバックドア
  sunroof: boolean;            // サンルーフ / ムーンルーフ
}

export interface Images {
  exterior: string[];
  interior: string[];
}

export interface PriceHistoryPoint {
  date: string;    // YYYY-MM format
  price: number;   // 価格（円）
}

export interface Car {
  id: string;
  manufacturer: string;
  model: string;
  grade: string;
  bodyType: BodyType;
  price: number;              // 新車価格（税込）
  releaseDate: string;        // 発売年月 (YYYY-MM)
  dimensions: Dimensions;
  capacity: Capacity;
  engine: Engine;
  fuelEfficiency: FuelEfficiency;
  safety: Safety;
  comfort: Comfort;
  images: Images;
  officialUrl: string;
  description: string;
  priceHistory?: PriceHistoryPoint[]; // 価格推移（オプション）
}

export interface FilterParams {
  manufacturers?: string[];
  bodyTypes?: BodyType[];
  priceMin?: number;
  priceMax?: number;
  fuelEfficiencyMin?: number;
  seatingMin?: number;
  driveSystem?: DriveSystem;
  engineTypes?: EngineType[];
  keyword?: string;
}

export type SortOption =
  | 'price-asc'
  | 'price-desc'
  | 'fuel-desc'
  | 'date-desc'
  | 'date-asc'
  | 'name-asc';
