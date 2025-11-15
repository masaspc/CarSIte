'use client';

import { useState, useEffect } from 'react';
import { Dealer, prefectures } from '@/types/dealer';
import dealersData from '@/data/dealers.json';

export default function DealersPage() {
  const [dealers] = useState<Dealer[]>(dealersData as Dealer[]);
  const [filteredDealers, setFilteredDealers] = useState<Dealer[]>(dealersData as Dealer[]);
  const [selectedPrefecture, setSelectedPrefecture] = useState<string>('');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('');

  // メーカーのリストを抽出
  const manufacturers = Array.from(new Set(dealers.map((d) => d.manufacturer))).sort();

  useEffect(() => {
    let filtered = dealers;

    if (selectedPrefecture) {
      filtered = filtered.filter((d) => d.prefecture === selectedPrefecture);
    }

    if (selectedManufacturer) {
      filtered = filtered.filter((d) => d.manufacturer === selectedManufacturer);
    }

    setFilteredDealers(filtered);
  }, [selectedPrefecture, selectedManufacturer, dealers]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900">ディーラー検索</h1>
          <p className="mt-2 text-gray-600">
            お近くのディーラーを検索できます
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* フィルター */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-lg font-bold mb-4">検索条件</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                都道府県
              </label>
              <select
                value={selectedPrefecture}
                onChange={(e) => setSelectedPrefecture(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">すべて</option>
                {prefectures.map((pref) => (
                  <option key={pref} value={pref}>
                    {pref}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                メーカー
              </label>
              <select
                value={selectedManufacturer}
                onChange={(e) => setSelectedManufacturer(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">すべて</option>
                {manufacturers.map((manufacturer) => (
                  <option key={manufacturer} value={manufacturer}>
                    {manufacturer}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setSelectedPrefecture('');
                setSelectedManufacturer('');
              }}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
            >
              条件をクリア
            </button>
          </div>
        </div>

        {/* 結果 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold">
              検索結果: {filteredDealers.length}件
            </h2>
          </div>

          {filteredDealers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              条件に一致するディーラーが見つかりませんでした
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredDealers.map((dealer) => (
                <div
                  key={dealer.id}
                  className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {dealer.name}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {dealer.manufacturer}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-start">
                      <span className="text-gray-600 w-20">住所:</span>
                      <span className="text-gray-900">{dealer.address}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-600 w-20">電話:</span>
                      <a
                        href={`tel:${dealer.phone}`}
                        className="text-primary-600 hover:underline"
                      >
                        {dealer.phone}
                      </a>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-600 w-20">営業時間:</span>
                      <span className="text-gray-900">{dealer.businessHours}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="text-gray-600 w-20">定休日:</span>
                      <span className="text-gray-900">{dealer.closedDays}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm text-gray-600 mb-2">サービス:</div>
                    <div className="flex flex-wrap gap-2">
                      {dealer.services.map((service, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                        >
                          {service}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
