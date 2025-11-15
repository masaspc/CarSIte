'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CarForm from '@/components/CarForm';
import { Car } from '@/types/car';

export default function AdminEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [car, setCar] = useState<Car | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCar();
  }, [id]);

  const loadCar = async () => {
    try {
      const response = await fetch('/api/cars');
      const cars: Car[] = await response.json();
      const foundCar = cars.find((c) => c.id === id);

      if (foundCar) {
        setCar(foundCar);
      } else {
        alert('車両が見つかりません');
        router.push('/admin');
      }
    } catch (error) {
      console.error('Error loading car:', error);
      alert('車両データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  if (!car) {
    return null;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">車両編集</h1>
        <p className="mt-2 text-sm text-gray-700">
          {car.manufacturer} {car.model} の情報を編集します
        </p>
      </div>

      <CarForm mode="edit" initialData={car} />
    </div>
  );
}
