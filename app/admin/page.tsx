import Link from 'next/link';
import { deleteGrade, setPublicationStatus } from '@/app/actions/cars';
import { listAllGrades } from '@/db/admin-queries';

const statusLabel = { draft: '下書き', published: '公開中', archived: 'アーカイブ' } as const;
const statusBadgeClass = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-red-100 text-red-800',
} as const;
/** 現在の状態から遷移できる先。setPublicationStatus は draft/published/archived の3値のみ受け付ける */
const NEXT_STATUSES = {
  draft: [
    { status: 'published', label: '公開する' },
    { status: 'archived', label: 'アーカイブする' },
  ],
  published: [
    { status: 'draft', label: '下書きに戻す' },
    { status: 'archived', label: 'アーカイブする' },
  ],
  archived: [
    { status: 'draft', label: '下書きに戻す' },
    { status: 'published', label: '公開する' },
  ],
} as const;

export default async function AdminPage() {
  const rows = await listAllGrades();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-bold text-gray-900">車両一覧</h1>
          <p className="mt-2 text-sm text-gray-700">全 {rows.length} 件のグレードが登録されています</p>
        </div>
        <Link href="/admin/add" className="mt-4 sm:mt-0 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
          新規追加
        </Link>
      </div>

      <div className="mt-8 overflow-x-auto shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300 bg-white">
          <thead className="bg-gray-50">
            <tr>
              {['メーカー', '車種名', 'グレード', '価格', '公開状態', '操作'].map((heading) => (
                <th key={heading} className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map(({ grade, manufacturer, modelName }) => (
              <tr key={grade.id}>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{manufacturer}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm font-medium">{modelName}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{grade.name}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">¥{grade.price.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass[grade.publicationStatus]}`}>
                    {statusLabel[grade.publicationStatus]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm font-medium">
                  <Link href={`/admin/edit/${grade.id}`} className="text-primary-600 hover:text-primary-900 mr-4">編集</Link>
                  {NEXT_STATUSES[grade.publicationStatus].map(({ status, label }) => (
                    <form key={status} className="inline" action={setPublicationStatus.bind(null, grade.id, status)}>
                      <button className="text-blue-600 hover:text-blue-900 mr-4">{label}</button>
                    </form>
                  ))}
                  <form className="inline" action={deleteGrade.bind(null, grade.id)}>
                    <button className="text-red-600 hover:text-red-900">削除</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
