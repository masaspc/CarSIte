import Link from 'next/link';

export default function Pagination({
  total,
  pageSize,
  currentPage,
  params,
}: {
  total: number;
  pageSize: number;
  currentPage: number;
  params: URLSearchParams;
}) {
  const lastPage = Math.ceil(total / pageSize);
  if (lastPage <= 1) return null;

  const href = (page: number) => {
    const next = new URLSearchParams(params);
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    const query = next.toString();
    return query ? `/search?${query}` : '/search';
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="ページ送り">
      {currentPage > 1 && (
        <Link href={href(currentPage - 1)} className="px-4 py-2 border rounded hover:bg-gray-50">
          前へ
        </Link>
      )}
      <span className="text-sm text-gray-600">
        {currentPage} / {lastPage}
      </span>
      {currentPage < lastPage && (
        <Link href={href(currentPage + 1)} className="px-4 py-2 border rounded hover:bg-gray-50">
          次へ
        </Link>
      )}
    </nav>
  );
}
