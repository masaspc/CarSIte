'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Car } from '@/types/car';
import { formatPrice } from '@/lib/carData';

export default function AdminPage() {
  const [cars, setCars] = useState<Car[]>([]);
  const [filteredCars, setFilteredCars] = useState<Car[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCars();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = cars.filter(
        (car) =>
          car.manufacturer.toLowerCase().includes(searchTerm.toLowerCase()) ||
          car.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
          car.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCars(filtered);
    } else {
      setFilteredCars(cars);
    }
  }, [searchTerm, cars]);

  const loadCars = async () => {
    try {
      const response = await fetch('/api/cars');
      const data = await response.json();
      setCars(data);
      setFilteredCars(data);
    } catch (error) {
      console.error('Error loading cars:', error);
      alert('車両データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除してもよろしいですか？\nこの操作は取り消せません。`)) {
      return;
    }

    try {
      const response = await fetch(`/api/cars/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        alert('削除しました');
        loadCars();
      } else {
        alert('削除に失敗しました');
      }
    } catch (error) {
      console.error('Error deleting car:', error);
      alert('削除に失敗しました');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-bold text-gray-900">車両一覧</h1>
          <p className="mt-2 text-sm text-gray-700">
            全 {cars.length} 台の車両が登録されています
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <Link
            href="/admin/add"
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            新規追加
          </Link>
        </div>
      </div>

      {/* 検索 */}
      <div className="mt-6">
        <input
          type="text"
          placeholder="メーカー、車種名、IDで検索..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* 車両一覧テーブル */}
      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300 bg-white">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">
                      ID
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      メーカー
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      車種名
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      グレード
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      価格
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      ボディタイプ
                    </th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredCars.map((car) => (
                    <tr key={car.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900">
                        {car.id}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {car.manufacturer}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium">
                        {car.model}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {car.grade}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {formatPrice(car.price)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {car.bodyType}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <Link
                          href={`/admin/edit/${car.id}`}
                          className="text-primary-600 hover:text-primary-900 mr-4"
                        >
                          編集
                        </Link>
                        <button
                          onClick={() =>
                            handleDelete(car.id, `${car.manufacturer} ${car.model}`)
                          }
                          className="text-red-600 hover:text-red-900"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {filteredCars.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {searchTerm ? '検索結果がありません' : '車両データがありません'}
        </div>
      )}
    </div>
  );
}
