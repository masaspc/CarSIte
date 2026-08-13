'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CarCard from '@/components/CarCard';
import CompareFavoritesButton from '@/components/CompareFavoritesButton';
import { useFavorites } from '@/contexts/FavoritesContext';
import type { GradeListItem } from '@/db/queries';

export default function FavoritesContent({ queryRefs, grades }: { queryRefs: string[]; grades: GradeListItem[] }) {
  const { favorites } = useFavorites();
  const router = useRouter();

  useEffect(() => {
    if (favorites.join(',') !== queryRefs.join(',')) {
      router.replace(favorites.length ? `/favorites?items=${encodeURIComponent(favorites.join(','))}` : '/favorites');
    }
  }, [favorites, queryRefs, router]);

  return <div className="bg-gray-50 min-h-screen py-8"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="mb-6"><h1 className="text-3xl font-bold mb-2">お気に入り</h1><p className="text-gray-600">{grades.length ? `${grades.length}件のお気に入りがあります` : 'お気に入りに登録されている車両はありません'}</p></div>{grades.length === 0 ? <div className="bg-white rounded-lg shadow-md p-12 text-center"><div className="text-6xl mb-4">❤️</div><p className="text-gray-600 text-lg mb-6">お気に入りの車両がまだありません</p><Link href="/search" className="inline-block bg-primary-600 text-white py-3 px-8 rounded-lg">車を探す</Link></div> : <><div className="mb-6"><CompareFavoritesButton favorites={favorites} /></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{grades.map((grade) => <CarCard key={grade.id} grade={grade} />)}</div></>}</div></div>;
}
