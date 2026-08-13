import CompareListClient from '@/components/CompareListClient';
import { getComparisonGrades } from '@/app/actions/compare';
import { MAX_COMPARE } from '@/lib/compare-store';

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ cars?: string }> }) {
  const { cars } = await searchParams;
  const refs = (cars ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARE);
  const grades = await getComparisonGrades(refs);
  return <CompareListClient initialRefs={refs} grades={grades} />;
}
