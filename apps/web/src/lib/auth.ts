import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { getDb, schema, decryptString } from '@fba/db';
import { authConfig } from './auth.config';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      householdId: string;
      role: 'admin';
      locale: 'he' | 'en';
    };
  }
}

const credentialsSchema = z.object({
  // Loose check so local-only emails like `you@local` work in dev. The actual
  // email is looked up in the DB; an unknown email fails closed regardless.
  email: z.string().min(3).max(254).includes('@'),
  password: z.string().min(1),
  // Browsers submit empty fields as ''. Treat empty/whitespace as "no TOTP",
  // otherwise require exactly 6 digits.
  totp: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().regex(/^\d{6}$/).optional(),
    )
    .optional(),
});

export const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: '2FA Code', type: 'text' },
      },
      authorize: async (creds) => {
        const parsed = credentialsSchema.safeParse(creds);
        if (!parsed.success) return null;
        const { email, password, totp } = parsed.data;

        const db = getDb();
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email.toLowerCase()))
          .limit(1);

        if (!user) return null;

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) return null;

        if (user.totpEnabled) {
          if (!totp || !user.totpSecretEncrypted) return null;
          const secret = decryptString(user.totpSecretEncrypted);
          if (!authenticator.check(totp, secret)) return null;
        }

        await db
          .update(schema.users)
          .set({ lastLoginAt: new Date() })
          .where(eq(schema.users.id, user.id));

        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? user.email,
          householdId: user.householdId,
          role: user.role,
          locale: user.locale,
        };
      },
    }),
  ],
});
