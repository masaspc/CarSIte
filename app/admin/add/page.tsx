import CarForm from '@/components/CarForm';
import { listModels } from '@/db/admin-queries';

export default async function AdminAddPage() {
  const models = await listModels();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">新規車両追加</h1>
        <p className="mt-2 text-sm text-gray-700">
          新しい車両データを追加します
        </p>
      </div>

      <CarForm mode="add" models={models} />
    </div>
  );
}
