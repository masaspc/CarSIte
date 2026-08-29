import ChangeRequestList from '@/components/ChangeRequestList';
import { requireAdmin } from '@/auth-guard';
import { listPendingChangeRequests } from '@/db/admin-queries';

export default async function AdminChangesPage() {
  // layout.tsx はソフトナビゲーションで再実行されないため、ページ側でも必ず確認する
  await requireAdmin();
  const groups = await listPendingChangeRequests();
  const total = groups.reduce((sum, group) => sum + group.changes.length, 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">承認キュー</h1>
        <p className="mt-2 text-sm text-gray-700">
          諸元表{groups.length}件 / 変更{total}件が承認待ちです。承認は諸元表（PDF1つ）単位で行います。
        </p>
      </div>

      <ChangeRequestList groups={groups} />
    </div>
  );
}
