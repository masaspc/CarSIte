'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CarCard from '@/components/CarCard';
import { getAllCars, getBodyTypes } from '@/lib/carData';
import { Car } from '@/types/car';

export default function Home() {
  const router = useRouter();
  const [searchKeyword, setSearchKeyword] = useState('');
  const allCars = getAllCars();
  const bodyTypes = getBodyTypes();

  // 最新の車を取得（発売日順）
  const latestCars = [...allCars]
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, 6);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchKeyword.trim()) {
      router.push(`/search?keyword=${encodeURIComponent(searchKeyword)}`);
    } else {
      router.push('/search');
    }
  };

  const handleAddToCompare = (car: Car) => {
    // セッションストレージから比較リストを取得
    const compareListJson = sessionStorage.getItem('compareList');
    const compareList: Car[] = compareListJson ? JSON.parse(compareListJson) : [];

    // 既に追加されているかチェック
    if (compareList.some((c) => c.id === car.id)) {
      alert('この車両は既に比較リストに追加されています');
      return;
    }

    // 最大3台まで
    if (compareList.length >= 3) {
      alert('比較リストは最大3台までです');
      return;
    }

    // 追加
    compareList.push(car);
    sessionStorage.setItem('compareList', JSON.stringify(compareList));
    alert(`${car.manufacturer} ${car.model} を比較リストに追加しました`);
  };

  return (
    <div className="bg-gray-50">
      {/* ヒーローセクション */}
      <section className="bg-gradient-to-r from-primary-600 to-primary-800 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              あなたにピッタリの車を見つけよう
            </h1>
            <p className="text-xl mb-8 text-primary-100">
              日本国内で販売されている自動車を、様々な観点から比較検討
            </p>

            <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="車種名やメーカー名で検索"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="flex-1 px-6 py-4 rounded-lg text-gray-900 text-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
                />
                <button
                  type="submit"
                  className="bg-white text-primary-600 px-8 py-4 rounded-lg font-semibold hover:bg-primary-50 transition-colors"
                >
                  検索
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ボディタイプ別カテゴリー */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12">
            ボディタイプから探す
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {bodyTypes.map((bodyType) => (
              <Link
                key={bodyType}
                href={`/search?bodyType=${encodeURIComponent(bodyType)}`}
                className="bg-gray-100 hover:bg-primary-50 border-2 border-transparent hover:border-primary-600 rounded-lg p-6 text-center transition-all"
              >
                <div className="text-4xl mb-2">🚗</div>
                <p className="font-semibold">{bodyType}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 新着・おすすめ車種 */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold">新着車種</h2>
            <Link
              href="/search"
              className="text-primary-600 hover:text-primary-700 font-semibold"
            >
              すべて見る →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {latestCars.map((car) => (
              <CarCard
                key={car.id}
                car={car}
                onAddToCompare={handleAddToCompare}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 特徴セクション */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12">
            このサイトの特徴
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">詳細な検索</h3>
              <p className="text-gray-600">
                価格、燃費、ボディタイプなど、様々な条件で車を絞り込めます
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">簡単比較</h3>
              <p className="text-gray-600">
                最大3台まで同時に比較し、スペックを一目で確認できます
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">詳細な情報</h3>
              <p className="text-gray-600">
                各車両の詳細なスペックや装備情報を確認できます
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
