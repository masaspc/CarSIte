'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ComparisonTable from '@/components/ComparisonTable';
import { COMPARE_KEY, MAX_COMPARE, readCompare, type GradeRef } from '@/lib/compare-store';
import type { ComparisonRow } from '@/db/queries';

export default function CompareListClient({ initialRefs, grades }: { initialRefs: GradeRef[]; grades: ComparisonRow[] }) {
  const router = useRouter();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    if (initialRefs.length > 0) {
      sessionStorage.setItem(COMPARE_KEY, JSON.stringify(initialRefs));
      return;
    }
    const stored = readCompare().slice(0, MAX_COMPARE);
    if (stored.length > 0) router.replace(`/compare?cars=${encodeURIComponent(stored.join(','))}`);
  }, [initialRefs, router]);

  const navigate = (refs: GradeRef[]) => {
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(refs));
    router.push(refs.length ? `/compare?cars=${encodeURIComponent(refs.join(','))}` : '/compare');
  };

  const handleShare = () => {
    setShareUrl(window.location.href);
    setShowShareDialog(true);
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex justify-between items-center">
          <div><h1 className="text-3xl font-bold mb-2">車両比較</h1><p className="text-gray-600">{grades.length ? `${grades.length}台の車両を比較中` : '比較する車両を選択してください'}</p></div>
          {grades.length > 0 && <div className="flex gap-3"><button onClick={handleShare} className="bg-primary-600 text-white py-2 px-6 rounded-lg">共有する</button><button onClick={() => confirm('比較リストをクリアしてもよろしいですか？') && navigate([])} className="bg-red-500 text-white py-2 px-6 rounded-lg">リストをクリア</button></div>}
        </div>
        <div className="bg-white rounded-lg shadow-md p-6"><ComparisonTable grades={grades} onRemove={(ref) => navigate(initialRefs.filter((item) => item !== ref))} /></div>
        {grades.length > 0 && grades.length < MAX_COMPARE && <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800 text-sm">最大{MAX_COMPARE}台まで比較できます。あと{MAX_COMPARE - grades.length}台追加できます。</div>}
        {showShareDialog && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6"><h2 className="text-2xl font-bold mb-4">比較リストを共有</h2><div className="flex gap-2"><input value={shareUrl} readOnly className="flex-1 px-3 py-2 border rounded" /><button onClick={() => navigator.clipboard.writeText(shareUrl)} className="px-4 py-2 bg-primary-600 text-white rounded">コピー</button></div><button onClick={() => setShowShareDialog(false)} className="mt-4 px-6 py-2 bg-gray-200 rounded">閉じる</button></div></div>}
      </div>
    </div>
  );
}
