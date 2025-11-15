'use client';

import { use } from 'react';
import Link from 'next/link';
import { getCarById, getSimilarCars, formatPrice, formatFuelEfficiency } from '@/lib/carData';
import CarCard from '@/components/CarCard';
import { Car } from '@/types/car';

export default function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const car = getCarById(id);

  if (!car) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">車両が見つかりません</h1>
          <Link
            href="/search"
            className="text-primary-600 hover:text-primary-700 underline"
          >
            検索ページに戻る
          </Link>
        </div>
      </div>
    );
  }

  const similarCars = getSimilarCars(id);

  const handleAddToCompare = (carToAdd: Car) => {
    const compareListJson = sessionStorage.getItem('compareList');
    const compareList: Car[] = compareListJson ? JSON.parse(compareListJson) : [];

    if (compareList.some((c) => c.id === carToAdd.id)) {
      alert('この車両は既に比較リストに追加されています');
      return;
    }

    if (compareList.length >= 3) {
      alert('比較リストは最大3台までです');
      return;
    }

    compareList.push(carToAdd);
    sessionStorage.setItem('compareList', JSON.stringify(compareList));
    alert(`${carToAdd.manufacturer} ${carToAdd.model} を比較リストに追加しました`);
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* パンくずリスト */}
        <nav className="mb-6 text-sm">
          <Link href="/" className="text-primary-600 hover:text-primary-700">
            ホーム
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <Link href="/search" className="text-primary-600 hover:text-primary-700">
            車を探す
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-600">
            {car.manufacturer} {car.model}
          </span>
        </nav>

        {/* メイン情報 */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            {/* 画像 */}
            <div>
              <div className="aspect-video bg-gray-200 rounded-lg overflow-hidden mb-4">
                <img
                  src={car.images.exterior[0]}
                  alt={`${car.manufacturer} ${car.model}`}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* 基本情報 */}
            <div>
              <div className="mb-4">
                <p className="text-primary-600 font-semibold">
                  {car.manufacturer}
                </p>
                <h1 className="text-4xl font-bold mb-2">{car.model}</h1>
                <p className="text-gray-600">{car.grade}</p>
              </div>

              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-1">新車価格（税込）</p>
                <p className="text-3xl font-bold text-primary-600">
                  {formatPrice(car.price)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-600 mb-1">ボディタイプ</p>
                  <p className="font-semibold">{car.bodyType}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">燃費（WLTC）</p>
                  <p className="font-semibold">
                    {formatFuelEfficiency(car.fuelEfficiency.wltcMode)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">乗車定員</p>
                  <p className="font-semibold">{car.capacity.seating}人</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">発売年月</p>
                  <p className="font-semibold">{car.releaseDate}</p>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => handleAddToCompare(car)}
                  className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors font-semibold"
                >
                  比較リストに追加
                </button>
                <a
                  href={car.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors font-semibold text-center"
                >
                  公式サイト
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* 特徴・説明 */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold mb-4">特徴</h2>
          <p className="text-gray-700 leading-relaxed">{car.description}</p>
        </div>

        {/* スペック詳細 */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold mb-6">スペック詳細</h2>

          {/* サイズ */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">サイズ</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">全長</p>
                <p className="font-semibold">{car.dimensions.length} mm</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">全幅</p>
                <p className="font-semibold">{car.dimensions.width} mm</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">全高</p>
                <p className="font-semibold">{car.dimensions.height} mm</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">ホイールベース</p>
                <p className="font-semibold">{car.dimensions.wheelbase} mm</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">車両重量</p>
                <p className="font-semibold">{car.dimensions.weight} kg</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">最小回転半径</p>
                <p className="font-semibold">{car.dimensions.minTurningRadius} m</p>
              </div>
            </div>
          </div>

          {/* エンジン */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">エンジン・動力性能</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">エンジンタイプ</p>
                <p className="font-semibold">{car.engine.type}</p>
              </div>
              {car.engine.displacement && (
                <div>
                  <p className="text-sm text-gray-600">総排気量</p>
                  <p className="font-semibold">{car.engine.displacement} cc</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-600">最高出力</p>
                <p className="font-semibold">{car.engine.maxPower}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">最大トルク</p>
                <p className="font-semibold">{car.engine.maxTorque}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">トランスミッション</p>
                <p className="font-semibold">{car.engine.transmission}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">駆動方式</p>
                <p className="font-semibold">{car.engine.driveSystem}</p>
              </div>
            </div>
          </div>

          {/* 燃費 */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">燃費性能</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {car.fuelEfficiency.wltcMode && (
                <div>
                  <p className="text-sm text-gray-600">WLTCモード</p>
                  <p className="font-semibold">{car.fuelEfficiency.wltcMode} km/L</p>
                </div>
              )}
              {car.fuelEfficiency.cityMode && (
                <div>
                  <p className="text-sm text-gray-600">市街地モード</p>
                  <p className="font-semibold">{car.fuelEfficiency.cityMode} km/L</p>
                </div>
              )}
              {car.fuelEfficiency.suburbanMode && (
                <div>
                  <p className="text-sm text-gray-600">郊外モード</p>
                  <p className="font-semibold">{car.fuelEfficiency.suburbanMode} km/L</p>
                </div>
              )}
              {car.fuelEfficiency.highwayMode && (
                <div>
                  <p className="text-sm text-gray-600">高速道路モード</p>
                  <p className="font-semibold">{car.fuelEfficiency.highwayMode} km/L</p>
                </div>
              )}
              {car.fuelEfficiency.cruisingRange && (
                <div>
                  <p className="text-sm text-gray-600">航続可能距離</p>
                  <p className="font-semibold">{car.fuelEfficiency.cruisingRange} km</p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-600">エコカー減税</p>
                <p className="font-semibold">
                  {car.fuelEfficiency.ecoCarTax ? '対象' : '対象外'}
                </p>
              </div>
            </div>
          </div>

          {/* 安全装備 */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">安全装備</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="flex items-center">
                <span className={car.safety.collisionMitigationBrake ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.collisionMitigationBrake ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">衝突被害軽減ブレーキ</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.falseStartSuppression ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.falseStartSuppression ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">誤発進抑制機能</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.laneDepartureWarning ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.laneDepartureWarning ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">車線逸脱警報</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.laneKeepingAssist ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.laneKeepingAssist ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">車線維持支援</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.adaptiveCruiseControl ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.adaptiveCruiseControl ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">ACC</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.blindSpotMonitor ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.blindSpotMonitor ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">ブラインドスポットモニター</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.camera360 ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.camera360 ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">360度カメラ</span>
              </div>
              <div className="flex items-center">
                <span className={car.safety.parkingAssist ? 'text-green-600' : 'text-gray-400'}>
                  {car.safety.parkingAssist ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">駐車支援システム</span>
              </div>
              <div>
                <p className="text-sm text-gray-600">エアバッグ</p>
                <p className="font-semibold">{car.safety.airbags}個</p>
              </div>
            </div>
          </div>

          {/* 快適装備 */}
          <div>
            <h3 className="text-xl font-semibold mb-4 pb-2 border-b">快適装備</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="flex items-center">
                <span className={car.comfort.navigation ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.navigation ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">カーナビ</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.etc ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.etc ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">ETC</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.backCamera ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.backCamera ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">バックカメラ</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.powerSeat ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.powerSeat ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">パワーシート</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.seatHeater ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.seatHeater ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">シートヒーター</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.steeringHeater ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.steeringHeater ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">ステアリングヒーター</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.autoAircon ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.autoAircon ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">オートエアコン</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.ledHeadlight ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.ledHeadlight ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">LEDヘッドライト</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.smartKey ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.smartKey ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">スマートキー</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.powerBackDoor ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.powerBackDoor ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">パワーバックドア</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.handsFreeBackDoor ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.handsFreeBackDoor ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">ハンズフリーバックドア</span>
              </div>
              <div className="flex items-center">
                <span className={car.comfort.sunroof ? 'text-green-600' : 'text-gray-400'}>
                  {car.comfort.sunroof ? '✓' : '✗'}
                </span>
                <span className="ml-2 text-sm">サンルーフ</span>
              </div>
            </div>
          </div>
        </div>

        {/* 類似車種 */}
        {similarCars.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-6">類似の車種</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {similarCars.map((similarCar) => (
                <CarCard
                  key={similarCar.id}
                  car={similarCar}
                  onAddToCompare={handleAddToCompare}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
