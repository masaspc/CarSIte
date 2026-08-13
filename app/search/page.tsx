import { getPublishedGrades, PAGE_SIZE } from '@/db/queries';
import { parseSearchParams } from '@/lib/search-params';
import CarCard from '@/components/CarCard';
import FilterSidebar from '@/components/FilterSidebar';
import Pagination from '@/components/Pagination';

export const metadata = { title: '車を探す | 日本車比較サイト' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      params.append(key, v);
    }
  }

  const filters = parseSearchParams(params);
  const { rows, total } = await getPublishedGrades(filters);

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold mb-2">車を探す</h1>
        <p className="text-gray-600 mb-6">{total}件の車両が見つかりました</p>

        <div className="flex gap-6">
          <aside className="hidden lg:block w-80 flex-shrink-0">
            {/* URLSearchParams はクラスインスタンスなので Server→Client の
                props シリアライズで素の {} になり .getAll 等が消える。
                プレーンな配列として渡し、Client 側で再構築する。 */}
            <FilterSidebar entries={Array.from(params.entries())} />
          </aside>

          <main className="flex-1">
            {rows.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-12 text-center">
                <p className="text-gray-600 text-lg">条件に合う車両が見つかりませんでした</p>
                <p className="text-gray-500 mt-2">検索条件を変更してみてください</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {rows.map((grade) => (
                    <CarCard key={grade.id} grade={grade} />
                  ))}
                </div>
                <Pagination
                  total={total}
                  pageSize={PAGE_SIZE}
                  currentPage={filters.page ?? 1}
                  params={params}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
