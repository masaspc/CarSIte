import { approveDocument, rejectDocument } from '@/app/actions/changes';
import type { GroupedChangeRequests, PendingChange } from '@/db/admin-queries';
import type { ChangeKind } from '@/db/schema';

const KIND_LABEL: Record<ChangeKind, string> = {
  new_model: '新しい車種',
  new_grade: '新しいグレード',
  price_change: '価格改定',
  spec_change: '諸元の変更',
  discontinued: '廃止',
};

/** discontinued は販売中のグレードを消しかねない操作なので目立たせる */
const KIND_STYLE: Record<ChangeKind, string> = {
  new_model: 'bg-blue-100 text-blue-800',
  new_grade: 'bg-blue-100 text-blue-800',
  price_change: 'bg-amber-100 text-amber-800',
  spec_change: 'bg-gray-100 text-gray-800',
  discontinued: 'bg-red-100 text-red-800 ring-1 ring-red-400',
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'あり' : 'なし';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function DiffRows({ diff }: { diff: PendingChange['diff'] }) {
  const entries = Object.entries(diff);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">差分の中身がありません</p>;
  }

  return (
    <dl className="divide-y divide-gray-100 text-sm">
      {entries.map(([field, entry]) => (
        <div key={field} className="grid grid-cols-[10rem_1fr] gap-2 py-1">
          <dt className="font-mono text-xs text-gray-500 self-center">{field}</dt>
          <dd className="flex items-center gap-2">
            <span className="text-gray-500 line-through">{formatValue(entry.before)}</span>
            <span aria-hidden>→</span>
            <span className="font-semibold text-gray-900">{formatValue(entry.after)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ChangeRequestList({ groups }: { groups: GroupedChangeRequests[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg bg-white p-12 text-center shadow">
        <p className="text-gray-600">承認待ちの変更はありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.specDocumentId} className="rounded-lg bg-white shadow">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {group.manufacturer} {group.modelName}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {group.documentMonth} の諸元表 / {group.changes.length} 件の変更
                <a
                  href={group.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-3 text-primary-600 hover:underline"
                >
                  PDFを開く
                </a>
              </p>
            </div>
            <div className="flex gap-3">
              <form action={approveDocument.bind(null, group.specDocumentId)}>
                <button className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                  この諸元表をまとめて承認
                </button>
              </form>
              <form action={rejectDocument.bind(null, group.specDocumentId)}>
                <button className="rounded-md bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-300">
                  却下
                </button>
              </form>
            </div>
          </header>

          <ul className="divide-y divide-gray-200">
            {group.changes.map((change) => (
              <li key={change.id} className="px-6 py-4">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${KIND_STYLE[change.kind]}`}
                  >
                    {KIND_LABEL[change.kind]}
                  </span>
                  <span className="font-mono text-sm text-gray-700">{change.targetKey}</span>
                </div>
                <DiffRows diff={change.diff} />
                <p className="mt-2 text-xs text-gray-600">
                  <span className="font-semibold">人間の確認が要る理由: </span>
                  {change.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
