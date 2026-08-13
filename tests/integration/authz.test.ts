import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

describe('requireAdmin', () => {
  it('未認証なら例外を投げる', async () => {
    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).rejects.toThrow('認証が必要です');
  });

  it('許可リスト外のGitHubユーザーを拒否する', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({ user: { githubId: '999999' } } as never);

    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).rejects.toThrow('管理者権限がありません');
  });

  it('許可リストのGitHubユーザーを通す', async () => {
    process.env.ADMIN_GITHUB_IDS = '12345,67890';
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({ user: { githubId: '12345' } } as never);

    const { requireAdmin } = await import('@/auth-guard');
    await expect(requireAdmin()).resolves.toMatchObject({ user: { githubId: '12345' } });
  });
});

// middleware の authorized コールバックが使う判定。
// next-auth v5 は authorized が無いと素通りさせるため、ここが認可の実体になる。
describe('isAdminPath', () => {
  it('管理画面のパスを対象にする', async () => {
    const { isAdminPath } = await import('@/auth-guard');
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/add')).toBe(true);
    expect(isAdminPath('/admin/edit/6f7a1f2c-0f4e-4a3d-9f0a-1b2c3d4e5f60')).toBe(true);
  });

  it('管理画面以外を対象にしない', async () => {
    const { isAdminPath } = await import('@/auth-guard');
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/search')).toBe(false);
    // 前方一致だけで判定すると別ルートまで巻き込む
    expect(isAdminPath('/administrator')).toBe(false);
  });
});

describe('isAdminSession', () => {
  it('許可リスト外・未ログイン・githubId 欠落をすべて拒否する', async () => {
    process.env.ADMIN_GITHUB_IDS = '12345,67890';
    const { isAdminSession } = await import('@/auth-guard');
    expect(isAdminSession(null)).toBe(false);
    expect(isAdminSession({ user: {} } as never)).toBe(false);
    expect(isAdminSession({ user: { githubId: '999999' } } as never)).toBe(false);
    expect(isAdminSession({ user: { githubId: 12345 } } as never)).toBe(false);
    expect(isAdminSession({ user: { githubId: '67890' } } as never)).toBe(true);
  });
});
