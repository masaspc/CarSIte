'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, BodyType, EngineType, DriveSystem } from '@/types/car';

interface CarFormProps {
  initialData?: Car;
  mode: 'add' | 'edit';
}

export default function CarForm({ initialData, mode }: CarFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<Car>(
    initialData || {
      id: '',
      manufacturer: '',
      model: '',
      grade: '',
      bodyType: 'セダン' as BodyType,
      price: 0,
      releaseDate: '',
      dimensions: {
        length: 0,
        width: 0,
        height: 0,
        wheelbase: 0,
        weight: 0,
        minTurningRadius: 0,
        groundClearance: 0,
      },
      capacity: { seating: 5 },
      engine: {
        type: 'ガソリン' as EngineType,
        displacement: undefined,
        maxPower: '',
        maxTorque: '',
        transmission: 'CVT',
        driveSystem: 'FF' as DriveSystem,
      },
      fuelEfficiency: {
        wltcMode: undefined,
        cityMode: undefined,
        suburbanMode: undefined,
        highwayMode: undefined,
        cruisingRange: undefined,
        ecoCarTax: false,
      },
      safety: {
        collisionMitigationBrake: false,
        falseStartSuppression: false,
        laneDepartureWarning: false,
        laneKeepingAssist: false,
        adaptiveCruiseControl: false,
        blindSpotMonitor: false,
        camera360: false,
        parkingAssist: false,
        airbags: 6,
      },
      comfort: {
        navigation: false,
        etc: false,
        backCamera: false,
        powerSeat: false,
        seatHeater: false,
        steeringHeater: false,
        autoAircon: false,
        ledHeadlight: false,
        smartKey: false,
        powerBackDoor: false,
        handsFreeBackDoor: false,
        sunroof: false,
      },
      images: {
        exterior: ['/images/placeholder-car.jpg'],
        interior: ['/images/placeholder-interior.jpg'],
      },
      officialUrl: '',
      description: '',
    }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = mode === 'add' ? '/api/cars' : `/api/cars/${formData.id}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        alert(mode === 'add' ? '車両を追加しました' : '車両を更新しました');
        router.push('/admin');
      } else {
        const error = await response.json();
        alert(`エラー: ${error.error}`);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('エラーが発生しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 bg-white shadow-md rounded-lg p-6">
      {/* 基本情報 */}
      <div>
        <h2 className="text-xl font-bold mb-4">基本情報</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">ID *</label>
            <input
              type="text"
              required
              disabled={mode === 'edit'}
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
              placeholder="toyota-prius-2023-e"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">メーカー *</label>
            <input
              type="text"
              required
              value={formData.manufacturer}
              onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">車種名 *</label>
            <input
              type="text"
              required
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">グレード *</label>
            <input
              type="text"
              required
              value={formData.grade}
              onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ボディタイプ *</label>
            <select
              required
              value={formData.bodyType}
              onChange={(e) =>
                setFormData({ ...formData, bodyType: e.target.value as BodyType })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            >
              <option value="セダン">セダン</option>
              <option value="SUV">SUV</option>
              <option value="ミニバン">ミニバン</option>
              <option value="ハッチバック">ハッチバック</option>
              <option value="スポーツカー">スポーツカー</option>
              <option value="軽自動車">軽自動車</option>
              <option value="ステーションワゴン">ステーションワゴン</option>
              <option value="コンパクトカー">コンパクトカー</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">価格（円） *</label>
            <input
              type="number"
              required
              value={formData.price}
              onChange={(e) =>
                setFormData({ ...formData, price: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">発売日 *</label>
            <input
              type="text"
              required
              value={formData.releaseDate}
              onChange={(e) => setFormData({ ...formData, releaseDate: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
              placeholder="2023-01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">公式URL</label>
            <input
              type="url"
              value={formData.officialUrl}
              onChange={(e) => setFormData({ ...formData, officialUrl: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">説明</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            rows={3}
          />
        </div>
      </div>

      {/* サイズ */}
      <div>
        <h2 className="text-xl font-bold mb-4">サイズ</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">全長（mm）</label>
            <input
              type="number"
              value={formData.dimensions.length}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  dimensions: { ...formData.dimensions, length: parseInt(e.target.value) },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">全幅（mm）</label>
            <input
              type="number"
              value={formData.dimensions.width}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  dimensions: { ...formData.dimensions, width: parseInt(e.target.value) },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">全高（mm）</label>
            <input
              type="number"
              value={formData.dimensions.height}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  dimensions: { ...formData.dimensions, height: parseInt(e.target.value) },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">車両重量（kg）</label>
            <input
              type="number"
              value={formData.dimensions.weight}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  dimensions: { ...formData.dimensions, weight: parseInt(e.target.value) },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      {/* エンジン */}
      <div>
        <h2 className="text-xl font-bold mb-4">エンジン・動力</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">エンジンタイプ *</label>
            <select
              required
              value={formData.engine.type}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  engine: { ...formData.engine, type: e.target.value as EngineType },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            >
              <option value="ガソリン">ガソリン</option>
              <option value="ハイブリッド">ハイブリッド</option>
              <option value="ディーゼル">ディーゼル</option>
              <option value="EV">EV</option>
              <option value="PHEV">PHEV</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">排気量（cc）</label>
            <input
              type="number"
              value={formData.engine.displacement || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  engine: {
                    ...formData.engine,
                    displacement: e.target.value ? parseInt(e.target.value) : undefined,
                  },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">駆動方式</label>
            <select
              value={formData.engine.driveSystem}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  engine: {
                    ...formData.engine,
                    driveSystem: e.target.value as DriveSystem,
                  },
                })
              }
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500"
            >
              <option value="FF">FF</option>
              <option value="FR">FR</option>
              <option value="4WD">4WD</option>
              <option value="MR">MR</option>
              <option value="RR">RR</option>
            </select>
          </div>
        </div>
      </div>

      {/* 送信ボタン */}
      <div className="flex gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-400"
        >
          {isSubmitting ? '保存中...' : mode === 'add' ? '追加する' : '更新する'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
