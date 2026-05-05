import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getDb, schema, activeBillingMonth, billingCycleRange, addMonths } from '@fba/db';
import { and, desc, eq, isNull, sql, inArray } from 'drizzle-orm';
import { formatIls, formatMonthHe, formatShortDateHe, he } from '@fba/shared';
import { Tile } from '@/components/ui/tile';
import { BudgetProgress } from '@/components/ui/budget-progress';
import { EmptyState } from '@/components/ui/empty-state';
// Recharts (~450 KB) is lazy-loaded via a Client Component wrapper — ssr:false is not
// allowed in Server Components, so the dynamic() call lives in category-donut-lazy.tsx.
import { CategoryDonutLazy as CategoryDonut } from '@/components/ui/category-donut-lazy';
import { DashboardTransactionsSection } from './dashboard-transactions-section';
import type { DashboardTx } from './dashboard-transactions-section';
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  MessageCircle,
  Plus,
  BadgeAlert,
  User as UserIcon,
  Briefcase,
  Users,
  CreditCard,
  Banknote,
  PiggyBank,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type View = 'personal' | 'business' | 'combined';

export default async function DashboardPage(props: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  const view: View = sp.view === 'business' || sp.view === 'combined' ? sp.view : 'personal';
  const db = getDb();

  // ---- Pick default month: most recent past month with actual data ----
  // activeBillingMonth(10) accounts for the cutoff-day: on Apr 15 (day > 10) it
  // returns May 2026 rather than April, matching where today's transactions are billed.
  const cur = activeBillingMonth(10);

  // ── Parallel 1: month detection + account list (no dependency between them) ─
  const [latestMonthRows, allAccounts] = await Promise.all([
    sp.month
      ? Promise.resolve<Array<{ m: string }>>([])
      : db
          .select({ m: sql<string>`max(${schema.transactions.billingMonth})` })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.householdId, householdId),
              isNull(schema.transactions.deletedAt),
              eq(schema.transactions.isProjected, false),
              sql`${schema.transactions.billingMonth} <= ${cur}`,
            ),
          ),
    db
      .select({ id: schema.accounts.id, purpose: schema.accounts.purpose, name: schema.accounts.name })
      .from(schema.accounts)
      .where(eq(schema.accounts.householdId, householdId)),
  ]);
  const month = sp.month ?? latestMonthRows[0]?.m ?? cur;

  let accountFilter: string[] | null = null;
  if (view === 'personal') {
    accountFilter = allAccounts
      .filter((a) => a.purpose === 'personal' || a.purpose === 'shared')
      .map((a) => a.id);
  } else if (view === 'business') {
    accountFilter = allAccounts
      .filter((a) => a.purpose === 'business' || a.purpose === 'shared')
      .map((a) => a.id);
  }

  const noAccountsForView = accountFilter !== null && accountFilter.length === 0;

  const baseConditions = [
    eq(schema.transactions.householdId, householdId),
    eq(schema.transactions.billingMonth, month),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
  ];
  if (view === 'combined') {
    baseConditions.push(eq(schema.transactions.isTransfer, false));
  }
  if (accountFilter && accountFilter.length > 0) {
    baseConditions.push(inArray(schema.transactions.accountId, accountFilter));
  }

  const isCurrentMonth = month === cur;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const day = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const projectedConditions = [
    eq(schema.transactions.householdId, householdId),
    eq(schema.transactions.billingMonth, month),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, true),
  ];
  if (accountFilter && accountFilter.length > 0) {
    projectedConditions.push(inArray(schema.transactions.accountId, accountFilter));
  }

  // ── Parallel 2: all main data in one round-trip (was 7+ sequential awaits) ─
  const DASHBOARD_TX_LIMIT = 20;
  const [
    totals,
    cats,
    activeGoals,
    projectedRows,
    recentTxRaw,
    txCountRows,
    chargedRow,
    pendingRow,
  ] = await Promise.all([
    // (a) spend/income totals by category
    noAccountsForView
      ? Promise.resolve([] as Array<{ total: string; categoryId: string | null }>)
      : db
          .select({
            total: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)`,
            categoryId: schema.transactions.categoryId,
          })
          .from(schema.transactions)
          .where(and(...baseConditions))
          .groupBy(schema.transactions.categoryId),

    // (b) all categories for this household
    db.select().from(schema.categories).where(eq(schema.categories.householdId, householdId)),

    // (c) active saving goals for the dashboard snapshot
    db
      .select({
        id: schema.savingGoals.id,
        name: schema.savingGoals.name,
        icon: schema.savingGoals.icon,
        color: schema.savingGoals.color,
        currentAmountIls: schema.savingGoals.currentAmountIls,
        targetAmountIls: schema.savingGoals.targetAmountIls,
      })
      .from(schema.savingGoals)
      .where(
        and(
          eq(schema.savingGoals.householdId, householdId),
          eq(schema.savingGoals.status, 'active'),
        ),
      )
      .orderBy(schema.savingGoals.priority, schema.savingGoals.createdAt),

    // (d) projected total (installments/recurring not yet posted)
    db
      .select({ total: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)` })
      .from(schema.transactions)
      .where(and(...projectedConditions)),

    // (e) recent transactions for the dashboard strip
    noAccountsForView
      ? Promise.resolve(
          [] as Array<{
            id: string;
            date: string;
            chargeDate: string | null;
            merchant: string;
            amount: string;
            categoryId: string | null;
          }>,
        )
      : db
          .select({
            id: schema.transactions.id,
            date: schema.transactions.transactionDate,
            chargeDate: schema.transactions.chargeDate,
            merchant: schema.transactions.merchantRaw,
            amount: schema.transactions.amountIls,
            categoryId: schema.transactions.categoryId,
          })
          .from(schema.transactions)
          .where(and(...baseConditions))
          .orderBy(desc(schema.transactions.transactionDate))
          .limit(DASHBOARD_TX_LIMIT),

    // (f) total transaction count for the "N more" footer
    noAccountsForView
      ? Promise.resolve([{ n: '0' as string }])
      : db
          .select({ n: sql<string>`count(*)::text` })
          .from(schema.transactions)
          .where(and(...baseConditions)),

    // (g) "already charged" — chargeDate ≤ today OR null (money already left the bank)
    isCurrentMonth && !noAccountsForView
      ? db
          .select({ total: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)` })
          .from(schema.transactions)
          .where(
            and(
              ...baseConditions,
              sql`(${schema.transactions.chargeDate} IS NULL OR ${schema.transactions.chargeDate} <= ${todayStr})`,
            ),
          )
          .then(([r]) => r)
      : Promise.resolve(undefined as { total: string } | undefined),

    // (h) "pending charge" — chargeDate > today (debit still in the future)
    isCurrentMonth && !noAccountsForView
      ? db
          .select({ total: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)` })
          .from(schema.transactions)
          .where(
            and(
              ...baseConditions,
              sql`${schema.transactions.chargeDate} IS NOT NULL AND ${schema.transactions.chargeDate} > ${todayStr}`,
            ),
          )
          .then(([r]) => r)
      : Promise.resolve(undefined as { total: string } | undefined),
  ]);

  // ── Synchronous derivations from the parallel batch results ───────────────
  const catMap = new Map(cats.map((c) => [c.id, c]));

  let totalIncome = 0;
  let totalSpent = 0;
  for (const t of totals) {
    const cat = t.categoryId ? catMap.get(t.categoryId) : null;
    const v = Number(t.total);
    if (cat?.isIncome) totalIncome += v;
    else totalSpent += v;
  }

  const balance = totalIncome + totalSpent;
  const spent = Math.abs(totalSpent);

  const cycleRange = billingCycleRange(month, 10);
  const daysLeft = isCurrentMonth ? Math.max(0, daysInMonth - day) : 0;
  // Naive projection only kicks in when there's enough data to be meaningful.
  // Otherwise we'd take a single ₪500 transaction on day 2 and "predict" -₪7K by month-end,
  // which is statistically nonsense and misleads the user.
  const transactionCount = totals.length;
  const hasEnoughDataForProjection = isCurrentMonth && day >= 5 && transactionCount >= 3;
  const dailyAvg = hasEnoughDataForProjection ? spent / day : 0;
  const projectedEom = hasEnoughDataForProjection
    ? totalIncome - (spent + dailyAvg * daysLeft)
    : balance;

  const projectedThisMonth = Math.abs(Number(projectedRows[0]?.total ?? 0));

  const savingsTotalCurrent = activeGoals.reduce((s, g) => s + Number(g.currentAmountIls), 0);
  const savingsTotalTarget = activeGoals.reduce(
    (s, g) => s + (g.targetAmountIls !== null ? Number(g.targetAmountIls) : 0),
    0,
  );

  const alreadyChargedIls = Number(chargedRow?.total ?? 0);
  const pendingChargedIls = Number(pendingRow?.total ?? 0);

  const dashboardTxns: DashboardTx[] = recentTxRaw.map((t) => {
    const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
    return {
      id: t.id,
      date: t.date,
      chargeDate: t.chargeDate,
      merchant: t.merchant,
      amount: t.amount,
      categoryName: cat?.nameHe ?? null,
      categoryColor: cat?.color ?? null,
    };
  });

  const totalTxCount = Number(txCountRows[0]?.n ?? 0);

  const expenseCats = cats
    .filter((c) => !c.parentId && !c.isIncome && !c.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const totalsByCat = new Map<string, number>();
  for (const t of totals) {
    if (!t.categoryId) continue;
    totalsByCat.set(t.categoryId, Number(t.total));
  }
  const budgetRows = expenseCats
    .map((c) => ({
      cat: c,
      actual: Math.abs(totalsByCat.get(c.id) ?? 0),
      target: c.monthlyTargetIls ? Number(c.monthlyTargetIls) : null,
    }))
    .sort((a, b) => b.actual - a.actual);

  const donutData = budgetRows
    .filter((r) => r.actual > 0)
    .map((r) => ({
      name: r.cat.nameHe,
      value: r.actual,
      color: r.cat.color ?? 'hsl(215 65% 35%)',
    }));

  const hasData = totals.length > 0;

  const monthOptions: string[] = [];
  for (let i = -12; i <= 12; i++) monthOptions.push(addMonths(cur, i));
  if (!monthOptions.includes(month)) monthOptions.unshift(month);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{he.nav.dashboard}</h1>
          <p className="text-sm text-muted-foreground">
            {formatMonthHe(month)}
            {cycleRange && (
              <span className="ms-2 text-xs text-muted-foreground/60">
                ({formatShortDateHe(cycleRange.start)} – {formatShortDateHe(cycleRange.end)})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewTabs current={view} month={month} />
          <form action="/" method="get">
            <input type="hidden" name="view" value={view} />
            <select
              name="month"
              defaultValue={month}
              className="h-10 rounded-md border bg-card px-3 text-sm shadow-sm"
            >
              {monthOptions
                .sort((a, b) => b.localeCompare(a))
                .map((m) => (
                  <option key={m} value={m}>
                    {formatMonthHe(m)}
                  </option>
                ))}
            </select>
            <noscript>
              <button type="submit" className="btn-secondary ms-2">
                {he.common.apply}
              </button>
            </noscript>
            <script
              dangerouslySetInnerHTML={{
                __html: `document.currentScript.previousElementSibling.previousElementSibling.addEventListener('change', e => e.target.form.submit());`,
              }}
            />
          </form>
          <Link href="/transactions" className="btn-primary">
            <Plus className="size-4" />
            {he.transaction.addManual}
          </Link>
        </div>
      </header>

      {noAccountsForView && (
        <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          לא סומנו חשבונות{' '}
          <strong>{view === 'business' ? 'עסקיים' : 'אישיים'}</strong>. כדי שתצוגה זו תציג נתונים, פתח{' '}
          <Link href="/admin/accounts" className="underline">
            חשבונות
          </Link>{' '}
          וסמן את החשבונות המתאימים.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label={he.dashboard.spentSoFar}
          value={formatIls(spent, { decimals: false })}
          caption={isCurrentMonth ? `יום ${day} מתוך ${daysInMonth}` : undefined}
          icon={<TrendingDown className="size-3.5" />}
        />
        <Tile
          label="הכנסות"
          value={formatIls(totalIncome, { decimals: false })}
          tone={totalIncome > 0 ? 'success' : 'neutral'}
          icon={<TrendingUp className="size-3.5" />}
        />
        <Tile
          label={he.dashboard.monthBalance}
          value={formatIls(balance, { decimals: false })}
          tone={balance >= 0 ? 'success' : 'destructive'}
          icon={<Wallet className="size-3.5" />}
        />
        <Tile
          label={
            isCurrentMonth
              ? hasEnoughDataForProjection
                ? he.dashboard.predictedEom
                : 'מאזן עד עכשיו'
              : 'מתוכננים נוספים'
          }
          value={
            isCurrentMonth
              ? formatIls(projectedEom, { decimals: false })
              : formatIls(projectedThisMonth, { decimals: false })
          }
          tone={isCurrentMonth ? (projectedEom >= 0 ? 'success' : 'warning') : 'accent'}
          caption={
            isCurrentMonth
              ? hasEnoughDataForProjection
                ? `${daysLeft} ימים נותרו · מבוסס על ${transactionCount} תנועות`
                : `צריך ≥ 5 ימים ו-3 תנועות לתחזית`
              : projectedThisMonth > 0
                ? 'תקציב צפוי לחודש'
                : undefined
          }
        />
      </section>

      {/* ── C2: charge-date cash-flow bar ── */}
      {isCurrentMonth && (alreadyChargedIls !== 0 || pendingChargedIls !== 0) && (
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-2.5 text-sm"
          dir="rtl"
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Banknote className="size-3.5 shrink-0 text-success" />
            <span>כבר חויב:</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatIls(Math.abs(alreadyChargedIls), { decimals: false })}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CreditCard className="size-3.5 shrink-0 text-warning" />
            <span>עוד יחויב:</span>
            <span className="font-semibold tabular-nums text-warning">
              {formatIls(Math.abs(pendingChargedIls), { decimals: false })}
            </span>
          </span>
          <span className="ms-auto text-2xs text-muted-foreground/60">
            לפי תאריכי חיוב
          </span>
        </div>
      )}

      {/* ── Savings snapshot ── */}
      {activeGoals.length > 0 && (
        <section className="tile space-y-4">
          {/* header */}
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <PiggyBank className="size-4 text-emerald-600" />
              חיסכון ויעדים
            </h2>
            <Link href="/savings" className="text-xs text-primary hover:underline">
              לכל היעדים ←
            </Link>
          </div>

          {/* per-goal progress bars */}
          <div className="space-y-3.5">
            {activeGoals.map((g) => {
              const current = Number(g.currentAmountIls);
              const target = g.targetAmountIls !== null ? Number(g.targetAmountIls) : null;
              const pct = target && target > 0 ? Math.min(100, Math.round((current / target) * 100)) : null;
              const barColor = g.color ?? '#10b981';
              return (
                <div key={g.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {g.icon && <span className="text-base leading-none">{g.icon}</span>}
                      <span>{g.name}</span>
                    </div>
                    <div className="text-sm tabular-nums">
                      <span className="font-semibold">
                        {formatIls(current, { decimals: false })}
                      </span>
                      {target !== null && (
                        <span className="text-muted-foreground">
                          {' / '}{formatIls(target, { decimals: false })}
                        </span>
                      )}
                      {pct !== null && (
                        <span className="ms-1.5 text-xs text-muted-foreground">({pct}%)</span>
                      )}
                    </div>
                  </div>
                  {target !== null && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct ?? 0}%`, backgroundColor: barColor }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* total summary footer */}
          {savingsTotalTarget > 0 && (
            <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
              <span>סה״כ</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatIls(savingsTotalCurrent, { decimals: false })}
                {' / '}
                {formatIls(savingsTotalTarget, { decimals: false })}
              </span>
            </div>
          )}
        </section>
      )}

      {!hasData ? (
        <EmptyState
          icon={<BadgeAlert className="size-8" />}
          title={isCurrentMonth ? 'אין תנועות בפועל לחודש זה עדיין' : 'אין נתונים לחודש זה'}
          description={
            isCurrentMonth
              ? `${projectedThisMonth > 0 ? `יש ${formatIls(projectedThisMonth)} בהוצאות צפויות (קבועות) לחודש. ` : ''}הוסף תנועה ידנית או בחר חודש אחר מהבורר למעלה.`
              : 'הוסף תנועה ידנית, בחר חודש אחר, או ייבא את האקסל הקיים שלך.'
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/transactions" className="btn-primary">
                <Plus className="size-4" />
                {he.transaction.addManual}
              </Link>
              <Link href="/import" className="btn-secondary">
                ייבוא מאקסל
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="tile lg:col-span-1">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {he.dashboard.perCategory}
              </h2>
              <CategoryDonut data={donutData} centerValue={spent} centerLabel="הוצא" />
              <div className="mt-3 flex items-center gap-2 rounded-md border bg-accent-soft/50 p-2.5 text-xs text-accent">
                <MessageCircle className="size-3.5 shrink-0" />
                <span>שאל את העוזר ⌘K לתובנות מעמיקות</span>
              </div>
            </section>

            <section className="tile lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                הוצאות לפי קטגוריה
              </h2>
              <div className="space-y-3.5">
                {(() => {
                  // For categories without a target we fall back to a relative bar
                  // (proportion of the biggest spender = 100%).
                  const maxActual = Math.max(...budgetRows.map((r) => r.actual), 1);
                  return budgetRows.map(({ cat, actual, target }) => {
                    const hasTarget = target !== null && target > 0;
                    // vs-target % when target exists, relative % otherwise
                    const pct = hasTarget
                      ? Math.min(100, Math.round((actual / target!) * 100))
                      : Math.round((actual / maxActual) * 100);
                    const barColor = cat.color ?? 'hsl(215 65% 35%)';
                    const overBudget = hasTarget && pct >= 100;
                    const nearBudget = hasTarget && pct >= 80 && pct < 100;
                    const finalBarColor = overBudget
                      ? 'var(--destructive)'
                      : nearBudget
                        ? 'var(--warning)'
                        : barColor;
                    return (
                      <div key={cat.id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: barColor }}
                            />
                            <span>{cat.nameHe}</span>
                          </div>
                          <div className="text-sm tabular-nums">
                            <span className={cn('font-semibold', overBudget && 'text-destructive')}>
                              {formatIls(actual, { decimals: false })}
                            </span>
                            {hasTarget && (
                              <span className="text-muted-foreground">
                                {' / '}{formatIls(target!, { decimals: false })}
                              </span>
                            )}
                            {hasTarget && (
                              <span className={cn(
                                'ms-1.5 text-xs',
                                overBudget ? 'text-destructive' : nearBudget ? 'text-warning' : 'text-muted-foreground',
                              )}>
                                ({pct}%)
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Bar always visible — vs-target when set, relative otherwise */}
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: finalBarColor }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          </div>

          {/* ── Transactions strip ── */}
          <DashboardTransactionsSection
            transactions={dashboardTxns}
            month={month}
            totalCount={totalTxCount}
          />
        </>
      )}
    </div>
  );
}

const VIEW_OPTIONS: Array<{ value: View; label: string; icon: typeof UserIcon; helpText: string }> =
  [
    { value: 'personal', label: 'אישי', icon: UserIcon, helpText: 'חשבונות פרטיים בלבד' },
    { value: 'business', label: 'עסקי', icon: Briefcase, helpText: 'חשבונות עסקיים בלבד' },
    { value: 'combined', label: 'משולב', icon: Users, helpText: 'הכל, ללא ספירה כפולה של העברות' },
  ];

function ViewTabs({ current, month }: { current: View; month: string }) {
  return (
    <div
      role="tablist"
      aria-label="View"
      className="inline-flex items-center rounded-md border bg-card p-0.5 shadow-sm"
    >
      {VIEW_OPTIONS.map((opt) => {
        const isActive = current === opt.value;
        const Icon = opt.icon;
        return (
          <Link
            key={opt.value}
            href={`/?view=${opt.value}&month=${month}`}
            role="tab"
            aria-selected={isActive}
            title={opt.helpText}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
