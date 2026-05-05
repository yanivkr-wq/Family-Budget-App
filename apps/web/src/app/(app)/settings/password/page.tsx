import { auth } from '@/lib/auth';
import { ChangePasswordClient } from './change-password-client';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">שינוי סיסמה</h1>
        <p className="text-sm text-muted-foreground">
          {session?.user?.email}
        </p>
      </header>

      <section className="tile">
        <ChangePasswordClient />
      </section>
    </div>
  );
}
