import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">ページが見つかりません</h1>
        <Link href="/search" className="text-primary-600 underline">
          車を探す
        </Link>
      </div>
    </div>
  );
}
