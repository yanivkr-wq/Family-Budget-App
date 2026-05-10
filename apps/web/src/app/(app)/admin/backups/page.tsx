/**
 * /admin/backups — manual backup trigger + recent backup history + restore docs.
 *
 * Server component. Fetches the list from the worker (which talks to B2)
 * and renders the table. The "Run backup now" button is a client island.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Database, AlertTriangle, FileArchive, Info } from 'lucide-react';
import Link from 'next/link';
import { getRecentBackups } from './actions';
import { BackupRunButton } from './run-button-client';

export const dynamic = 'force-dynamic';

export default async function AdminBackupsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const items = await getRecentBackups();
  const configured = process.env.B2_ENDPOINT && process.env.B2_BUCKET && process.env.B2_KEY_ID && process.env.B2_APP_KEY;

  return (
    <div className="space-y-6" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Database className="size-5 text-accent" aria-hidden />
          גיבויי מסד נתונים
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          גיבוי יומי אוטומטי של ה-Postgres ל-Backblaze B2. מקור האמת לשחזור
          נתונים אם הדיסק נכשל או הקובץ המקומי נפגע.
        </p>
      </header>

      {/* Status strip — flex justify-between in an RTL parent puts the
          first child at the start (right) and the last at the end (left).
          So the Hebrew label is on the right, the status value on the left.
          That's the natural RTL "label : value" layout. */}
      <section dir="rtl" className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold mb-2">סטטוס שירות גיבוי</h2>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-baseline justify-between gap-3">
            <span>אינטגרציית Backblaze B2</span>
            <span className={`text-2xs ${configured ? 'text-success' : 'text-destructive'}`}>
              {configured ? '✓ מוגדר' : '⚠ לא מוגדר'}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span>גיבוי יומי אוטומטי (cron)</span>
            <span className="text-2xs text-muted-foreground tabular-nums" dir="ltr">
              03:00 שעון מקומי
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span>שמירת היסטוריה</span>
            <span className="text-2xs text-muted-foreground tabular-nums">
              30 ימים
            </span>
          </li>
        </ul>
        {!configured && (
          <p className="mt-3 flex items-start gap-1.5 text-2xs text-warning">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
            השלם הגדרת B2 (ראה הוראות למטה) — בלי זה הגיבוי לא ירוץ.
          </p>
        )}
      </section>

      {/* Trigger + history */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">היסטוריית גיבויים</h2>
          <BackupRunButton />
        </div>

        {items.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            {configured
              ? 'אין גיבויים עדיין. לחץ "גבה עכשיו" כדי ליצור את הראשון.'
              : 'אין גיבויים — השירות לא מוגדר.'}
          </p>
        ) : (
          // Table renders RTL — first <th> sits on the visual right.
          // Headers use text-start (right-aligned in RTL) so they line up
          // with the column data below them. Size + date cells set
          // dir="ltr" on the inner <span> so the LTR numeric content reads
          // correctly without changing cell-level alignment.
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="border-b">
              <tr>
                <th className="px-3 py-2 font-medium text-2xs uppercase tracking-wide text-muted-foreground text-start">קובץ</th>
                <th className="px-3 py-2 font-medium text-2xs uppercase tracking-wide text-muted-foreground text-start">גודל</th>
                <th className="px-3 py-2 font-medium text-2xs uppercase tracking-wide text-muted-foreground text-start">תאריך</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.filename} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 text-start">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <FileArchive className="size-3.5 text-muted-foreground" aria-hidden />
                      <code className="text-2xs" dir="ltr">{b.filename}</code>
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-2xs text-muted-foreground text-start">
                    <span dir="ltr">{formatSize(b.size)}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-2xs text-muted-foreground text-start">
                    <span dir="ltr">{new Date(b.uploaded).toLocaleString('he-IL')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Restore + setup docs.
          ps-6 = padding on the START side (right in RTL) — keeps the list
          markers visible inside the bordered card. The ol gets dir="rtl"
          explicitly because list rendering doesn't always inherit through
          flex/grid wrappers reliably across browsers. <pre> blocks containing
          shell commands stay LTR — the inline dir="ltr" + text-start
          (right-align in RTL — but `text-start` in an LTR pre = left, which
          is what we want for code) keeps them readable. */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Info className="size-4 text-accent" aria-hidden />
          איך לשחזר מגיבוי
        </h2>
        <ol dir="rtl" className="space-y-2 ps-6 text-sm list-decimal marker:text-muted-foreground">
          <li>
            התחבר לחשבון Backblaze, פתח את הדלי{' '}
            <code className="rounded bg-muted px-1 text-2xs" dir="ltr">{process.env.B2_BUCKET ?? 'family-budget-backups'}</code>{' '}
            ובחר את הקובץ הרצוי (למשל{' '}
            <code className="rounded bg-muted px-1 text-2xs" dir="ltr">budget_2026-05-09_0300.sql.gz</code>).
          </li>
          <li>
            לחץ &quot;Download&quot; — תקבל קובץ{' '}
            <code className="rounded bg-muted px-1 text-2xs" dir="ltr">.sql.gz</code>.
          </li>
          <li>
            פתח את הקובץ עם{' '}
            <code className="rounded bg-muted px-1 text-2xs" dir="ltr">gunzip budget_*.sql.gz</code>{' '}
            (או 7-Zip ב-Windows).
          </li>
          <li>
            ב-Postgres חדש (או אחרי שמחקת את הקיים): טען את הקובץ:
            <pre dir="ltr" className="mt-1.5 rounded-md bg-muted px-3 py-2 text-2xs overflow-x-auto text-left">{`docker exec -i budget-pg psql -U budget -d budget < budget_2026-05-09_0300.sql`}</pre>
          </li>
          <li>
            הקובץ מכיל{' '}
            <code className="rounded bg-muted px-1 text-2xs" dir="ltr">DROP TABLE ... IF EXISTS</code>{' '}
            לפני כל יצירה, אז ניתן לטעון אותו על מסד נתונים קיים — הוא ידרוס.
          </li>
        </ol>
        <p className="text-2xs text-muted-foreground border-t pt-2">
          <strong>רגע מה לעשות אם נשבר?</strong> פתח את{' '}
          <Link href="/admin/backups" className="text-accent hover:underline">דף זה</Link>,
          הורד את הגיבוי האחרון מ-B2, ופעל לפי השלבים למעלה.
          הזמן הצפוי לשחזור: 5-15 דקות.
        </p>
      </section>

      {!configured && (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold">הגדרת Backblaze B2 — הוראות</h2>
          <ol dir="rtl" className="space-y-2 ps-6 text-sm list-decimal marker:text-muted-foreground">
            <li>הירשם בחינם ב-<a href="https://www.backblaze.com/sign-up/cloud-storage" className="text-accent hover:underline" target="_blank" rel="noreferrer">backblaze.com</a> (10 GB חינם).</li>
            <li>צור Bucket פרטי, סמן &quot;Encrypt files&quot;, שמור את שם ה-Bucket וה-Endpoint.</li>
            <li>צור Application Key מסוג Read+Write על אותו Bucket. שמור keyID + applicationKey.</li>
            <li>
              הוסף ל-<code className="rounded bg-muted px-1 text-2xs" dir="ltr">apps/worker/.env</code>:
              <pre dir="ltr" className="mt-1.5 rounded-md bg-muted px-3 py-2 text-2xs overflow-x-auto text-left">{`B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
B2_BUCKET=your-bucket-name
B2_KEY_ID=0035a1...
B2_APP_KEY=K003abc...`}</pre>
            </li>
            <li>
              הפעל מחדש את ה-worker:{' '}
              <code className="rounded bg-muted px-1 text-2xs" dir="ltr">pnpm -F @fba/worker dev</code>
            </li>
            <li>חזור לדף זה ולחץ &quot;גבה עכשיו&quot; כדי לאמת.</li>
          </ol>
        </section>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
