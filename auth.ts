import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

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
  },
});
