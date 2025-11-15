'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CarCard from '@/components/CarCard';
import FilterSidebar from '@/components/FilterSidebar';
import { filterCars, sortCars, getManufacturers } from '@/lib/carData';
import { Car, FilterParams, SortOption } from '@/types/car';

function SearchContent() {
  const searchParams = useSearchParams();
  const [filteredCars, setFilteredCars] = useState<Car[]>([]);
  const [currentFilters, setCurrentFilters] = useState<FilterParams>({});
  const [sortOption, setSortOption] = useState<SortOption>('price-asc');
  const [showFilters, setShowFilters] = useState(false);

  const manufacturers = getManufacturers();

  useEffect(() => {
    // URLパラメータから初期フィルタを設定
    const keyword = searchParams.get('keyword') || '';
    const bodyType = searchParams.get('bodyType') || '';

    const initialFilters: FilterParams = {};
    if (keyword) initialFilters.keyword = keyword;
    if (bodyType) initialFilters.bodyTypes = [bodyType as any];

    setCurrentFilters(initialFilters);
    updateResults(initialFilters, sortOption);
  }, [searchParams]);

  const updateResults = (filters: FilterParams, sort: SortOption) => {
    const filtered = filterCars(filters);
    const sorted = sortCars(filtered, sort);
    setFilteredCars(sorted);
  };

  const handleFilterChange = (filters: FilterParams) => {
    setCurrentFilters(filters);
    updateResults(filters, sortOption);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSort = e.target.value as SortOption;
    setSortOption(newSort);
    updateResults(currentFilters, newSort);
  };

  const handleAddToCompare = (car: Car) => {
    const compareListJson = sessionStorage.getItem('compareList');
    const compareList: Car[] = compareListJson ? JSON.parse(compareListJson) : [];

    if (compareList.some((c) => c.id === car.id)) {
      alert('この車両は既に比較リストに追加されています');
      return;
    }

    if (compareList.length >= 3) {
      alert('比較リストは最大3台までです');
      return;
    }

    compareList.push(car);
    sessionStorage.setItem('compareList', JSON.stringify(compareList));
    alert(`${car.manufacturer} ${car.model} を比較リストに追加しました`);
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">車を探す</h1>
          <p className="text-gray-600">
            {filteredCars.length}件の車両が見つかりました
          </p>
        </div>

        <div className="flex gap-6">
          {/* フィルタサイドバー (PC) */}
          <aside className="hidden lg:block w-80 flex-shrink-0">
            <FilterSidebar
              manufacturers={manufacturers}
              onFilterChange={handleFilterChange}
            />
          </aside>

          {/* モバイル用フィルタボタン */}
          <div className="lg:hidden fixed bottom-4 right-4 z-40">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="bg-primary-600 text-white px-6 py-3 rounded-full shadow-lg hover:bg-primary-700 transition-colors"
            >
              絞り込み
            </button>
          </div>

          {/* モバイル用フィルタモーダル */}
          {showFilters && (
            <div className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-50">
              <div className="absolute right-0 top-0 h-full w-80 bg-white overflow-y-auto">
                <div className="p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">絞り込み</h2>
                    <button
                      onClick={() => setShowFilters(false)}
                      className="text-gray-600 hover:text-gray-800"
                    >
                      ✕
                    </button>
                  </div>
                  <FilterSidebar
                    manufacturers={manufacturers}
                    onFilterChange={(filters) => {
                      handleFilterChange(filters);
                      setShowFilters(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* メインコンテンツ */}
          <main className="flex-1">
            {/* 並び替え */}
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <div className="flex items-center justify-between">
                <label htmlFor="sort" className="text-sm font-semibold">
                  並び替え:
                </label>
                <select
                  id="sort"
                  value={sortOption}
                  onChange={handleSortChange}
                  className="px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-primary-600"
                >
                  <option value="price-asc">価格が安い順</option>
                  <option value="price-desc">価格が高い順</option>
                  <option value="fuel-desc">燃費が良い順</option>
                  <option value="date-desc">発売日が新しい順</option>
                  <option value="date-asc">発売日が古い順</option>
                  <option value="name-asc">車名（50音順）</option>
                </select>
              </div>
            </div>

            {/* 車両リスト */}
            {filteredCars.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-600 text-lg">
                  条件に合う車両が見つかりませんでした
                </p>
                <p className="text-gray-500 mt-2">
                  検索条件を変更してみてください
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredCars.map((car) => (
                  <CarCard
                    key={car.id}
                    car={car}
                    onAddToCompare={handleAddToCompare}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">読み込み中...</div>}>
      <SearchContent />
    </Suspense>
  );
}
