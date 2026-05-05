import { signIn } from '@/lib/auth';
import { he } from '@fba/shared';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuthError } from 'next-auth';

export default async function SignInPage(props: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');

  const sp = await props.searchParams;
  const error = sp.error;
  const callbackUrl = sp.callbackUrl ?? '/';

  async function action(formData: FormData) {
    'use server';
    const email = formData.get('email');
    const password = formData.get('password');
    const totp = formData.get('totp');
    try {
      await signIn('credentials', {
        email,
        password,
        totp,
        redirectTo: callbackUrl,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        // CredentialsSignin → wrong email/password (or TOTP). Send back to
        // /sign-in with an error flag instead of crashing the page.
        redirect(`/sign-in?error=${encodeURIComponent(err.type)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      throw err; // re-throw NEXT_REDIRECT and other framework errors
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">{he.app.name}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{he.auth.signIn}</p>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              {he.auth.email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              {he.auth.password}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="totp" className="text-sm font-medium">
              {he.auth.totpCode}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                — אופציונלי, רק אם הפעלת אימות דו-שלבי
              </span>
            </label>
            <input
              id="totp"
              name="totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="השאר/י ריק אם אין"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {he.auth.invalidCredentials}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {he.auth.signIn}
          </button>
        </form>

        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            שכחתי סיסמה
          </summary>
          <div className="mt-2 space-y-2 rounded-md border bg-subtle/50 p-3 text-muted-foreground">
            <p>
              האפליקציה הזו רצה אצלך — אין שירות מייל מוגדר, ולכן אין שחזור סיסמה דרך הדפדפן (לעת עתה).
              במקום זה, את/ה יכול/ה לאפס את הסיסמה מהטרמינל בפקודה אחת:
            </p>
            <pre dir="ltr" className="rounded bg-card p-2 font-mono text-2xs">
              cd "C:\Users\yanivkr\OneDrive - Matrix IT Ltd\Desktop\Claude Cowork\Family Budget App"{'\n'}
              pnpm reset-password -- --email=yaniv@local --random
            </pre>
            <p>
              הפקודה תיצור סיסמה חדשה, תעדכן את ה-DB, ותשמור את הסיסמה ב-
              <code className="rounded bg-muted px-1">{'%USERPROFILE%\\Documents\\budget-app-temp-credentials.txt'}</code>.
              אחרי הכניסה, תוכל/י לעדכן סיסמה קבועה ב-{' '}
              <a href="/settings/password" className="underline">
                הגדרות סיסמה
              </a>
              .
            </p>
            <p className="text-2xs">
              ⚙️ בעתיד: כשנגדיר SMTP ב-.env, נוסיף שחזור דרך מייל אמיתי.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}
