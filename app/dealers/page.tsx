import { getDealers } from '@/db/queries';
import DealersFilter from '@/components/DealersFilter';

export const metadata = { title: 'ディーラー検索 | 日本車比較サイト' };

export default async function DealersPage() {
  const dealers = await getDealers();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900">ディーラー検索</h1>
          <p className="mt-2 text-gray-600">
            お近くのディーラーを検索できます
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <DealersFilter dealers={dealers} />
      </div>
    </div>
  );
}
