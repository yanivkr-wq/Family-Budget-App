/**
 * /admin/export — One-click Excel exports for backup / external analysis.
 *
 * Server component (no client-side state — all interactivity is plain
 * <a href> downloads pointing at /api/export with query params). The user
 * can pick which sheets to include and (optionally) a date range that
 * applies to the date-bound sheets.
 *
 * Why so many separate buttons: people use Excel exports for very
 * different things — accountant handoff (transactions only), personal
 * review (category summary), subscription audit (recurring only). Forcing
 * a multi-sheet workbook every time would be noise. The "כל הקובץ"
 * button is there for "give me everything" cases.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Download, FileSpreadsheet, Info } from 'lucide-react';
import { ExportControls } from './controls-client';

export const dynamic = 'force-dynamic';

export default async function ExportPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-accent" aria-hidden />
          ייצוא לאקסל
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          הורדת נתונים כקובץ .xlsx — לגיבוי אישי, ניתוח חיצוני, או הגשה לרואה חשבון.
        </p>
      </header>

      <section className="rounded-lg border border-warning/40 bg-warning/5 p-4">
        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Info className="size-3.5 shrink-0 mt-0.5 text-warning" aria-hidden />
          <span>
            <strong>שים לב:</strong> ייצוא Excel מתאים לניתוח ולקריאה — אבל אינו תחליף
            לגיבוי אמיתי. גיבוי מלא (מסד נתונים) צריך להיעשות בנפרד דרך{' '}
            <code className="rounded bg-muted px-1" dir="ltr">pg_dump</code>.
          </span>
        </p>
      </section>

      <ExportControls />
    </div>
  );
}
