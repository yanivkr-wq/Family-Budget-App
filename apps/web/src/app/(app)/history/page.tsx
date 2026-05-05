import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema, addMonths, currentBillingMonth } from '@fba/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { formatIls, formatMonthHe } from '@fba/shared';
import Link from 'next/link';
import { TrendingDown, TrendingUp, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;
  const cur = currentBillingMonth();

  // Build last 13 months (including current)
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) months.push(addMonths(cur, -i));

  // Aggregate totals per billing month
  const rows = await db
    .select({
      billingMonth: schema.transactions.billingMonth,
      total: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)`,
      catIsIncome: schema.categories.isIncome,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, false),
      ),
    )
    .groupBy(schema.transactions.billingMonth, schema.categories.isIncome);

  // Pivot into monthly summaries
  const summary = new Map<string, { income: number; spent: number }>();
  for (const r of rows) {
    if (!summary.has(r.billingMonth)) summary.set(r.billingMonth, { income: 0, spent: 0 });
    const s = summary.get(r.billingMonth)!;
    if (r.catIsIncome) s.income += Number(r.total);
    else s.spent += Number(r.total); // negative
  }

  const dataMonths = months
    .map((m) => ({
      month: m,
      isCurrent: m === cur,
      ...(summary.get(m) ?? { income: 0, spent: 0 }),
    }))
    .filter((m) => m.income !== 0 || m.spent !== 0 || m.isCurrent)
    .reverse(); // newest first

  const maxAbs = Math.max(...dataMonths.map((m) => Math.abs(m.spent)));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">היסטוריה</h1>
        <p className="text-sm text-muted-foreground">12 חודשים אחרונים</p>
      </header>

      {dataMonths.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Calendar className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">אין נתונים היסטוריים עדיין</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dataMonths.map((m) => {
            const balance = m.income + m.spent;
            const spentAbs = Math.abs(m.spent);
            const barPct = maxAbs > 0 ? (spentAbs / maxAbs) * 100 : 0;

            return (
              <Link
                key={m.month}
                href={`/?month=${m.month}`}
                className={cn(
                  'block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30',
                  m.isCurrent && 'border-primary/40 bg-primary-soft/10',
                )}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <span className="text-sm font-medium">
                      {formatMonthHe(m.month)}
                      {m.isCurrent && (
                        <span className="ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                          נוכחי
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm tabular-nums">
                    {m.income > 0 && (
                      <span className="flex items-center gap-1 text-success">
                        <TrendingUp className="size-3.5" />
                        {formatIls(m.income, { decimals: false })}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-foreground">
                      <TrendingDown className="size-3.5" />
                      {formatIls(spentAbs, { decimals: false })}
                    </span>
                    <span
                      className={cn(
                        'font-semibold',
                        balance >= 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {formatIls(balance, { decimals: false })}
                    </span>
                  </div>
                </div>
                {/* Expense bar */}
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
