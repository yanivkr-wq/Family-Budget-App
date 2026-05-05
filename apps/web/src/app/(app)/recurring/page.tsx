import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { eq, and } from 'drizzle-orm';
import { formatIls } from '@fba/shared';
import { Repeat, TrendingDown, AlertCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

const FREQ_LABEL: Record<string, string> = {
  monthly: 'חודשי',
  bimonthly: 'דו-חודשי',
  quarterly: 'רבעוני',
  yearly: 'שנתי',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  ended: 'הסתיים',
};

export default async function RecurringPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;

  const patterns = await db
    .select({
      id: schema.recurringPatterns.id,
      merchantNormalized: schema.recurringPatterns.merchantNormalized,
      expectedAmountIls: schema.recurringPatterns.expectedAmountIls,
      medianAmountIls: schema.recurringPatterns.medianAmountIls,
      frequency: schema.recurringPatterns.frequency,
      occurrenceCount: schema.recurringPatterns.occurrenceCount,
      firstSeenMonth: schema.recurringPatterns.firstSeenMonth,
      lastSeenMonth: schema.recurringPatterns.lastSeenMonth,
      status: schema.recurringPatterns.status,
      categoryId: schema.recurringPatterns.categoryId,
    })
    .from(schema.recurringPatterns)
    .where(eq(schema.recurringPatterns.householdId, householdId))
    .orderBy(schema.recurringPatterns.expectedAmountIls);

  const cats = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe, color: schema.categories.color })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const active = patterns.filter((p) => p.status === 'active');
  const totalMonthly = active
    .filter((p) => p.frequency === 'monthly')
    .reduce((s, p) => s + Math.abs(Number(p.expectedAmountIls)), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">הוצאות קבועות</h1>
        <p className="text-sm text-muted-foreground">
          תבניות תנועות חוזרות שזוהו אוטומטית
        </p>
      </header>

      {patterns.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Repeat className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">אין תבניות קבועות עדיין</p>
          <p className="mt-1 text-xs text-muted-foreground">
            לאחר 3+ חודשים של תנועות, המערכת תזהה אוטומטית הוצאות חוזרות
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="tile">
              <p className="text-xs text-muted-foreground">הוצאות חוזרות חודשיות</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatIls(totalMonthly, { decimals: false })}
              </p>
            </div>
            <div className="tile">
              <p className="text-xs text-muted-foreground">תבניות פעילות</p>
              <p className="mt-1 text-xl font-semibold">{active.length}</p>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="rounded-lg border bg-card">
            <table className="min-w-full text-sm" dir="rtl">
              <thead className="bg-muted/40 text-right">
                <tr>
                  <th className="border-b px-3 py-2 font-medium">בית עסק</th>
                  <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
                  <th className="border-b px-3 py-2 font-medium">סכום צפוי</th>
                  <th className="border-b px-3 py-2 font-medium">תדירות</th>
                  <th className="border-b px-3 py-2 font-medium">חודש אחרון</th>
                  <th className="border-b px-3 py-2 font-medium">הופעות</th>
                  <th className="border-b px-3 py-2 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p) => {
                  const cat = p.categoryId ? catMap.get(p.categoryId) : null;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{p.merchantNormalized}</td>
                      <td className="px-3 py-2">
                        {cat ? (
                          <span
                            className="pill text-xs"
                            style={{
                              backgroundColor: `${cat.color}25`,
                              color: cat.color ?? undefined,
                            }}
                          >
                            {cat.nameHe}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatIls(Math.abs(Number(p.expectedAmountIls)), { decimals: false })}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {FREQ_LABEL[p.frequency] ?? p.frequency}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.lastSeenMonth}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{p.occurrenceCount}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.status === 'active'
                              ? 'bg-success/10 text-success'
                              : p.status === 'ended'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-warning/10 text-warning'
                          }`}
                        >
                          {STATUS_LABEL[p.status ?? ''] ?? p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-accent">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              זיהוי אוטומטי של הוצאות קבועות יופעל לאחר ייבוא 3 חודשי נתונים. שאל את העוזר ⌘K לניתוח.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
