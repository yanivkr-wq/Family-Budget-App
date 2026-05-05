import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

// Edge-safe middleware. The `authorized` callback in authConfig handles redirects.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
