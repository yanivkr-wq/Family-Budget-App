/**
 * /settings/notifications — per-user contact for notification delivery.
 *
 * Currently captures only the WhatsApp phone (E.164). Email is implicit
 * from the user's account email. The page also surfaces which channels are
 * actually configured at the worker level (presence of SMTP_*, TWILIO_*) so
 * the user knows whether their pick will actually deliver.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { Bell, Info } from 'lucide-react';
import Link from 'next/link';
import { listContacts } from '@/app/(app)/notifications/actions';
import { ContactsClient } from './contacts-client';

export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const db = getDb();

  const [user, contacts] = await Promise.all([
    db
      .select({
        id:        schema.users.id,
        email:     schema.users.email,
        phoneE164: schema.users.phoneE164,
      })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .then((r) => r[0]),
    listContacts(),
  ]);

  // Tell the user which channels are wired up. The actual delivery happens
  // in the worker — these env vars live there. We surface the boolean state
  // so the user knows if a "WhatsApp" toggle on a reminder will actually
  // fire. We only check presence (truthiness), not validity.
  const smtpConfigured     = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const twilioConfigured   = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);

  return (
    <div className="mx-auto max-w-2xl space-y-6" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Bell className="size-5 text-accent" aria-hidden />
          הגדרות התראות
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          פרטי קשר וערוצי שליחה. נהלי את ההתראות עצמן ב{' '}
          <Link href="/notifications" className="text-accent hover:underline">/notifications</Link>.
        </p>
      </header>

      {/* Channel availability strip */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">סטטוס ערוצים</h2>
        <ul className="space-y-1.5 text-sm">
          <ChannelStatus label="באפליקציה (פעמון)" active={true} note="זמין תמיד" />
          <ChannelStatus
            label='דוא"ל'
            active={smtpConfigured}
            note={smtpConfigured ? 'SMTP מוגדר' : 'הוגדר ב-SMTP_HOST/USER/PASS על שרת ה-worker'}
          />
          <ChannelStatus
            label="WhatsApp"
            active={twilioConfigured}
            note={twilioConfigured ? 'Twilio מוגדר' : 'דורש TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM על שרת ה-worker'}
          />
        </ul>
        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Info className="size-3 shrink-0 mt-0.5" aria-hidden />
          ערוצים שלא מוגדרים ידלגו אוטומטית — האירוע יסומן כ&quot;skipped&quot; בלוג ולא תקבלי הודעה.
        </p>
      </section>

      {/* Account email (read-only, for context) */}
      <section className="rounded-lg border bg-card p-4 space-y-1">
        <h2 className="text-sm font-semibold">חשבון משתמש</h2>
        <p className="text-sm text-muted-foreground tabular-nums" dir="ltr">{user?.email}</p>
        <p className="text-2xs text-muted-foreground/80">
          זוהי כתובת ההתחברות. נמעני התראות מנוהלים בנפרד למטה.
        </p>
      </section>

      {/* Notification contacts CRUD */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <header className="space-y-1">
          <h2 className="text-sm font-semibold">אנשי קשר להתראות</h2>
          <p className="text-2xs text-muted-foreground/90">
            הגדירי לאן ולמי לשלוח התראות. ניתן להוסיף נמענים כמו אישה, בעל,
            הורים. בכל תזכורת תוכלי לבחור אילו אנשי קשר יקבלו אותה.
          </p>
          <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
            <Info className="size-3 shrink-0 mt-0.5" aria-hidden />
            <span>
              <strong>WhatsApp:</strong> כל מספר חייב להצטרף ל-Sandbox של Twilio
              עצמאית — לשלוח <code dir="ltr" className="rounded bg-muted px-1">join soap-around</code> ל-
              <code dir="ltr" className="rounded bg-muted px-1">+14155238886</code> מה-WhatsApp שלו.
            </span>
          </p>
        </header>
        <ContactsClient initial={contacts} />
      </section>
    </div>
  );
}

function ChannelStatus({ label, active, note }: { label: string; active: boolean; note: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block size-2 rounded-full ${active ? 'bg-success' : 'bg-muted-foreground/40'}`}
          aria-hidden
        />
        <span className="text-sm">{label}</span>
      </span>
      <span className={`text-2xs ${active ? 'text-success' : 'text-muted-foreground'}`}>{note}</span>
    </li>
  );
}
