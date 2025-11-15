'use client';

import { Car } from '@/types/car';
import { formatPrice, formatFuelEfficiency } from '@/lib/carData';
import Link from 'next/link';

interface ComparisonTableProps {
  cars: Car[];
  onRemove: (carId: string) => void;
}

export default function ComparisonTable({ cars, onRemove }: ComparisonTableProps) {
  if (cars.length === 0) {
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

  const renderRow = (label: string, values: (string | number | undefined)[]) => (
    <tr className="border-b">
      <td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{label}</td>
      {values.map((value, idx) => (
        <td key={idx} className="py-3 px-4 text-center">
          {value !== undefined ? value : '-'}
        </td>
      ))}
    </tr>
  );

  const renderBoolRow = (label: string, values: boolean[]) => (
    <tr className="border-b">
      <td className="py-3 px-4 font-semibold bg-gray-50 sticky left-0">{label}</td>
      {values.map((value, idx) => (
        <td key={idx} className="py-3 px-4 text-center">
          {value ? '○' : '×'}
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
            {cars.map((car) => (
              <th key={car.id} className="py-4 px-4 min-w-[200px]">
                <div className="space-y-2">
                  <div className="aspect-video bg-gray-200 rounded overflow-hidden">
                    <img
                      src={car.images.exterior[0]}
                      alt={`${car.manufacturer} ${car.model}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-sm">{car.manufacturer}</p>
                    <p className="font-bold">{car.model}</p>
                    <p className="text-xs">{car.grade}</p>
                  </div>
                  <button
                    onClick={() => onRemove(car.id)}
                    className="text-xs bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded"
                  >
                    削除
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 基本情報 */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              基本情報
            </td>
          </tr>
          {renderRow('価格', cars.map((c) => formatPrice(c.price)))}
          {renderRow('ボディタイプ', cars.map((c) => c.bodyType))}
          {renderRow('発売年月', cars.map((c) => c.releaseDate))}

          {/* サイズ */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              サイズ
            </td>
          </tr>
          {renderRow('全長 (mm)', cars.map((c) => c.dimensions.length))}
          {renderRow('全幅 (mm)', cars.map((c) => c.dimensions.width))}
          {renderRow('全高 (mm)', cars.map((c) => c.dimensions.height))}
          {renderRow('車両重量 (kg)', cars.map((c) => c.dimensions.weight))}
          {renderRow('乗車定員', cars.map((c) => `${c.capacity.seating}人`))}

          {/* エンジン */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              エンジン・性能
            </td>
          </tr>
          {renderRow('エンジンタイプ', cars.map((c) => c.engine.type))}
          {renderRow('排気量 (cc)', cars.map((c) => c.engine.displacement))}
          {renderRow('最高出力', cars.map((c) => c.engine.maxPower))}
          {renderRow('最大トルク', cars.map((c) => c.engine.maxTorque))}
          {renderRow('トランスミッション', cars.map((c) => c.engine.transmission))}
          {renderRow('駆動方式', cars.map((c) => c.engine.driveSystem))}

          {/* 燃費 */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              燃費性能
            </td>
          </tr>
          {renderRow(
            'WLTCモード (km/L)',
            cars.map((c) => formatFuelEfficiency(c.fuelEfficiency.wltcMode))
          )}
          {renderRow(
            '市街地モード (km/L)',
            cars.map((c) => formatFuelEfficiency(c.fuelEfficiency.cityMode))
          )}
          {renderRow(
            '高速道路モード (km/L)',
            cars.map((c) => formatFuelEfficiency(c.fuelEfficiency.highwayMode))
          )}
          {renderBoolRow('エコカー減税', cars.map((c) => c.fuelEfficiency.ecoCarTax))}

          {/* 安全装備 */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              安全装備
            </td>
          </tr>
          {renderBoolRow(
            '衝突被害軽減ブレーキ',
            cars.map((c) => c.safety.collisionMitigationBrake)
          )}
          {renderBoolRow(
            'アダプティブクルーズコントロール',
            cars.map((c) => c.safety.adaptiveCruiseControl)
          )}
          {renderBoolRow('車線維持支援', cars.map((c) => c.safety.laneKeepingAssist))}
          {renderBoolRow(
            'ブラインドスポットモニター',
            cars.map((c) => c.safety.blindSpotMonitor)
          )}
          {renderBoolRow('360度カメラ', cars.map((c) => c.safety.camera360))}
          {renderRow('エアバッグ数', cars.map((c) => `${c.safety.airbags}個`))}

          {/* 快適装備 */}
          <tr className="bg-gray-100">
            <td colSpan={cars.length + 1} className="py-2 px-4 font-bold">
              快適装備
            </td>
          </tr>
          {renderBoolRow('カーナビ', cars.map((c) => c.comfort.navigation))}
          {renderBoolRow('バックカメラ', cars.map((c) => c.comfort.backCamera))}
          {renderBoolRow('パワーシート', cars.map((c) => c.comfort.powerSeat))}
          {renderBoolRow('シートヒーター', cars.map((c) => c.comfort.seatHeater))}
          {renderBoolRow('LEDヘッドライト', cars.map((c) => c.comfort.ledHeadlight))}
          {renderBoolRow('スマートキー', cars.map((c) => c.comfort.smartKey))}
          {renderBoolRow('パワーバックドア', cars.map((c) => c.comfort.powerBackDoor))}
        </tbody>
      </table>
    </div>
  );
}
