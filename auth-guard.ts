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
 * 場合に使う。許可リストのパース処理を requireAdmin と共有する。
 */
export function isAdminSession(session: Session | null): boolean {
  if (!session?.user) return false;
  const githubId = (session.user as Record<string, unknown>).githubId;
  return typeof githubId === 'string' && allowedIds().has(githubId);
}

/**
 * Server Action の内部で必ず呼ぶ。
 * middleware だけに認可を依存させないための多層防御であり、
 * middleware があるからといって省略してはいけない。
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
