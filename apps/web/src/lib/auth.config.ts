import type { NextAuthConfig } from 'next-auth';

// Edge-safe Auth.js config — no Node-only deps (no @node-rs/argon2, no DB).
// Used by middleware.ts. The full config in auth.ts extends this with the
// Credentials provider (which needs argon2 + Postgres).

export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 },
  pages: { signIn: '/sign-in' },
  providers: [], // real providers wired in auth.ts
  callbacks: {
    authorized: ({ auth, request: { nextUrl } }) => {
      const { pathname } = nextUrl;
      const isPublic =
        pathname === '/sign-in' ||
        pathname.startsWith('/sign-in/') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/_next') ||
        pathname === '/favicon.ico';
      if (isPublic) return true;
      if (auth?.user) return true;
      const url = new URL('/sign-in', nextUrl.origin);
      url.searchParams.set('callbackUrl', pathname);
      return Response.redirect(url);
    },
    jwt: async ({ token, user }) => {
      if (user) {
        const u = user as {
          id: string;
          householdId: string;
          role: string;
          locale: 'he' | 'en';
        };
        token.id = u.id;
        token.householdId = u.householdId;
        token.role = u.role;
        token.locale = u.locale;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.householdId = token.householdId as string;
        session.user.role = token.role as 'admin';
        session.user.locale = (token.locale as 'he' | 'en') ?? 'he';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
