'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Car } from '@/types/car';
import { getAllCars } from '@/lib/carData';
import ComparisonTable from '@/components/ComparisonTable';

function CompareContent() {
  const searchParams = useSearchParams();
  const [compareList, setCompareList] = useState<Car[]>([]);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    // URLパラメータから車両IDを取得
    const idsFromUrl = searchParams.get('cars');

    if (idsFromUrl) {
      // URLから車両を読み込み
      const carIds = idsFromUrl.split(',');
      const allCars = getAllCars();
      const carsFromUrl = allCars.filter(car => carIds.includes(car.id));
      setCompareList(carsFromUrl);
      // セッションストレージにも保存
      sessionStorage.setItem('compareList', JSON.stringify(carsFromUrl));
    } else {
      // セッションストレージから比較リストを取得
      const loadCompareList = () => {
        const compareListJson = sessionStorage.getItem('compareList');
        if (compareListJson) {
          setCompareList(JSON.parse(compareListJson));
        }
      };

      loadCompareList();

      // ストレージイベントをリッスン（他のタブでの変更を検知）
      window.addEventListener('storage', loadCompareList);

      return () => {
        window.removeEventListener('storage', loadCompareList);
      };
    }
  }, [searchParams]);

  const handleRemove = (carId: string) => {
    const updatedList = compareList.filter((car) => car.id !== carId);
    setCompareList(updatedList);
    sessionStorage.setItem('compareList', JSON.stringify(updatedList));
  };

  const handleClear = () => {
    if (confirm('比較リストをクリアしてもよろしいですか？')) {
      setCompareList([]);
      sessionStorage.removeItem('compareList');
    }
  };

  const handleShare = () => {
    const carIds = compareList.map(car => car.id).join(',');
    const url = `${window.location.origin}/compare?cars=${carIds}`;
    setShareUrl(url);
    setShowShareDialog(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('URLをコピーしました！');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold mb-2">車両比較</h1>
              <p className="text-gray-600">
                {compareList.length > 0
                  ? `${compareList.length}台の車両を比較中`
                  : '比較する車両を選択してください'}
              </p>
            </div>

            {compareList.length > 0 && (
              <div className="flex gap-3">
                <button
                  onClick={handleShare}
                  className="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition-colors font-semibold"
                >
                  共有する
                </button>
                <button
                  onClick={handleClear}
                  className="bg-red-500 text-white py-2 px-6 rounded-lg hover:bg-red-600 transition-colors font-semibold"
                >
                  リストをクリア
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <ComparisonTable cars={compareList} onRemove={handleRemove} />
        </div>

        {compareList.length > 0 && compareList.length < 3 && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              最大3台まで比較できます。あと{3 - compareList.length}台追加できます。
            </p>
          </div>
        )}

        {/* 共有ダイアログ */}
        {showShareDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
              <h2 className="text-2xl font-bold mb-4">比較リストを共有</h2>
              <p className="text-gray-600 mb-4">
                このURLを共有することで、他の人も同じ車両の比較を見ることができます。
              </p>

              <div className="bg-gray-50 p-4 rounded border mb-4">
                <p className="text-sm text-gray-600 mb-2">共有URL:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border rounded bg-white"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={handleCopyUrl}
                    className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition whitespace-nowrap"
                  >
                    コピー
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>比較中の車両:</strong>
                </p>
                <ul className="mt-2 space-y-1">
                  {compareList.map((car) => (
                    <li key={car.id} className="text-sm text-blue-700">
                      • {car.manufacturer} {car.model} ({car.grade})
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowShareDialog(false)}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">読み込み中...</div>}>
      <CompareContent />
    </Suspense>
  );
}
