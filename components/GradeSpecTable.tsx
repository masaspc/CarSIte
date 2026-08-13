import Image from 'next/image';
import type { ModelDetail } from '@/db/queries';
import { type FeatureColumn } from '@/db/schema';

/** unknown を × と同じ表示にしない。フィクスチャは大半が unknown であり、
 *  × にすると「装備が無い」という誤情報になる。 */
const FEATURE_LABEL: Record<string, string> = {
  standard: '○',
  option: 'OP',
  none: '×',
  unknown: '−',
};

const SAFETY_FEATURES: FeatureColumn[] = [
  'collisionMitigationBrake',
  'falseStartSuppression',
  'laneDepartureWarning',
  'laneKeepingAssist',
  'adaptiveCruiseControl',
  'blindSpotMonitor',
  'camera360',
  'parkingAssist',
];

const COMFORT_FEATURES: FeatureColumn[] = [
  'navigation',
  'etc',
  'backCamera',
  'powerSeat',
  'seatHeater',
  'steeringHeater',
  'autoAircon',
  'ledHeadlight',
  'smartKey',
  'powerBackDoor',
  'handsFreeBackDoor',
  'sunroof',
];

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

interface Dimensions {
  length?: number;
  width?: number;
  height?: number;
}
interface Performance {
  maxPower?: string;
  maxTorque?: string;
}
interface FuelDetail {
  cityMode?: number;
  suburbanMode?: number;
  highwayMode?: number;
}
interface GradeImages {
  exterior?: string[];
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

function formatFuel(value: string | null): string | undefined {
  return value === null ? undefined : `${value} km/L`;
}

type Grade = ModelDetail['grades'][number];

export default function GradeSpecTable({ grades }: { grades: Grade[] }) {
  const renderRow = (label: string, values: (string | number | null | undefined)[]) => (
    <tr className="border-b" key={label}>
      <td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{label}</td>
      {values.map((value, idx) => (
        <td key={idx} className="py-3 px-4 text-center">
          {value === null || value === undefined || value === '' ? '−' : value}
        </td>
      ))}
    </tr>
  );

  const renderFeatureRow = (column: FeatureColumn) => (
    <tr className="border-b" key={column}>
      <td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{FEATURE_NAME[column]}</td>
      {grades.map((grade) => (
        <td key={grade.id} className="py-3 px-4 text-center">
          {FEATURE_LABEL[grade[column]] ?? '−'}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-primary-600 text-white">
            <th className="py-4 px-4 text-left sticky left-0 bg-primary-600">項目</th>
            {grades.map((grade) => {
              const images = grade.images as GradeImages | null;
              const cover = images?.exterior?.[0];
              return (
                <th key={grade.id} className="py-4 px-4 min-w-[200px]">
                  <div className="space-y-2">
                    <div className="aspect-video bg-gray-200 rounded overflow-hidden relative">
                      {cover ? (
                        <Image
                          src={cover}
                          alt={grade.name}
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          画像なし
                        </div>
                      )}
                    </div>
                    <p className="font-bold">{grade.name}</p>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              基本情報
            </td>
          </tr>
          {renderRow('価格', grades.map((g) => formatPrice(g.price)))}
          {renderRow('発売年月', grades.map((g) => g.releaseDate))}
          {renderRow('乗車定員', grades.map((g) => `${g.seating}人`))}

          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              サイズ
            </td>
          </tr>
          {renderRow(
            '全長 (mm)',
            grades.map((g) => (g.dimensions as Dimensions | null)?.length),
          )}
          {renderRow(
            '全幅 (mm)',
            grades.map((g) => (g.dimensions as Dimensions | null)?.width),
          )}
          {renderRow(
            '全高 (mm)',
            grades.map((g) => (g.dimensions as Dimensions | null)?.height),
          )}
          {renderRow('車両重量 (kg)', grades.map((g) => g.weight))}

          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              エンジン・性能
            </td>
          </tr>
          {renderRow('エンジンタイプ', grades.map((g) => g.engineType))}
          {renderRow('総排気量 (cc)', grades.map((g) => g.displacement))}
          {renderRow(
            '最高出力',
            grades.map((g) => (g.performance as Performance | null)?.maxPower),
          )}
          {renderRow(
            '最大トルク',
            grades.map((g) => (g.performance as Performance | null)?.maxTorque),
          )}
          {renderRow('トランスミッション', grades.map((g) => g.transmission))}
          {renderRow('駆動方式', grades.map((g) => g.driveSystem))}

          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              燃費性能
            </td>
          </tr>
          {renderRow('WLTCモード (km/L)', grades.map((g) => formatFuel(g.wltcMode)))}
          {renderRow(
            '市街地モード (km/L)',
            grades.map((g) => (g.fuelDetail as FuelDetail | null)?.cityMode),
          )}
          {renderRow(
            '高速道路モード (km/L)',
            grades.map((g) => (g.fuelDetail as FuelDetail | null)?.highwayMode),
          )}
          {renderRow('航続可能距離 (km)', grades.map((g) => g.cruisingRange))}
          {renderRow('エコカー減税', grades.map((g) => (g.ecoCarTax ? '対象' : '対象外')))}
          {renderRow('エアバッグ', grades.map((g) => (g.airbags ? `${g.airbags}個` : undefined)))}

          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              安全装備
            </td>
          </tr>
          {SAFETY_FEATURES.map(renderFeatureRow)}

          <tr className="bg-gray-100">
            <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">
              快適装備
            </td>
          </tr>
          {COMFORT_FEATURES.map(renderFeatureRow)}
        </tbody>
      </table>
    </div>
  );
}
