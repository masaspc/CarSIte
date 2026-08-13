'use client';

import Link from 'next/link';
import type { GradeListItem } from '@/db/queries';
import { useFavorites } from '@/contexts/FavoritesContext';

interface CarCardProps {
  grade: GradeListItem;
}

interface GradeImages {
  exterior?: string[];
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

function formatFuelEfficiency(wltcMode: string | null): string {
  if (wltcMode === null) return '-';
  return `${wltcMode} km/L`;
}

export default function CarCard({ grade }: CarCardProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const gradeRef = `${grade.manufacturerSlug}/${grade.modelSlug}/${grade.slug}`;
  const favorite = isFavorite(gradeRef);
  const href = `/cars/${grade.manufacturerSlug}/${grade.modelSlug}`;
  const images = grade.images as GradeImages | null;
  const cover = images?.exterior?.[0];

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
      <Link href={href}>
        <div className="aspect-video bg-gray-200 relative">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={`${grade.manufacturer} ${grade.modelName}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              画像なし
            </div>
          )}
          <div className="absolute top-2 left-2 bg-white px-2 py-1 rounded text-sm font-semibold">
            {grade.manufacturer}
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              toggleFavorite(gradeRef);
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
        <Link href={href}>
          <h3 className="text-xl font-bold mb-1 hover:text-primary-600">
            {grade.modelName}
          </h3>
          <p className="text-sm text-gray-600 mb-1">{grade.name}</p>
        </Link>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">価格</span>
            <span className="font-semibold text-lg text-primary-600">
              {formatPrice(grade.price)}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">燃費（WLTC）</span>
            <span className="font-semibold">{formatFuelEfficiency(grade.wltcMode)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">ボディタイプ</span>
            <span className="font-semibold">{grade.bodyType}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-600">駆動方式</span>
            <span className="font-semibold">{grade.driveSystem}</span>
          </div>
        </div>

        <Link
          href={href}
          className="block bg-primary-600 text-white py-2 px-4 rounded hover:bg-primary-700 transition-colors text-center text-sm font-semibold"
        >
          詳細を見る
        </Link>
      </div>
    </div>
  );
}
