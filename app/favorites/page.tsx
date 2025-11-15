'use client';

import { useFavorites } from '@/contexts/FavoritesContext';
import { getCarById } from '@/lib/carData';
import CarCard from '@/components/CarCard';
import Link from 'next/link';
import { Car } from '@/types/car';

export default function FavoritesPage() {
  const { favorites } = useFavorites();

  // お気に入りIDから車両データを取得
  const favoriteCars = favorites
    .map((id) => getCarById(id))
    .filter((car): car is Car => car !== undefined);

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
          <h1 className="text-3xl font-bold mb-2">お気に入り</h1>
          <p className="text-gray-600">
            {favoriteCars.length > 0
              ? `${favoriteCars.length}件のお気に入りがあります`
              : 'お気に入りに登録されている車両はありません'}
          </p>
        </div>

        {favoriteCars.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="text-6xl mb-4">❤️</div>
            <p className="text-gray-600 text-lg mb-4">
              お気に入りの車両がまだありません
            </p>
            <p className="text-gray-500 mb-6">
              車両カードのハートアイコンをクリックして、お気に入りに追加しましょう
            </p>
            <Link
              href="/search"
              className="inline-block bg-primary-600 text-white py-3 px-8 rounded-lg hover:bg-primary-700 transition-colors font-semibold"
            >
              車を探す
            </Link>
          </div>
        ) : (
          <>
            {/* 一括操作 */}
            <div className="mb-6 flex gap-4">
              <Link
                href="/compare"
                className="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition-colors font-semibold"
              >
                お気に入りを比較
              </Link>
            </div>

            {/* 車両リスト */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {favoriteCars.map((car) => (
                <CarCard
                  key={car.id}
                  car={car}
                  onAddToCompare={handleAddToCompare}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
