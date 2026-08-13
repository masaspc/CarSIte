import Link from 'next/link';
import {
  clearModelVerified,
  deleteGrade,
  setModelVerified,
  setPublicationStatus,
} from '@/app/actions/cars';
import { requireAdmin } from '@/auth-guard';
import { listAllGrades, listModelsWithVerification } from '@/db/admin-queries';

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
  // レイアウトの判定に依存しない。兄弟ルート間のソフトナビゲーションでは
  // layout.tsx が再実行されず、権限を外された後でも draft が見えてしまうため。
  await requireAdmin();
  const [rows, modelRows] = await Promise.all([listAllGrades(), listModelsWithVerification()]);
  const unverifiedModels = modelRows.filter((m) => m.verifiedAt === null).length;

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

      {/* 車種の検証。車種ページは車種名・説明・ボディタイプ・公式URLも描画し、
          説明は generateMetadata にも入るため、グレードの公開はここを通してから許す */}
      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">車種の検証</h2>
        <p className="mt-1 text-sm text-gray-700">
          未検証の車種は {unverifiedModels} / {modelRows.length} 件です。
          車種が未検証のあいだ、その車種のグレードは公開できません。
          車種名・説明・ボディタイプ・公式URLを確認してから「検証済みにする」を押してください。
        </p>
        <div className="mt-4 max-h-96 overflow-auto shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
          <table className="min-w-full divide-y divide-gray-300 bg-white">
            <thead className="bg-gray-50">
              <tr>
                {['メーカー', '車種名', 'ボディタイプ', '公式URL', 'グレード数', '検証状態', '操作'].map((heading) => (
                  <th key={heading} className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {modelRows.map((model) => (
                <tr key={model.id}>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{model.manufacturer}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm font-medium">{model.name}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{model.bodyType}</td>
                  <td className="max-w-xs truncate px-3 py-4 text-sm text-gray-500">{model.officialUrl ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{model.gradeCount}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm">
                    {model.verifiedAt === null ? (
                      <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">未検証</span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                        検証済み（{model.verifiedBy ?? '不明'} / {model.verifiedAt.toISOString().slice(0, 10)}）
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm font-medium">
                    {model.verifiedAt === null ? (
                      <form className="inline" action={setModelVerified.bind(null, model.id)}>
                        <button className="text-blue-600 hover:text-blue-900">検証済みにする</button>
                      </form>
                    ) : (
                      <form className="inline" action={clearModelVerified.bind(null, model.id)}>
                        <button className="text-red-600 hover:text-red-900">検証を取り消す</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="mt-10 text-xl font-bold text-gray-900">グレード</h2>
      <div className="mt-4 overflow-x-auto shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300 bg-white">
          <thead className="bg-gray-50">
            <tr>
              {['メーカー', '車種名', 'グレード', '価格', '公開状態', '操作'].map((heading) => (
                <th key={heading} className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map(({ grade, manufacturer, modelName, modelVerifiedAt }) => (
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
                  {NEXT_STATUSES[grade.publicationStatus].map(({ status, label }) =>
                    // 車種が未検証なら公開へは進めない。押せてしまうと Server Action 側の
                    // 拒否まで気付けないので、理由を添えて無効にする（拒否の実体はサーバ側）
                    status === 'published' && modelVerifiedAt === null ? (
                      <span key={status} className="mr-4 text-gray-400" title="車種が未検証のため公開できません">
                        公開する（車種が未検証）
                      </span>
                    ) : (
                      <form key={status} className="inline" action={setPublicationStatus.bind(null, grade.id, status)}>
                        <button className="text-blue-600 hover:text-blue-900 mr-4">{label}</button>
                      </form>
                    ),
                  )}
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
