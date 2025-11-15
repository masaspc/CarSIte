'use client';

import Link from 'next/link';
import { Car } from '@/types/car';
import { formatPrice, formatFuelEfficiency } from '@/lib/carData';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useReviews } from '@/contexts/ReviewsContext';

interface CarCardProps {
  car: Car;
  onAddToCompare?: (car: Car) => void;
  showCompareButton?: boolean;
}

export default function CarCard({ car, onAddToCompare, showCompareButton = true }: CarCardProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const { getReviewStats } = useReviews();
  const favorite = isFavorite(car.id);
  const reviewStats = getReviewStats(car.id);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
      <Link href={`/cars/${car.id}`}>
        <div className="aspect-video bg-gray-200 relative">
          <img
            src={car.images.exterior[0]}
            alt={`${car.manufacturer} ${car.model}`}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2 left-2 bg-white px-2 py-1 rounded text-sm font-semibold">
            {car.manufacturer}
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              toggleFavorite(car.id);
            }}
            className="absolute top-2 right-2 bg-white p-2 rounded-full hover:bg-gray-100 transition-colors shadow-md"
            aria-label={favorite ? 'お気に入りから削除' : 'お気に入りに追加'}
          >
            <svg
              className="w-6 h-6"
              fill={favorite ? '#ef4444' : 'none'}
              stroke={favorite ? '#ef4444' : 'currentColor'}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </button>
        </div>
      </Link>

      <div className="p-4">
        <Link href={`/cars/${car.id}`}>
          <h3 className="text-xl font-bold mb-1 hover:text-primary-600">
            {car.model}
          </h3>
          <p className="text-sm text-gray-600 mb-1">{car.grade}</p>
          {reviewStats.totalReviews > 0 && (
            <div className="flex items-center gap-1 mb-2">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    className={`text-sm ${
                      star <= Math.round(reviewStats.averageRating)
                        ? 'text-yellow-400'
                        : 'text-gray-300'
                    }`}
                  >
                    ★
                  </span>
                ))}
              </div>
              <span className="text-xs text-gray-600">
                {reviewStats.averageRating.toFixed(1)} ({reviewStats.totalReviews})
              </span>
            </div>
          )}
        </Link>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">価格</span>
            <span className="font-semibold text-lg text-primary-600">
              {formatPrice(car.price)}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">燃費（WLTC）</span>
            <span className="font-semibold">
              {formatFuelEfficiency(car.fuelEfficiency.wltcMode)}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">ボディタイプ</span>
            <span className="font-semibold">{car.bodyType}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">駆動方式</span>
            <span className="font-semibold">{car.engine.driveSystem}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/cars/${car.id}`}
            className="flex-1 bg-primary-600 text-white py-2 px-4 rounded hover:bg-primary-700 transition-colors text-center text-sm font-semibold"
          >
            詳細を見る
          </Link>

          {showCompareButton && onAddToCompare && (
            <button
              onClick={() => onAddToCompare(car)}
              className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300 transition-colors text-sm font-semibold"
            >
              比較
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
