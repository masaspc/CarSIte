import FavoritesContent from '@/components/FavoritesContent';
import { getComparisonGrades } from '@/app/actions/compare';
import { toGradeListItem } from '@/db/queries';

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ items?: string }> }) {
  const { items } = await searchParams;
  const refs = (items ?? '').split(',').filter(Boolean);
  const rows = await getComparisonGrades(refs);
  const grades = rows.map(toGradeListItem);
  return <FavoritesContent queryRefs={refs} grades={grades} />;
}
