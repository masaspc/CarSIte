import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-800 text-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold mb-4">日本車比較サイト</h3>
            <p className="text-gray-300 text-sm">
              日本国内で販売されている自動車を、様々な観点から比較検討できるWebサイトです。
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">リンク</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="text-gray-300 hover:text-white">
                  ホーム
                </Link>
              </li>
              <li>
                <Link href="/search" className="text-gray-300 hover:text-white">
                  車を探す
                </Link>
              </li>
              <li>
                <Link href="/compare" className="text-gray-300 hover:text-white">
                  比較する
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">注意事項</h3>
            <p className="text-gray-300 text-sm">
              掲載情報は参考値です。最新情報は各メーカーの公式サイトをご確認ください。
            </p>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-8 pt-8 text-center text-sm text-gray-400">
          <p>&copy; 2024 日本車比較サイト. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
