import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, desc, eq } from 'drizzle-orm';
import { revertImportSession, restoreImportSession } from './actions';
import {
  FileSpreadsheet,
  Undo2,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  baseline: 'תבנית בייסליין',
  raw_bank: 'בנק/אשראי גולמי',
  csv: 'CSV',
  legacy: 'אקסל היסטורי',
  manual: 'ידני',
};

async function revertAction(formData: FormData) {
  'use server';
  await revertImportSession(formData);
}

async function restoreAction(formData: FormData) {
  'use server';
  await restoreImportSession(formData);
}

export default async function ImportSessionsPage(props: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  const filterMonth = sp.month;
  const db = getDb();

  const conditions = [eq(schema.importSessions.householdId, householdId)];

  const sessions = await db
    .select()
    .from(schema.importSessions)
    .where(and(...conditions))
    .orderBy(desc(schema.importSessions.committedAt))
    .limit(200);

  // Optional month filter — match if any of the import's billing_months matches
  const filtered = filterMonth
    ? sessions.filter((s) => {
        const months = (s.billingMonths as string[] | null) ?? [];
        return months.includes(filterMonth);
      })
    : sessions;

  // Distinct months across all sessions for filter dropdown
  const monthsAcrossAll = new Set<string>();
  for (const s of sessions) {
    for (const m of ((s.billingMonths as string[] | null) ?? [])) monthsAcrossAll.add(m);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">היסטוריית ייבוא קבצים</h1>
          <p className="text-sm text-muted-foreground">
            רשימה של כל הקבצים שיובאו. אפשר לבטל ייבוא כדי לעשות "Undo" אם הועלה הקובץ הלא נכון.
          </p>
        </div>
        <form action="/admin/imports" method="get">
          <select
            name="month"
            defaultValue={filterMonth ?? ''}
            className="h-10 rounded-md border bg-card px-3 text-sm shadow-sm"
          >
            <option value="">כל החודשים</option>
            {Array.from(monthsAcrossAll)
              .sort()
              .reverse()
              .map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </select>
          <noscript>
            <button type="submit" className="btn-secondary ms-2">
              סנן
            </button>
          </noscript>
          <script
            dangerouslySetInnerHTML={{
              __html: `document.currentScript.previousElementSibling.previousElementSibling.addEventListener('change', e => e.target.form.submit());`,
            }}
          />
        </form>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed bg-subtle p-8 text-center text-sm text-muted-foreground">
          אין ייבואים{filterMonth ? ` לחודש ${filterMonth}` : ''}.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const months = ((s.billingMonths as string[] | null) ?? []).sort();
            const isReverted = s.status === 'reverted';
            const isFailed = s.status === 'failed';
            return (
              <div
                key={s.id}
                className={`rounded-lg border bg-card p-4 transition-colors ${
                  isReverted ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="size-4 text-muted-foreground" />
                      <span className="font-medium">{s.filename}</span>
                      {isReverted && (
                        <span className="pill bg-destructive-soft text-destructive">
                          <XCircle className="me-1 size-3" />
                          בוטל
                        </span>
                      )}
                      {isFailed && (
                        <span className="pill bg-warning-soft text-warning">
                          <AlertTriangle className="me-1 size-3" />
                          נכשל
                        </span>
                      )}
                      {!isReverted && !isFailed && (
                        <span className="pill bg-success-soft text-success">
                          <CheckCircle2 className="me-1 size-3" />
                          תקין
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[s.sourceType] ?? s.sourceType}
                      {s.templateUsed ? ` · ${s.templateUsed}` : ''} ·{' '}
                      {new Date(s.committedAt).toLocaleString('he-IL')}
                    </div>
                    {months.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        חודשים מושפעים: {months.join(', ')}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      <span className="text-success">+{s.insertedCount} נוספו</span>
                      {s.duplicateCount > 0 && (
                        <span className="text-muted-foreground">{s.duplicateCount} כפילויות</span>
                      )}
                      {s.errorCount > 0 && (
                        <span className="text-warning">{s.errorCount} שגיאות</span>
                      )}
                    </div>
                  </div>
                  <div>
                    {isReverted ? (
                      <form action={restoreAction}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button type="submit" className="btn-secondary text-xs">
                          <RotateCcw className="size-3.5" />
                          שחזר
                        </button>
                      </form>
                    ) : (
                      <form action={revertAction}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button
                          type="submit"
                          className="btn-destructive text-xs"
                          title="יבטל את כל התנועות שיובאו על ידי הקובץ הזה"
                        >
                          <Undo2 className="size-3.5" />
                          בטל ייבוא
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section className="tile space-y-2 border-accent/40 bg-accent-soft/40 text-sm">
        <p className="font-medium text-accent">איך זה עובד</p>
        <ul className="ms-5 list-disc space-y-1 text-muted-foreground">
          <li>
            כל קובץ שמועלה נרשם כאן עם תאריך, סוג מקור, וכמה תנועות נוספו.
          </li>
          <li>
            <strong>ביטול ייבוא</strong> מסמן את כל התנועות שנוצרו על ידי אותו קובץ כמחוקות (Soft delete).
            הנתונים לא נעלמים — אפשר לשחזר.
          </li>
          <li>
            <strong>שחזור</strong> מחזיר את התנועות מהביטול.
          </li>
          <li>
            <strong>זיהוי כפולים אוטומטי</strong> — אם תעלה את אותו קובץ פעמיים (לפי גיבוב SHA-256), נזהה ונזהיר לפני השכפול.
          </li>
        </ul>
      </section>
    </div>
  );
}
