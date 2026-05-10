import { auth } from '@/lib/auth';
import { getDb, schema, activeBillingMonth, billingCycleRange } from '@fba/db';
import { and, eq, isNull } from 'drizzle-orm';
import { formatIls, formatMonthHe, formatShortDateHe, he } from '@fba/shared';
import { excludeHiddenProjectTxns } from '@/lib/project-filter';
import { readActiveMonth } from '@/lib/active-month';

// Day-by-day × category grid.
// Rows = every date in the billing cycle (cycle-start to cycle-end), not calendar days.
// For a May 2026 billing cycle with cutoff=10: rows are Apr 11 – May 10.

export default async function GridPage(props: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  // Resolution: URL > fba_month cookie > activeBillingMonth(10).
  const month = (await readActiveMonth(sp.month)) ?? activeBillingMonth(10);
  const db = getDb();

  // Compute the actual calendar date range for this billing cycle
  const cycleRange = billingCycleRange(month, 10);

  // Build the list of dates to show as grid rows
  const cycleDates: string[] = [];
  if (cycleRange) {
    // Iterate from cycle start through cycle end
    const startMs = new Date(cycleRange.start + 'T12:00:00').getTime();
    const endMs = new Date(cycleRange.end + 'T12:00:00').getTime();
    let cur = startMs;
    while (cur <= endMs) {
      const d = new Date(cur);
      cycleDates.push(d.toISOString().slice(0, 10));
      cur += 86_400_000; // +1 day
    }
  } else {
    // No cutoff (bank-direct): fall back to calendar days of the billing month
    const [y, mo] = month.split('-').map(Number);
    const days = new Date(y!, mo!, 0).getDate();
    for (let d = 1; d <= days; d++) {
      cycleDates.push(`${month}-${String(d).padStart(2, '0')}`);
    }
  }

  // Both reads are independent → run in parallel instead of serially.
  const [txns, cats] = await Promise.all([
    db
      .select({
        id: schema.transactions.id,
        date: schema.transactions.transactionDate,
        amount: schema.transactions.amountIls,
        categoryId: schema.transactions.categoryId,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.billingMonth, month),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
          // Hide project-tagged txns (multi-year construction etc.) from
          // the day-by-day grid — they live on /projects/[id] only.
          excludeHiddenProjectTxns(),
        ),
      ),
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.householdId, householdId)),
  ]);
  const topCats = cats
    .filter((c) => !c.parentId && !c.isIncome)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Build date → categoryId → sum
  const grid = new Map<string, Map<string, number>>();
  for (const date of cycleDates) grid.set(date, new Map());
  const columnTotals = new Map<string, number>();
  const dateTotals = new Map<string, number>();

  for (const t of txns) {
    if (!t.categoryId) continue;
    const dateKey = t.date; // "2026-04-29"
    const amt = Math.abs(Number(t.amount));
    const dayMap = grid.get(dateKey);
    if (!dayMap) {
      // Transaction date outside cycle (edge case — add it anyway)
      grid.set(dateKey, new Map([[t.categoryId, amt]]));
    } else {
      dayMap.set(t.categoryId, (dayMap.get(t.categoryId) ?? 0) + amt);
    }
    columnTotals.set(t.categoryId, (columnTotals.get(t.categoryId) ?? 0) + amt);
    dateTotals.set(dateKey, (dateTotals.get(dateKey) ?? 0) + amt);
  }

  // Only render rows that have at least one transaction (keeps the table manageable)
  const activeRows = Array.from(grid.entries()).filter(([, map]) => map.size > 0);
  const grandTotal = Array.from(columnTotals.values()).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{he.nav.grid}</h1>
        <p className="text-sm text-muted-foreground">
          {formatMonthHe(month)}
          {cycleRange && (
            <span className="ms-2 text-xs text-muted-foreground/60">
              ({formatShortDateHe(cycleRange.start)} – {formatShortDateHe(cycleRange.end)})
            </span>
          )}
        </p>
      </header>

      {txns.length === 0 ? (
        <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          אין תנועות לחודש זה
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="sticky right-0 z-10 border-b bg-muted/60 px-2 py-2 text-right font-medium">
                  {he.transaction.date}
                </th>
                {topCats.map((c) => (
                  <th key={c.id} className="border-b px-2 py-2 text-center font-medium">
                    <span style={{ color: c.color ?? undefined }}>{c.nameHe}</span>
                  </th>
                ))}
                <th className="border-b px-2 py-2 text-center font-medium">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map(([dateKey, dayMap]) => (
                <tr key={dateKey} className="border-b hover:bg-accent/40">
                  <td className="sticky right-0 z-10 bg-card px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {formatShortDateHe(dateKey)}
                  </td>
                  {topCats.map((c) => {
                    const v = dayMap.get(c.id);
                    return (
                      <td
                        key={c.id}
                        className={`px-2 py-1.5 text-center tabular-nums ${v ? 'text-foreground' : 'text-muted-foreground/25'}`}
                        style={v ? { backgroundColor: `${c.color}15` } : {}}
                      >
                        {v ? formatIls(v, { decimals: false }) : '—'}
                      </td>
                    );
                  })}
                  <td className="bg-muted/30 px-2 py-1.5 text-center font-medium tabular-nums">
                    {dateTotals.get(dateKey)
                      ? formatIls(dateTotals.get(dateKey)!, { decimals: false })
                      : '—'}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-muted/60 font-semibold">
                <td className="sticky right-0 z-10 bg-muted/80 px-2 py-2 text-right">סה״כ</td>
                {topCats.map((c) => (
                  <td key={c.id} className="px-2 py-2 text-center tabular-nums">
                    {columnTotals.get(c.id)
                      ? formatIls(columnTotals.get(c.id)!, { decimals: false })
                      : '—'}
                  </td>
                ))}
                <td className="bg-primary/10 px-2 py-2 text-center tabular-nums">
                  {grandTotal ? formatIls(grandTotal, { decimals: false }) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
