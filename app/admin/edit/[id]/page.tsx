import { notFound } from 'next/navigation';
import CarForm from '@/components/CarForm';
import { findAdminGrade } from '@/db/queries';
import type { GradeInput } from '@/lib/validation';

export default async function AdminEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await findAdminGrade(id);
  if (!row) notFound();
  const grade = row.grade;
  const initialData: GradeInput & { id: string } = {
    ...grade,
    wltcMode: grade.wltcMode === null ? null : Number(grade.wltcMode),
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">車両編集</h1>
        <p className="mt-2 text-sm text-gray-700">{row.manufacturer} {row.modelName} / {grade.name}</p>
      </div>
      <CarForm mode="edit" initialData={initialData} />
    </div>
  );
}
