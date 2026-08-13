'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ComparisonRow } from '@/db/queries';
import type { GradeRef } from '@/lib/compare-store';
import { type FeatureColumn } from '@/db/schema';

interface Props {
  grades: ComparisonRow[];
  onRemove: (ref: GradeRef) => void;
}

interface GradeDimensions {
  length?: number;
  width?: number;
  height?: number;
}
interface GradePerformance {
  maxPower?: string;
  maxTorque?: string;
}
interface GradeFuelDetail {
  cityMode?: number;
  highwayMode?: number;
}
interface GradeImages {
  exterior?: string[];
}

/** unknown を × と同じ表示にしない。フィクスチャは大半が unknown であり、
 *  × にすると「装備が無い」という誤情報になる。GradeSpecTable と同じ表現。 */
const FEATURE_LABEL: Record<string, string> = {
  standard: '○',
  option: 'OP',
  none: '×',
  unknown: '−',
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

function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

function formatFuel(value: string | null): string | undefined {
  return value === null ? undefined : `${value} km/L`;
}

function gradeRef({ grade, manufacturerSlug, modelSlug }: ComparisonRow): GradeRef {
  return `${manufacturerSlug}/${modelSlug}/${grade.slug}`;
}

export default function ComparisonTable({ grades, onRemove }: Props) {
  if (grades.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">比較する車両が選択されていません</p>
        <Link
          href="/search"
          className="inline-block bg-primary-600 text-white py-2 px-6 rounded hover:bg-primary-700 transition-colors"
        >
          車を探す
        </Link>
      </div>
    );
  }

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
      {grades.map(({ grade }) => (
        <td key={grade.id} className="py-3 px-4 text-center">
          {FEATURE_LABEL[grade[column]] ?? '−'}
        </td>
      ))}
    </tr>
  );

  const sectionHeader = (label: string) => (
    <tr className="bg-gray-100" key={label}>
      <td colSpan={grades.length + 1} className="py-2 px-4 font-bold">{label}</td>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-primary-600 text-white">
            <th className="py-4 px-4 text-left sticky left-0 bg-primary-600">項目</th>
            {grades.map((row) => {
              const images = row.grade.images as GradeImages | null;
              const cover = images?.exterior?.[0];
              return (
                <th key={row.grade.id} className="py-4 px-4 min-w-[200px]">
                  <div className="space-y-2">
                    <div className="aspect-video bg-gray-200 rounded overflow-hidden relative">
                      {cover ? (
                        <Image
                          src={cover}
                          alt={`${row.manufacturer} ${row.modelName}`}
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
                    <div>
                      <p className="text-sm">{row.manufacturer}</p>
                      <p className="font-bold">{row.modelName}</p>
                      <p className="text-xs">{row.grade.name}</p>
                    </div>
                    <button
                      onClick={() => onRemove(gradeRef(row))}
                      className="text-xs bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded"
                    >
                      削除
                    </button>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sectionHeader('基本情報')}
          {renderRow('価格', grades.map(({ grade }) => formatPrice(grade.price)))}
          {renderRow('ボディタイプ', grades.map(({ bodyType }) => bodyType))}
          {renderRow('発売年月', grades.map(({ grade }) => grade.releaseDate))}
          {renderRow('乗車定員', grades.map(({ grade }) => `${grade.seating}人`))}

          {sectionHeader('サイズ')}
          {renderRow('全長 (mm)', grades.map(({ grade }) => (grade.dimensions as GradeDimensions | null)?.length))}
          {renderRow('全幅 (mm)', grades.map(({ grade }) => (grade.dimensions as GradeDimensions | null)?.width))}
          {renderRow('全高 (mm)', grades.map(({ grade }) => (grade.dimensions as GradeDimensions | null)?.height))}
          {renderRow('車両重量 (kg)', grades.map(({ grade }) => grade.weight))}

          {sectionHeader('エンジン・性能')}
          {renderRow('エンジンタイプ', grades.map(({ grade }) => grade.engineType))}
          {renderRow('総排気量 (cc)', grades.map(({ grade }) => grade.displacement))}
          {renderRow('最高出力', grades.map(({ grade }) => (grade.performance as GradePerformance | null)?.maxPower))}
          {renderRow('最大トルク', grades.map(({ grade }) => (grade.performance as GradePerformance | null)?.maxTorque))}
          {renderRow('トランスミッション', grades.map(({ grade }) => grade.transmission))}
          {renderRow('駆動方式', grades.map(({ grade }) => grade.driveSystem))}

          {sectionHeader('燃費性能')}
          {renderRow('WLTCモード (km/L)', grades.map(({ grade }) => formatFuel(grade.wltcMode)))}
          {renderRow('市街地モード (km/L)', grades.map(({ grade }) => (grade.fuelDetail as GradeFuelDetail | null)?.cityMode))}
          {renderRow('高速道路モード (km/L)', grades.map(({ grade }) => (grade.fuelDetail as GradeFuelDetail | null)?.highwayMode))}
          {renderRow('航続可能距離 (km)', grades.map(({ grade }) => grade.cruisingRange))}
          {renderRow('エコカー減税', grades.map(({ grade }) => (grade.ecoCarTax ? '対象' : '対象外')))}
          {renderRow('エアバッグ', grades.map(({ grade }) => (grade.airbags ? `${grade.airbags}個` : undefined)))}

          {sectionHeader('安全装備')}
          {SAFETY_FEATURES.map(renderFeatureRow)}

          {sectionHeader('快適装備')}
          {COMFORT_FEATURES.map(renderFeatureRow)}
        </tbody>
      </table>
    </div>
  );
}
