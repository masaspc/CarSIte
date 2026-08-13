import Link from 'next/link';
import { auth, signIn, signOut } from '@/auth';
import { isAdminSession } from '@/auth-guard';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-6 bg-white p-8 rounded-lg shadow-md text-center">
          <h2 className="text-3xl font-bold text-gray-900">管理画面</h2>
          <p className="text-sm text-gray-600">GitHub アカウントでログインしてください</p>
          <form
            action={async () => {
              'use server';
              await signIn('github', { redirectTo: '/admin' });
            }}
          >
            <button className="w-full py-2 px-4 rounded-md text-white bg-primary-600 hover:bg-primary-700">
              GitHub でログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  // middleware・Server Action 側の requireAdmin と同じ許可リストで判定する。
  // ここを通さないと「GitHubでログインさえすれば誰でも管理画面の一覧（draft含む）が見える」状態になる。
  if (!isAdminSession(session)) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-6 bg-white p-8 rounded-lg shadow-md text-center">
          <h2 className="text-2xl font-bold text-gray-900">アクセス権がありません</h2>
          <p className="text-sm text-gray-600">
            このGitHubアカウントには管理者権限が付与されていません。
          </p>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <button className="w-full py-2 px-4 rounded-md text-white bg-gray-600 hover:bg-gray-700">
              サインアウト
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gray-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold">車両管理システム</h1>
            <nav className="ml-10 flex items-center space-x-4">
              <Link href="/admin" className="px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white">
                車両一覧
              </Link>
              <Link href="/admin/add" className="px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white">
                新規追加
              </Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/" className="text-gray-300 hover:text-white text-sm">サイトに戻る</Link>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
            >
              <button className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm">ログアウト</button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
