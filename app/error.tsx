'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">問題が発生しました</h1>
        <p className="text-gray-600 mb-6">
          時間をおいて再度お試しください。
        </p>
        <button onClick={reset} className="bg-primary-600 text-white py-2 px-6 rounded">
          再読み込み
        </button>
      </div>
    </div>
  );
}
