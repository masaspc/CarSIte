'use client';

import { useRouter } from 'next/navigation';
import { COMPARE_KEY, MAX_COMPARE, type GradeRef } from '@/lib/compare-store';

export default function CompareFavoritesButton({ favorites }: { favorites: GradeRef[] }) {
  const router = useRouter();

  const handleClick = () => {
    const picked = favorites.slice(0, MAX_COMPARE);
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(picked));
    router.push('/compare');
  };

  return (
    <button
      onClick={handleClick}
      disabled={favorites.length === 0}
      className="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-semibold"
    >
      お気に入りを比較（先頭{MAX_COMPARE}件）
    </button>
  );
}
