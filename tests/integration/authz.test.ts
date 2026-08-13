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
