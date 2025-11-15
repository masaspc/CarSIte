'use client';

import { useState, useEffect } from 'react';
import { Car } from '@/types/car';
import ComparisonTable from '@/components/ComparisonTable';

export default function ComparePage() {
  const [compareList, setCompareList] = useState<Car[]>([]);

  useEffect(() => {
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
  }, []);

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
              <button
                onClick={handleClear}
                className="bg-red-500 text-white py-2 px-6 rounded-lg hover:bg-red-600 transition-colors font-semibold"
              >
                リストをクリア
              </button>
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
      </div>
    </div>
  );
}
