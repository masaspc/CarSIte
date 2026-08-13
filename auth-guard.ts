import type { Session } from 'next-auth';
import { auth } from '@/auth';

export class AuthorizationError extends Error {}

function allowedIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_GITHUB_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * 例外を投げない版。管理画面のレイアウトのように「未認可なら別の画面を描画する」
 * 場合と、middleware の authorized コールバックから使う。
 * 許可リストのパース処理を requireAdmin と共有する。
 */
export function isAdminSession(session: Session | null): boolean {
  if (!session?.user) return false;
  const githubId = (session.user as Record<string, unknown>).githubId;
  return typeof githubId === 'string' && allowedIds().has(githubId);
}

/**
 * middleware.ts の matcher `/admin/:path*` と同じ範囲を表す。
 * パス判定を関数に切り出しておくと、next-auth を起動せずに単体テストできる。
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * Server Action と管理画面の各ページで必ず呼ぶ。
 * middleware だけに認可を依存させないための多層防御であり、
 * middleware があるからといって省略してはいけない。
 *
 * レイアウトはソフトナビゲーション時に再実行されないことがあるため、
 * ページ側の呼び出しを layout.tsx の判定で代用してはいけない。
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    throw new AuthorizationError('認証が必要です');
  }
  if (!isAdminSession(session)) {
    throw new AuthorizationError('管理者権限がありません');
  }

  return session;
}
