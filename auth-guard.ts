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
 * Server Action の内部で必ず呼ぶ。
 * middleware だけに認可を依存させないための多層防御であり、
 * middleware があるからといって省略してはいけない。
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    throw new AuthorizationError('認証が必要です');
  }

  const githubId = (session.user as Record<string, unknown>).githubId;
  if (typeof githubId !== 'string' || !allowedIds().has(githubId)) {
    throw new AuthorizationError('管理者権限がありません');
  }

  return session;
}
