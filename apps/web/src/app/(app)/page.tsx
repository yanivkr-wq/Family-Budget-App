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
import { InsightDetailsToggle } from './dashboard-insight-details';
import { InsightsCatalogToggle } from './dashboard-insights-catalog';
import { GoalIcon } from '@/components/ui/goal-icon';
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
  Sparkles,
  ChevronLeft,
  AlertOctagon,
  AlertTriangle,
  PartyPopper,
  Info,
  type LucideIcon,
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

  // ── Parallel 3: insights-only queries (non-blocking for main render) ───────
  const prevMonth = addMonths(month, -1);
  const [prevTotals, endingPlans, activeInstallmentPlans] = await Promise.all([
    // (i) last month category totals — for MoM comparison
    db
      .select({
        total:      sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)`,
        categoryId: schema.transactions.categoryId,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.billingMonth, prevMonth),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isProjected, false),
        ),
      )
      .groupBy(schema.transactions.categoryId),

    // (j) active installment plans ending this month or next month
    db
      .select({
        id:                schema.installmentPlans.id,
        merchantNormalized:schema.installmentPlans.merchantNormalized,
        description:       schema.installmentPlans.description,
        paymentAmountIls:  schema.installmentPlans.paymentAmountIls,
        totalPayments:     schema.installmentPlans.totalPayments,
        currentPaymentNo:  schema.installmentPlans.currentPaymentNo,
        projectedEndMonth: schema.installmentPlans.projectedEndMonth,
      })
      .from(schema.installmentPlans)
      .where(
        and(
          eq(schema.installmentPlans.householdId, householdId),
          eq(schema.installmentPlans.status, 'active'),
        ),
      ),

    // (k) all active installment plans (for "not in transactions" warning)
    db
      .select({
        id:               schema.installmentPlans.id,
        merchantNormalized:schema.installmentPlans.merchantNormalized,
        description:      schema.installmentPlans.description,
        paymentAmountIls: schema.installmentPlans.paymentAmountIls,
        startMonth:       schema.installmentPlans.startMonth,
        currentPaymentNo: schema.installmentPlans.currentPaymentNo,
        totalPayments:    schema.installmentPlans.totalPayments,
        // count of transactions linked to this plan for the current billing month
        linkedThisMonth:  sql<string>`(
          SELECT count(*) FROM ${schema.transactions} t
          WHERE t.installment_plan_id = ${schema.installmentPlans.id}
            AND t.billing_month = ${month}
            AND t.deleted_at IS NULL
        )`,
      })
      .from(schema.installmentPlans)
      .where(
        and(
          eq(schema.installmentPlans.householdId, householdId),
          eq(schema.installmentPlans.status, 'active'),
        ),
      ),
  ]);

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
    // Hide zero-spend categories — but keep those with a budget target set
    // (those are actively monitored, e.g. savings/envelope categories the user
    // wants to see even when nothing was spent yet this month)
    .filter(({ actual, target }) => actual > 0 || target !== null)
    .sort((a, b) => b.actual - a.actual);

  // ── Compute insights (after budgetRows + prevTotals are both ready) ────────
  const insights = computeInsights({
    budgetRows,
    prevTotals,
    endingPlans,
    activeInstallmentPlans,
    projectedEom,
    hasEnoughDataForProjection,
    totalIncome,
    isCurrentMonth,
    day,
    daysInMonth,
    daysLeft,
    month,
    spent,
  });

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

      {/* ── AI Insights widget ── */}
      <InsightsWidget insights={insights} month={month} />

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
                      <GoalIcon
                        name={g.icon}
                        className="size-3.5 shrink-0"
                        style={g.color ? { color: g.color } : undefined}
                      />
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

// ─────────────────────────────────────────────────────────────────────────────
// Insights
// ─────────────────────────────────────────────────────────────────────────────

type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

interface Insight {
  id: string;
  severity: InsightSeverity;
  icon: LucideIcon;
  title: string;
  body: string;
  /** Plain-language calculation/reasoning shown when the user clicks the
   *  "info" button on the row. Multi-line via \n. */
  explanation?: string;
  href?: string;
}

type BudgetRow = { cat: { id: string; nameHe: string; color: string | null }; actual: number; target: number | null };

function computeInsights(args: {
  budgetRows:               BudgetRow[];
  prevTotals:               Array<{ total: string; categoryId: string | null }>;
  endingPlans:              Array<{ id: string; merchantNormalized: string; description: string | null; paymentAmountIls: string | number; totalPayments: number | null; currentPaymentNo: number; projectedEndMonth: string | null }>;
  activeInstallmentPlans:   Array<{ id: string; merchantNormalized: string; description: string | null; paymentAmountIls: string | number; startMonth: string; currentPaymentNo: number; totalPayments: number | null; linkedThisMonth: string }>;
  projectedEom:             number;
  hasEnoughDataForProjection: boolean;
  totalIncome:              number;
  isCurrentMonth:           boolean;
  day:                      number;
  daysInMonth:              number;
  daysLeft:                 number;
  month:                    string;
  spent:                    number;
}): Insight[] {
  const {
    budgetRows, prevTotals, endingPlans, activeInstallmentPlans,
    projectedEom, hasEnoughDataForProjection, totalIncome,
    isCurrentMonth, day, daysInMonth, daysLeft, month, spent,
  } = args;

  // Helper to format ILS without decimals — used a lot in explanations below.
  const ils = (n: number) => formatIls(n, { decimals: false });

  const insights: Insight[] = [];

  // ① Over-budget categories
  for (const { cat, actual, target } of budgetRows) {
    if (target !== null && target > 0 && actual > target) {
      const over = actual - target;
      insights.push({
        id: `over-budget-${cat.id}`,
        severity: 'critical',
        icon: AlertOctagon,
        title: `${cat.nameHe} — חרגת מהתקציב`,
        body: `הוצאת ${ils(actual)} מתוך ${ils(target)} (${ils(over)} מעל)`,
        explanation:
          `סכמתי את כל העסקאות החודש (חודש החיוב ${month}) שמסווגות תחת הקטגוריה "${cat.nameHe}".\n` +
          `סך כל ההוצאה החודש: ${ils(actual)}.\n` +
          `התקציב החודשי שהגדרת לקטגוריה הזו: ${ils(target)}.\n` +
          `${ils(actual)} − ${ils(target)} = חריגה של ${ils(over)}.`,
        href: `/transactions?month=${month}`,
      });
    }
  }

  // ② Projected negative month-end balance
  if (isCurrentMonth && hasEnoughDataForProjection && projectedEom < 0) {
    const dailyAvg = day > 0 ? spent / day : 0;
    const projectedExtra = dailyAvg * daysLeft;
    insights.push({
      id: 'projected-negative',
      severity: 'critical',
      icon: TrendingDown,
      title: 'תחזית סוף חודש שלילית',
      body: `לפי קצב ההוצאות הנוכחי, הסוף חודש צפוי להיות ${ils(projectedEom)}`,
      explanation:
        `התחזית מבוססת על קצב ההוצאות עד עכשיו, מוקרנת לסוף החודש.\n` +
        `\n` +
        `• היום: יום ${day} מתוך ${daysInMonth} (${daysLeft} ימים נותרו)\n` +
        `• הוצאות עד כה: ${ils(spent)}\n` +
        `• ממוצע יומי: ${ils(spent)} ÷ ${day} = ${ils(dailyAvg)} ליום\n` +
        `• הוצאה צפויה עד סוף החודש: ${ils(dailyAvg)} × ${daysLeft} = ${ils(projectedExtra)}\n` +
        `• הכנסות שנרשמו החודש: ${ils(totalIncome)}\n` +
        `\n` +
        `חישוב: ${ils(totalIncome)} − (${ils(spent)} + ${ils(projectedExtra)}) = ${ils(projectedEom)}\n` +
        `\n` +
        `שים לב — זוהי הקרנה לינארית פשוטה. אם יש הוצאות גדולות שכבר חלפו (כמו ארנונה ביום הראשון), התחזית עלולה להיות פסימית מדי. בעתיד נשפר את החישוב כדי להבחין בין הוצאות חוזרות לבין הוצאות חד-פעמיות.`,
    });
  }

  // ③ Near-budget categories (80 – 99 %)
  for (const { cat, actual, target } of budgetRows) {
    if (target !== null && target > 0) {
      const pct = (actual / target) * 100;
      if (pct >= 80 && pct < 100) {
        insights.push({
          id: `near-budget-${cat.id}`,
          severity: 'warning',
          icon: AlertTriangle,
          title: `${cat.nameHe} — ${Math.round(pct)}% מהתקציב`,
          body: `נותר ${ils(target - actual)} מתקציב ${ils(target)}`,
          explanation:
            `סכמתי את העסקאות בקטגוריה "${cat.nameHe}" עבור חודש החיוב ${month}.\n` +
            `סך הוצאות עד כה: ${ils(actual)}.\n` +
            `תקציב חודשי: ${ils(target)}.\n` +
            `${ils(actual)} ÷ ${ils(target)} = ${Math.round(pct)}%.\n` +
            `נותר ${ils(target - actual)} עד סוף החודש.\n` +
            `\n` +
            `התראה זו נדלקת בין 80%-99% מהתקציב, כדי שתספיק לתכנן לפני חריגה.`,
          href: `/transactions?month=${month}`,
        });
      }
    }
  }

  // ④ Month-over-month spending spike (> 40 % increase, previous month ≥ ₪200)
  const prevMap = new Map<string, number>();
  for (const p of prevTotals) {
    if (p.categoryId) prevMap.set(p.categoryId, Math.abs(Number(p.total)));
  }
  for (const { cat, actual } of budgetRows) {
    const prev = prevMap.get(cat.id) ?? 0;
    if (prev >= 200 && actual > 0) {
      const ratio = actual / prev;
      if (ratio > 1.4) {
        const pctIncrease = Math.round((ratio - 1) * 100);
        insights.push({
          id: `mom-spike-${cat.id}`,
          severity: 'warning',
          icon: TrendingUp,
          title: `${cat.nameHe} — עלייה של ${pctIncrease}% לעומת חודש קודם`,
          body: `חודש שעבר: ${ils(prev)} ← החודש: ${ils(actual)}`,
          explanation:
            `השוויתי את סך ההוצאות בקטגוריה "${cat.nameHe}" בין החודש הקודם לחודש הנוכחי.\n` +
            `\n` +
            `• חודש שעבר: ${ils(prev)}\n` +
            `• החודש (${month}): ${ils(actual)}\n` +
            `• יחס: ${ils(actual)} ÷ ${ils(prev)} = ${ratio.toFixed(2)}× (${pctIncrease}% עלייה)\n` +
            `\n` +
            `התראה זו נדלקת רק כאשר העלייה גדולה מ-40% וההוצאה בחודש הקודם הייתה לפחות ₪200, כדי לסנן רעש סטטיסטי בקטגוריות קטנות.`,
          href: `/transactions?month=${month}`,
        });
      }
    }
  }

  // ⑤ Installment plans with no linked transaction after mid-month
  if (isCurrentMonth && day > 15) {
    for (const plan of activeInstallmentPlans) {
      if (Number(plan.linkedThisMonth) === 0) {
        const name = plan.description ?? plan.merchantNormalized;
        insights.push({
          id: `installment-missing-${plan.id}`,
          severity: 'warning',
          icon: CreditCard,
          title: `תשלום "${name}" — לא קושרה עסקה החודש`,
          body: `תשלום חודשי ${ils(Math.abs(Number(plan.paymentAmountIls)))} — כדאי לקשר לעסקה`,
          explanation:
            `סרקתי את כל תוכניות התשלומים הפעילות שלך ובדקתי כמה עסקאות מקושרות אליהן בחודש הנוכחי (${month}).\n` +
            `\n` +
            `• תוכנית: "${name}"\n` +
            `• תשלום חודשי קבוע: ${ils(Math.abs(Number(plan.paymentAmountIls)))}\n` +
            `• עסקאות מקושרות החודש: 0\n` +
            `\n` +
            `מאחר שהיום ${day} לחודש (אחרי ה-15), אם החיוב היה אמור להגיע — הוא היה אמור להופיע כבר. ייתכן שהוא לא הוזן/יובא, או שהתשלום דולג. כדאי לבדוק.`,
          href: '/installments',
        });
      }
    }
  }

  // ⑥ Installment plans ending this month or next
  const nextMonth = addMonths(month, 1);
  for (const plan of endingPlans) {
    const end = plan.projectedEndMonth;
    if (!end) continue;
    const endingThisMonth = end === month;
    const endingNextMonth = end === nextMonth;
    if (endingThisMonth || endingNextMonth) {
      const name = plan.description ?? plan.merchantNormalized;
      insights.push({
        id: `ending-soon-${plan.id}`,
        severity: 'info',
        icon: PartyPopper,
        title: `"${name}" ${endingThisMonth ? 'מסתיים החודש' : 'מסתיים בחודש הבא'}`,
        body: `תשלום חודשי ${ils(Math.abs(Number(plan.paymentAmountIls)))} · ${plan.totalPayments ? `${plan.currentPaymentNo}/${plan.totalPayments} תשלומים` : 'תשלום אחרון'}`,
        explanation:
          `בדקתי תאריכי סיום צפויים של תוכניות תשלומים פעילות.\n` +
          `\n` +
          `• תוכנית: "${name}"\n` +
          `• תשלום ${plan.currentPaymentNo}${plan.totalPayments ? ` מתוך ${plan.totalPayments}` : ''}\n` +
          `• תשלום חודשי: ${ils(Math.abs(Number(plan.paymentAmountIls)))}\n` +
          `• תאריך סיום צפוי: ${end}\n` +
          `• חודש נוכחי: ${month}\n` +
          `\n` +
          `אחרי שהתוכנית תסתיים, ${ils(Math.abs(Number(plan.paymentAmountIls)))} ייפנו בכל חודש — הזדמנות מצוינת להוסיף ליעד חיסכון.`,
        href: '/installments',
      });
    }
  }

  // ⑦ No income recorded past day 10 of current month
  if (isCurrentMonth && day > 10 && totalIncome === 0) {
    insights.push({
      id: 'no-income',
      severity: 'warning',
      icon: Wallet,
      title: 'לא נרשמו הכנסות החודש',
      body: `כבר יום ${day} לחודש — בדוק שהכנסות הוזנו`,
      explanation:
        `סכמתי את כל העסקאות החיוביות (סכום > 0, או קטגוריה שמסומנת כהכנסה) עבור חודש החיוב ${month}.\n` +
        `\n` +
        `• סכום ההכנסות שנמצא: 0\n` +
        `• יום בחודש: ${day} (אחרי ה-10 — מועד שבו לרוב כבר התקבלה משכורת)\n` +
        `\n` +
        `אם המשכורת כבר נכנסה אבל לא רואים אותה כאן, ייתכן שהיא לא הוזנה ידנית או שהסקריפר לא רץ. בדוק בדף התנועות או הוסף עסקה חדשה.`,
      href: `/transactions?month=${month}`,
    });
  }

  // ⑧ Positive: spending well under total budget after mid-month
  if (isCurrentMonth && hasEnoughDataForProjection && day >= 15) {
    const totalTarget = budgetRows.reduce((s, r) => s + (r.target ?? 0), 0);
    if (totalTarget > 500) {
      const pctUsed = spent / totalTarget;
      if (pctUsed < 0.6) {
        insights.push({
          id: 'under-budget',
          severity: 'positive',
          icon: Sparkles,
          title: 'תקציב בשליטה מצוינת',
          body: `הוצאת ${Math.round(pctUsed * 100)}% מהתקציב הכולל — חסכת ${ils(totalTarget - spent)} עד כה`,
          explanation:
            `סכמתי את כל התקציבים החודשיים שהגדרת לקטגוריות שונות, ואת כל ההוצאות החודש.\n` +
            `\n` +
            `• סך תקציבים: ${ils(totalTarget)}\n` +
            `• סך הוצאות עד כה: ${ils(spent)}\n` +
            `• שיעור שימוש: ${ils(spent)} ÷ ${ils(totalTarget)} = ${Math.round(pctUsed * 100)}%\n` +
            `• יום בחודש: ${day} מתוך ${daysInMonth} (כבר עברה אמצע החודש)\n` +
            `\n` +
            `מאחר שעברנו את אמצע החודש ועדיין מתחת ל-60% מהתקציב הכולל, אתה במסלול טוב. ${ils(totalTarget - spent)} עדיין זמינים עד סוף החודש.`,
        });
      }
    }
  }

  // Sort: critical → warning → info → positive
  const ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return insights.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

// ── Severity visual config ────────────────────────────────────────────────────

const SEVERITY_CFG: Record<InsightSeverity, {
  sectionBg:   string;
  rowBg:       string;
  rowBorder:   string;
  badgeBg:     string;
  badgeText:   string;
  iconColor:   string;
  label:       string;
}> = {
  critical: {
    sectionBg: 'border-destructive/30',
    rowBg:     'bg-destructive/5',
    rowBorder: 'border-destructive/20',
    badgeBg:   'bg-destructive',
    badgeText: 'text-primary-foreground',
    iconColor: 'text-destructive',
    label:     'קריטי',
  },
  warning: {
    sectionBg: 'border-warning/30',
    rowBg:     'bg-warning-soft',
    rowBorder: 'border-warning/20',
    badgeBg:   'bg-warning',
    badgeText: 'text-primary-foreground',
    iconColor: 'text-warning',
    label:     'שים לב',
  },
  info: {
    sectionBg: 'border-primary/20',
    rowBg:     'bg-primary-soft/60',
    rowBorder: 'border-primary/15',
    badgeBg:   'bg-primary-soft',
    badgeText: 'text-primary',
    iconColor: 'text-primary',
    label:     'מידע',
  },
  positive: {
    sectionBg: 'border-success/30',
    rowBg:     'bg-success-soft/50',
    rowBorder: 'border-success/20',
    badgeBg:   'bg-success-soft',
    badgeText: 'text-success',
    iconColor: 'text-success',
    label:     'חיובי',
  },
};

function InsightsWidget({ insights, month }: { insights: Insight[]; month: string }) {
  // We always render the widget — even with zero active insights — so the
  // user can open the "what does this widget watch?" catalog and understand
  // what alerts to expect. The per-row severity badges already convey count
  // visually, so the header stays minimal.

  void month; // used only by callers for href values inside computeInsights

  return (
    <section className="rounded-xl border bg-card overflow-hidden" dir="rtl">
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          תובנות חכמות
        </h2>
        {/* Info icon — opens the "what insights does this widget watch?"
            catalog in a modal. Most useful when no insights are firing. */}
        <InsightsCatalogToggle />
      </div>

      {/* empty state */}
      {insights.length === 0 && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">אין תובנות פעילות כרגע</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            לחץ על אייקון ה-<Info className="inline size-3" /> למעלה כדי לראות אילו תובנות המערכת בודקת
          </p>
        </div>
      )}

      {/* insight rows */}
      <ul className="divide-y">
        {insights.map((insight) => {
          const cfg = SEVERITY_CFG[insight.severity];
          const Icon = insight.icon;
          const inner = (
            <div className={cn('flex items-start gap-3 px-4 py-3', cfg.rowBg, insight.href && 'hover:brightness-95 transition-all')}>
              <Icon className={cn('size-4 shrink-0 mt-0.5', cfg.iconColor)} />
              <div className="flex-1 min-w-0">
                {/* Title row: title + Info button inline at the end */}
                <p className="flex items-center gap-1.5 text-sm font-medium leading-snug">
                  <span className="min-w-0">{insight.title}</span>
                  {insight.explanation && (
                    // Client island — opens a modal popup with the calculation
                    // breakdown. Stops click propagation so it doesn't trigger
                    // the row's parent <Link>.
                    <InsightDetailsToggle title={insight.title} explanation={insight.explanation} />
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{insight.body}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', cfg.badgeBg, cfg.badgeText)}>
                  {cfg.label}
                </span>
                {insight.href && <ChevronLeft className="size-3.5 text-muted-foreground" />}
              </div>
            </div>
          );
          return (
            <li key={insight.id} className={cn('border-r-4', cfg.rowBorder)}>
              {insight.href ? <Link href={insight.href}>{inner}</Link> : inner}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
