import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { isAdminPath, isAdminSession } from '@/auth-guard';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [GitHub],
  callbacks: {
    async jwt({ token, profile }) {
      // GitHubの数値user IDを保持する。ログイン名は変更されうるため使わない
      if (profile?.id) token.githubId = String(profile.id);
      return token;
    },
    async session({ session, token }) {
      if (token.githubId) {
        (session.user as unknown as Record<string, unknown>).githubId = token.githubId;
      }
      return session;
    },
    /**
     * middleware から呼ばれる認可判定。next-auth v5 はこのコールバックが無いと
     * 「常に許可」で素通りさせる（node_modules/next-auth/src/lib/index.ts の
     * `let authorized = true` を config.callbacks?.authorized がある時だけ上書き）ため、
     * matcher を書いただけの middleware は何も守らない。
     *
     * false を返すとサインインページへリダイレクトされる。許可リスト外のアカウントで
     * ログイン済みの場合も同じ扱いにし、draft を含む管理画面には一切到達させない。
     * ここを通っても各ページの requireAdmin() は省略しない（多層防御）。
     */
    authorized({ request, auth: session }) {
      if (!isAdminPath(request.nextUrl.pathname)) return true;
      return isAdminSession(session);
    },
  },
});
