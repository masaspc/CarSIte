'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center">
            <h1 className="text-2xl font-bold text-primary-600">
              日本車比較サイト
            </h1>
          </Link>

          <nav className="hidden md:flex space-x-8">
            <Link
              href="/"
              className={`${
                pathname === '/'
                  ? 'text-primary-600 font-semibold'
                  : 'text-gray-700 hover:text-primary-600'
              } transition-colors`}
            >
              ホーム
            </Link>
            <Link
              href="/search"
              className={`${
                pathname === '/search'
                  ? 'text-primary-600 font-semibold'
                  : 'text-gray-700 hover:text-primary-600'
              } transition-colors`}
            >
              車を探す
            </Link>
            <Link
              href="/compare"
              className={`${
                pathname === '/compare'
                  ? 'text-primary-600 font-semibold'
                  : 'text-gray-700 hover:text-primary-600'
              } transition-colors`}
            >
              比較する
            </Link>
            <Link
              href="/favorites"
              className={`${
                pathname === '/favorites'
                  ? 'text-primary-600 font-semibold'
                  : 'text-gray-700 hover:text-primary-600'
              } transition-colors`}
            >
              お気に入り
            </Link>
            <Link
              href="/dealers"
              className={`${
                pathname === '/dealers'
                  ? 'text-primary-600 font-semibold'
                  : 'text-gray-700 hover:text-primary-600'
              } transition-colors`}
            >
              ディーラー検索
            </Link>
          </nav>

          <button className="md:hidden p-2">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
