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
import { DashboardChatHint } from './dashboard-chat-hint';
import { GoalIcon } from '@/components/ui/goal-icon';
import { ViewTabs, ViewStripe, type View } from '@/components/view-tabs';
import { readActiveView } from '@/components/view-tabs-server';
import { MonthSwitcher } from './transactions/month-switcher';
import { INSIGHT_ICONS, type InsightIconName } from './dashboard-insight-icons';
import { excludeHiddenProjectTxns } from '@/lib/project-filter';
import { readActiveMonth } from '@/lib/active-month';
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  Plus,
  BadgeAlert,
  CreditCard,
  Banknote,
  Repeat,
  PiggyBank,
  Sparkles,
  ChevronLeft,
  Info,
  Briefcase,
  CalendarCheck,
  Pencil,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// View type now lives in @/components/view-tabs (shared with /transactions).

export default async function DashboardPage(props: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  // Resolve view from URL param → fba_view cookie → 'combined' default.
  // The cookie is written by <ViewTabs> on click, so the active view follows
  // the user across pages even when the URL doesn't carry an explicit ?view.
  const view: View = await readActiveView(sp.view);
  const db = getDb();

  // ---- Pick default month: most recent past month with actual data ----
  // activeBillingMonth(10) accounts for the cutoff-day: on Apr 15 (day > 10) it
  // returns May 2026 rather than April, matching where today's transactions are billed.
  const cur = activeBillingMonth(10);

  // Resolve month: URL param > fba_month cookie > most-recent-with-data > current.
  // The cookie persists the user's last picked month across pages so clicking
  // through to /transactions, /history etc. keeps the same month in view.
  const cookieMonth = await readActiveMonth(sp.month);

  // ── Parallel 1: month detection + account list (no dependency between them) ─
  const [latestMonthRows, allAccounts] = await Promise.all([
    cookieMonth
      ? Promise.resolve<Array<{ m: string }>>([])
      : db
          .select({ m: sql<string>`max(${schema.transactions.billingMonth})` })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.householdId, householdId),
              isNull(schema.transactions.deletedAt),
              eq(schema.transactions.isProjected, false),
              excludeHiddenProjectTxns(),
              sql`${schema.transactions.billingMonth} <= ${cur}`,
            ),
          ),
    db
      .select({
        id: schema.accounts.id,
        purpose: schema.accounts.purpose,
        name: schema.accounts.name,
        type: schema.accounts.type,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.householdId, householdId)),
  ]);
  const month = cookieMonth ?? latestMonthRows[0]?.m ?? cur;

  // Account filter:
  //   personal/business → restrict to that purpose + 'shared' accounts
  //   combined          → ALL accounts (no filter)
  //   household         → ALL accounts (same as combined; the difference
  //                       is project inclusion, not account scope)
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
  // Project-tagged transactions (construction, big remodels) are normally
  // hidden from the monthly views so they don't drown out regular spending.
  // The HOUSEHOLD view explicitly includes them — it's the "show me everything
  // including projects" lens for cash-flow validation.
  if (view !== 'household') {
    baseConditions.push(excludeHiddenProjectTxns());
  }
  // Transfers between own accounts are excluded from ALL views' cash-flow
  // totals. They're not real income or expense — they're moving the user's
  // own money between accounts (e.g. a salary transfer from business → personal,
  // or a savings deposit). Including them inflates BOTH income and expense
  // numbers without changing the bottom-line balance, and creates noise in
  // category breakdowns. This matches the behavior of the per-cycle banner
  // on /transactions which has always excluded transfers via sumExp/sumInc.
  baseConditions.push(eq(schema.transactions.isTransfer, false));
  // Settlement-basis accounting (migration 0015): exclude CC detail rows
  // already covered by their bank-side settlement line, plus user-flagged
  // accounting noise (loan refinancing, internal corrections). Forex CC
  // charges keep excluded_from_totals=false so they're still counted.
  baseConditions.push(eq(schema.transactions.excludedFromTotals, false));
  if (accountFilter && accountFilter.length > 0) {
    baseConditions.push(inArray(schema.transactions.accountId, accountFilter));
  }

  // NOTE on cash-flow totals: a previous version added an `account.type='bank'`
  // filter to keep CC charges out of monthly totals. That was over-correcting
  // — it also excluded FOREX CC charges (debited from the bank immediately,
  // not part of the monthly settlement) which SHOULD count toward cash flow.
  // The settlement-basis flag `excludedFromTotals` (in baseConditions above)
  // already does the right thing:
  //   - Non-forex CC details: excludedFromTotals=true → not counted (covered
  //     by the bank settlement line which IS counted).
  //   - Forex CC charges: excludedFromTotals=false → counted as cash flow.
  // So baseConditions alone is the correct filter; both the top KPI cards
  // and the "עסקאות החודש" summary use the same filter and stay aligned.

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
  // Same project-inclusion rule as baseConditions — household view sees
  // projected installments tagged to projects too.
  if (view !== 'household') {
    projectedConditions.push(excludeHiddenProjectTxns());
  }
  // Same account-purpose filter as baseConditions (no bank-only filter — see
  // note above; settlement-basis already excludes non-forex CC charges).
  if (accountFilter && accountFilter.length > 0) {
    projectedConditions.push(inArray(schema.transactions.accountId, accountFilter));
  }
  projectedConditions.push(eq(schema.transactions.excludedFromTotals, false));

  // ── End-of-selected-month — used by the cumulative balance KPI.
  // For BANK accounts (which have no cutoff_day cycle), the billing month
  // matches the calendar month, so end-of-billing-month = last calendar day.
  // We pass this date to the cumulative-balance query as the upper bound:
  // "show me the balance as it was at the end of this month".
  const [eomYear, eomMon] = month.split('-').map(Number);
  const eomDate = new Date(eomYear!, eomMon!, 0).toISOString().slice(0, 10);

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
    cumulativeOpeningRow,
    cumulativeTxnRow,
    cashFlowSumsRow,
    cashFlowByPurposeRows,
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

    // (e) recent transactions for the dashboard strip — BANK ONLY so the
    // strip's summary bar (computed client-side from these rows) matches the
    // bank-only KPI cards above. CC transactions are still visible on the
    // /transactions page, in the donut, and in projects.
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

    // (f) total transaction count for the "N more" footer — BANK ONLY (matches the strip)
    noAccountsForView
      ? Promise.resolve([{ n: '0' as string }])
      : db
          .select({ n: sql<string>`count(*)::text` })
          .from(schema.transactions)
          .where(and(...baseConditions)),

    // (g) "already charged" — chargeDate ≤ today OR null (money already left the bank)
    // BANK ONLY (cash-flow view): we want the bank settlement to be the source
    // of truth, not the CC detail rows.
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

    // (h) "pending charge" — chargeDate > today (debit still in the future). BANK ONLY.
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

    // (i) Cumulative balance — opening balance side.
    // Sum opening_balance_ils across BANK accounts that match the active view.
    // CC accounts excluded by design — cumulative balance represents "money
    // you actually HAVE", which is bank-side.
    noAccountsForView
      ? Promise.resolve([{ total: '0' }])
      : db
          .select({ total: sql<string>`coalesce(sum(${schema.accounts.openingBalanceIls}), 0)` })
          .from(schema.accounts)
          .where(
            and(
              eq(schema.accounts.householdId, householdId),
              eq(schema.accounts.type, 'bank'),
              accountFilter && accountFilter.length > 0
                ? inArray(schema.accounts.id, accountFilter)
                : undefined,
            ),
          ),

    // (j) Cumulative balance — net change side, using the SYMMETRIC formula:
    //   balance(T) = openingBalance + S(T) - S(asOf)
    // where S(d) = sum of all amounts with effectiveDate <= d. This works in
    // both directions: future months ADD post-anchor activity, past months
    // SUBTRACT activity that happened between T and the anchor (un-doing it).
    // Letting NULL asOf behave as "negative infinity" makes the no-anchor
    // case fall through to "sum everything up to T" automatically.
    //
    // Filters: bank accounts only (cumulative balance = cash on hand, not
    // CC debt), not deleted, not projected, not excludedFromTotals.
    // Transfers ARE included — they actually moved money in/out of bank
    // accounts; the combined view sums them and they cancel automatically.
    noAccountsForView
      ? Promise.resolve([{ total: '0' }])
      : db
          .select({
            total: sql<string>`coalesce(sum(case
              when coalesce(${schema.transactions.chargeDate}, ${schema.transactions.transactionDate}) > coalesce(${schema.accounts.openingBalanceAsOf}, '0001-01-01'::date)
                   and coalesce(${schema.transactions.chargeDate}, ${schema.transactions.transactionDate}) <= ${eomDate}
                then ${schema.transactions.amountIls}
              when coalesce(${schema.transactions.chargeDate}, ${schema.transactions.transactionDate}) > ${eomDate}
                   and coalesce(${schema.transactions.chargeDate}, ${schema.transactions.transactionDate}) <= coalesce(${schema.accounts.openingBalanceAsOf}, '0001-01-01'::date)
                then -${schema.transactions.amountIls}
              else 0
            end), 0)`,
          })
          .from(schema.transactions)
          .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
          .where(
            and(
              eq(schema.transactions.householdId, householdId),
              eq(schema.accounts.type, 'bank'),
              isNull(schema.transactions.deletedAt),
              eq(schema.transactions.isProjected, false),
              eq(schema.transactions.excludedFromTotals, false),
              accountFilter && accountFilter.length > 0
                ? inArray(schema.accounts.id, accountFilter)
                : undefined,
            ),
          ),

    // (k) Cash-flow sums — TRUE income/expense totals, summed PER ROW (not
    // grouped by category). Drives the dashboard's KPI cards (הכנסות החודש,
    // הוצאות החודש, מאזן). Without this, the (a) `totals` query groups by
    // category first, so a category that mixes positive and negative txns
    // (e.g., loan disbursement +53K and CC settlement −41K both tagged
    // "הלוואות וחיסכון") sums to a single positive value (+12K) and the
    // expense gets hidden. Per-row classification keeps the math honest.
    noAccountsForView
      ? Promise.resolve({ income: '0', spent: '0' })
      : db
          .select({
            income: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} >= 0 then ${schema.transactions.amountIls} else 0 end), 0)`,
            spent: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} <  0 then ${schema.transactions.amountIls} else 0 end), 0)`,
          })
          .from(schema.transactions)
          .where(and(...baseConditions))
          .then(([r]) => r ?? { income: '0', spent: '0' }),

    // (l) Per-bucket breakdown for the multi-account views (combined +
    // household). Lets the KPI tiles show a small "אישי X · עסקי Y" (and
    // for household: also "· פרויקטים Z") verification beneath each total
    // so the user can confirm the combined number is the sum of the parts.
    //
    // Bucketing rule (CASE WHEN in SQL so it's one query):
    //   - project_id IS NOT NULL  → 'projects' bucket (takes precedence
    //                                over account.purpose)
    //   - else                    → account.purpose ('personal' / 'business'
    //                                / null → 'other')
    //
    // For COMBINED view, project rows are already filtered out by
    // baseConditions (excludeHiddenProjectTxns), so the 'projects' bucket
    // stays empty and only personal/business surface.
    // For HOUSEHOLD view, baseConditions does NOT apply that filter, so
    // project rows hit the 'projects' bucket and stay separated from the
    // personal/business spending the user does in regular life.
    //
    // For personal / business / no-accounts views we skip this entirely —
    // a breakdown there would equal the main figure (single bucket).
    (view !== 'combined' && view !== 'household') || noAccountsForView
      ? Promise.resolve([] as Array<{ bucket: string | null; income: string; spent: string }>)
      : db
          .select({
            bucket: sql<string | null>`case when ${schema.transactions.projectId} is not null then 'projects' else ${schema.accounts.purpose} end`,
            income: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} >= 0 then ${schema.transactions.amountIls} else 0 end), 0)`,
            spent: sql<string>`coalesce(sum(case when ${schema.transactions.amountIls} <  0 then ${schema.transactions.amountIls} else 0 end), 0)`,
          })
          .from(schema.transactions)
          .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
          .where(and(...baseConditions))
          .groupBy(sql`case when ${schema.transactions.projectId} is not null then 'projects' else ${schema.accounts.purpose} end`),
  ]);

  // ── Synchronous derivations from the parallel batch results ───────────────
  const catMap = new Map(cats.map((c) => [c.id, c]));

  // ── Income / Expense classification ────────────────────────────────────────
  // We use SIGN as the source of truth, not category type. Reasons:
  //   1. Categories don't always match sign — a "savings" category can carry
  //      a positive amount when it represents a transfer-in or loan disbursement
  //      that the user (or auto-categorization) tagged there. Treating it
  //      as a negative-expense by category-rule produces the wrong income/
  //      expense split.
  //   2. Sign is unambiguous: positive amount = money came in, negative
  //      amount = money went out. Always.
  //   3. The displayed balance (income − expenses) stays mathematically
  //      identical to "sum of all amounts", so users see the same bottom
  //      line regardless of how categories are tagged.
  //
  // Trade-off: refunds (positive amounts on expense categories) now count as
  // income rather than reducing expenses. We accept this — refunds ARE money
  // coming in, and treating them otherwise creates the inverse problem of
  // hiding real income.
  //
  // Side calc: detect "suspicious" rows — large positive amounts on expense
  // categories. These are usually unflagged transfers between the user's
  // own accounts. Surface a soft warning so the user can re-tag them as
  // transfers (which then get excluded from the combined view).
  // Top KPI cards (הכנסות / הוצאות / מאזן) come from cashFlowSumsRow which
  // does PER-ROW classification — the only honest split when a category mixes
  // positive and negative transactions (see (k) above for full explanation).
  const totalIncome = Number(cashFlowSumsRow?.income ?? 0);
  const totalSpent = Number(cashFlowSumsRow?.spent ?? 0);

  // Per-bucket breakdown for the multi-account KPI captions (combined +
  // household). Aggregated server-side in (l) above; empty in any other view.
  // Bucket precedence: 'projects' > account.purpose ('personal'/'business') >
  // 'other' (null/unknown purpose). The 'projects' bucket only fires for
  // household view (combined excludes project rows upstream).
  const purposeBreakdown = (cashFlowByPurposeRows ?? []).reduce(
    (acc, r) => {
      const bucket =
        r.bucket === 'projects' ? acc.projects :
        r.bucket === 'personal' ? acc.personal :
        r.bucket === 'business' ? acc.business :
        acc.other;
      bucket.income += Number(r.income);
      bucket.spent += Number(r.spent);
      return acc;
    },
    {
      personal: { income: 0, spent: 0 },
      business: { income: 0, spent: 0 },
      projects: { income: 0, spent: 0 },
      other:    { income: 0, spent: 0 },
    },
  );
  const showBreakdown = view === 'combined' || view === 'household';

  // Suspicious-income warning STILL iterates the per-category `totals` so we
  // surface mis-tagged transfers at the category level (a +1K row in an
  // expense category is the signal we care about).
  let suspiciousIncomeIls = 0;
  for (const t of totals) {
    const cat = t.categoryId ? catMap.get(t.categoryId) : null;
    const v = Number(t.total);
    if (v > 1000 && cat && !cat.isIncome) {
      suspiciousIncomeIls += v;
    }
  }

  // balance = income + spent (spent is negative). Equivalent to:
  //   income − abs(spent).
  // This always equals the raw net of all amounts, regardless of how they're
  // categorized — so the bottom-line balance never lies.
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

  // Cumulative balance ("יתרה מצטברת בפועל") = opening anchor + transactions
  // since the anchor (capped at end of selected month). Bank accounts only.
  // See queries (i) and (j) above for filter rationale.
  const cumulativeOpeningIls = Number(cumulativeOpeningRow[0]?.total ?? 0);
  const cumulativeTxnIls = Number(cumulativeTxnRow[0]?.total ?? 0);
  const cumulativeBalanceIls = cumulativeOpeningIls + cumulativeTxnIls;

  // ── Parallel 3: insights-only queries (non-blocking for main render) ───────
  const prevMonth = addMonths(month, -1);
  // All three queries below now respect the active view tab so insights
  // change correctly when switching אישי / עסקי / משולב. Without the
  // accountFilter, MoM comparison and installment plans were aggregated
  // across ALL accounts regardless of which view the user picked.
  // Parallel batch 3: prev-month MoM, installment-plan insights, AND the two
  // standalone reads (active projects, recurring patterns). All five queries
  // depend only on `householdId`, `month`, `prevMonth`, and `accountFilter` —
  // values known before this batch runs — so collapsing them into a single
  // round-trip shaves an extra ~RTT off every dashboard load.
  const [
    prevTotals,
    endingPlans,
    activeInstallmentPlans,
    activeProjects,
    activeRecurringPatterns,
  ] = await Promise.all([
    // (i) last month category totals — for MoM comparison (view-scoped)
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
          excludeHiddenProjectTxns(),
          accountFilter !== null
            ? inArray(schema.transactions.accountId, accountFilter)
            : undefined,
        ),
      )
      .groupBy(schema.transactions.categoryId),

    // (j) active installment plans ending this month or next month (view-scoped)
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
          accountFilter !== null
            ? inArray(schema.installmentPlans.accountId, accountFilter)
            : undefined,
        ),
      ),

    // (k) all active installment plans (for "not in transactions" warning, view-scoped)
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
          accountFilter !== null
            ? inArray(schema.installmentPlans.accountId, accountFilter)
            : undefined,
        ),
      ),

    // (l) Active projects + their cumulative spend.
    // Regular monthly totals deliberately EXCLUDE project transactions
    // (per excludeFromMonthlyTotals), but the user still wants to know the
    // projects exist + what they've cost so far — otherwise the ₪547K spent
    // on construction is invisible from the home page.
    //
    // Inner `t` (transaction) has its own `id` column, so writing
    // `${schema.projects.id}` here would render as unqualified `"id"` and
    // resolve to `t.id` instead of `project.id`. Always write the
    // table-qualified form explicitly in correlated subqueries.
    db
      .select({
        id:             schema.projects.id,
        name:           schema.projects.name,
        color:          schema.projects.color,
        totalBudgetIls: schema.projects.totalBudgetIls,
        status:         schema.projects.status,
        excludeFromMonthlyTotals: schema.projects.excludeFromMonthlyTotals,
        // NET out-of-pocket: SUM(amount) is negative when more went out than
        // came in (expenses − income); we ABS to display as a positive figure
        // matching the "spent so far" framing. This is the SAME number the
        // project drilldown page shows as "netOutOfPocket" — they used to
        // disagree because this card summed ABS(amount), counting loan
        // disbursements (income) as "spent" alongside vendor payments.
        // Excludes excluded_from_totals rows (loan refinancing noise) like
        // the project page does.
        totalSpent: sql<string>`(
          SELECT COALESCE(ABS(SUM(t.amount_ils::numeric)), 0)
          FROM ${schema.transactions} t
          WHERE t.project_id = "project"."id"
            AND t.deleted_at IS NULL
            AND t.is_projected = false
            AND t.excluded_from_totals = false
        )`,
        txnCount: sql<string>`(
          SELECT COUNT(*) FROM ${schema.transactions} t
          WHERE t.project_id = "project"."id"
            AND t.deleted_at IS NULL
            AND t.is_projected = false
        )`,
      })
      .from(schema.projects)
      .where(and(
        eq(schema.projects.householdId, householdId),
        eq(schema.projects.status, 'active'),
      ))
      .orderBy(schema.projects.createdAt),

    // (m) Active recurring patterns (subscriptions / monthly bills). Used by
    // the KPI tile, the dedicated dashboard widget below, and the
    // "recurring as % of income" insight.
    db
      .select({
        merchantNormalized: schema.recurringPatterns.merchantNormalized,
        description:        schema.recurringPatterns.description,
        categoryId:         schema.recurringPatterns.categoryId,
        expectedAmountIls:  schema.recurringPatterns.expectedAmountIls,
        frequency:          schema.recurringPatterns.frequency,
      })
      .from(schema.recurringPatterns)
      .where(
        and(
          eq(schema.recurringPatterns.householdId, householdId),
          eq(schema.recurringPatterns.status, 'active'),
        ),
      ),
  ]);

  // Normalise each pattern to its monthly equivalent so all sums compare
  // apples-to-apples regardless of cadence (bimonthly ÷ 2, quarterly ÷ 3,
  // yearly ÷ 12).
  const FREQ_TO_MONTHLY: Record<string, number> = { monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12 };
  const recurringMonthly = activeRecurringPatterns.map((p) => {
    const v = Number(p.expectedAmountIls);
    const factor = FREQ_TO_MONTHLY[p.frequency] ?? 1;
    return {
      merchantNormalized: p.merchantNormalized,
      description:        p.description,
      categoryId:         p.categoryId,
      monthly:            v * factor, // negative for expense, positive for income
      frequency:          p.frequency,
    };
  });
  const recurringMonthlyExpense = recurringMonthly
    .filter((p) => p.monthly < 0)
    .reduce((s, p) => s + Math.abs(p.monthly), 0);
  const recurringMonthlyIncome = recurringMonthly
    .filter((p) => p.monthly > 0)
    .reduce((s, p) => s + p.monthly, 0);
  // Top 5 biggest expense-side patterns for the "where the money goes" list
  // in the recurring widget below.
  const topRecurringExpenses = recurringMonthly
    .filter((p) => p.monthly < 0)
    .sort((a, b) => a.monthly - b.monthly) // most-negative first
    .slice(0, 5);

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
    recurringMonthlyExpense,
  });

  const donutData = budgetRows
    .filter((r) => r.actual > 0)
    .map((r) => ({
      name: r.cat.nameHe,
      value: r.actual,
      color: r.cat.color ?? 'hsl(var(--chart-1))',
    }));

  const hasData = totals.length > 0;

  const monthOptions: string[] = [];
  for (let i = -12; i <= 12; i++) monthOptions.push(addMonths(cur, i));
  if (!monthOptions.includes(month)) monthOptions.unshift(month);

  return (
    <div className="space-y-6">
      {/* 2px colored stripe — anchors which view (אישי/עסקי/משולב) is active. */}
      <ViewStripe view={view} />

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
          <ViewTabs
            current={view}
            hrefs={{
              combined:  `/?view=combined&month=${month}`,
              personal:  `/?view=personal&month=${month}`,
              business:  `/?view=business&month=${month}`,
              household: `/?view=household&month=${month}`,
            }}
          />
          <MonthSwitcher
            month={month}
            view={view}
            prev={prevMonth}
            next={addMonths(month, 1)}
            label={month === activeBillingMonth(10) ? 'חודש נוכחי' : month > activeBillingMonth(10) ? 'חודש הבא' : 'חודש קודם'}
            activeMonth={activeBillingMonth(10)}
            basePath="/"
          />
          {/* Hidden no-JS fallback — kept so users without JS can still
              switch months via the form-submit path. */}
          <form action="/" method="get" className="hidden">
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
        <div className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          לא סומנו חשבונות{' '}
          {/* household + combined never trigger noAccountsForView (no filter),
              so the only realistic branches here are business and personal. */}
          <strong>{view === 'business' ? 'עסקיים' : 'אישיים'}</strong>. כדי שתצוגה זו תציג נתונים, פתח{' '}
          <Link href="/admin/accounts" className="underline">
            חשבונות
          </Link>{' '}
          וסמן את החשבונות המתאימים.
        </div>
      )}

      {/* Untagged-transfer warning. Kicks in when we detect ≥₪1000 of
          POSITIVE amounts on non-income categories — almost always means
          the user has a cross-account transfer (e.g. business → personal
          salary, savings withdrawal) that didn't get isTransfer=true at
          import time. The amount is currently inflating "Income" and the
          fix is one-click in the transactions edit modal. */}
      {suspiciousIncomeIls > 0 && (
        // Brand book §6.4 / §1: warning-tone banner. Tokenized — no hard-coded
        // amber. Icon badge replaces the emoji per §5.4.
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-warning">
            <BadgeAlert className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              זוהו {formatIls(suspiciousIncomeIls, { decimals: false })} בתנועות חיוביות גדולות בקטגוריות הוצאה
            </p>
            <p className="mt-1 text-xs text-warning/90">
              לרוב אלו <strong>העברות בין החשבונות שלך</strong> (למשל הפקדה מבנק לבנק) שלא סומנו כ-&ldquo;העברה&rdquo; בעת הייבוא.
              הן מנפחות את הכרטיס &ldquo;הכנסות&rdquo; — המאזן עצמו ({formatIls(balance, { decimals: false })}) נכון, אבל הפיצול בין הכנסה להוצאה מטעה.
              פתח את <Link href={`/transactions?month=${month}`} className="font-medium underline">דף התנועות</Link>,
              מצא את התנועה הגדולה (סנן לפי הקטגוריה הרלוונטית), פתח עריכה וסמן &ldquo;זוהי העברה בין חשבונות&rdquo;.
            </p>
          </div>
        </div>
      )}

      {/* Per-purpose breakdown caption shown only in the combined view, so
          the user can validate combined-total = personal + business at a
          glance. Personal/business/household tabs skip it — their own total
          already IS the breakdown for that view. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Tile
          tone="destructive"
          label={he.dashboard.spentSoFar}
          value={formatIls(spent, { decimals: false })}
          caption={
            showBreakdown ? (
              <>
                {isCurrentMonth && (
                  <span className="block">יום {day} מתוך {daysInMonth}</span>
                )}
                <span className="block text-2xs text-muted-foreground/80 tabular-nums">
                  אישי {formatIls(Math.abs(purposeBreakdown.personal.spent), { decimals: false })}
                  {' · '}
                  עסקי {formatIls(Math.abs(purposeBreakdown.business.spent), { decimals: false })}
                  {purposeBreakdown.projects.spent !== 0 && (
                    <> {' · '} פרויקטים {formatIls(Math.abs(purposeBreakdown.projects.spent), { decimals: false })}</>
                  )}
                  {purposeBreakdown.other.spent !== 0 && (
                    <> {' · '} אחר {formatIls(Math.abs(purposeBreakdown.other.spent), { decimals: false })}</>
                  )}
                </span>
              </>
            ) : (
              isCurrentMonth ? `יום ${day} מתוך ${daysInMonth}` : undefined
            )
          }
          icon={<TrendingDown className="size-3.5" />}
          info={
            'איך החישוב עובד:\n' +
            `• סכמתי את כל התנועות עם billing_month = ${month}.\n` +
            `• נספרות תנועות ${
              view === 'combined' ? 'בכל החשבונות (משולב, ללא העברות פנימיות)' :
              view === 'personal' ? 'בחשבונות אישיים + משותפים' :
              view === 'business' ? 'בחשבונות עסקיים + משותפים' :
              /* household */ 'בכל החשבונות + תנועות פרויקטים (תזרים מלא של משק הבית, ללא העברות פנימיות)'
            }.\n` +
            '• "הוצאות" = סכום מוחלט של כל התנועות עם סכום שלילי (כסף שיצא).\n' +
            '• הקטגוריה לא משפיעה — מה שקובע זה הסימן (חיובי = הכנסה, שלילי = הוצאה).\n' +
            '• אם תייגת תנועה בקטגוריית הוצאה והסכום חיובי (החזר/זיכוי), היא תיחשב להכנסה ולא תקטין את ההוצאות.\n' +
            '• מוסטרות: תנועות מחוקות, תנועות "צפוי", ותנועות שמתויגות לפרויקט עם "הסתר מהתצוגות החודשיות".\n' +
            `\nתוצאה: ${formatIls(spent, { decimals: false })}.`
          }
        />
        <Tile
          label="הכנסות"
          value={formatIls(totalIncome, { decimals: false })}
          tone={totalIncome > 0 ? 'success' : 'neutral'}
          caption={
            showBreakdown ? (
              <span className="block text-2xs text-muted-foreground/80 tabular-nums">
                אישי {formatIls(purposeBreakdown.personal.income, { decimals: false })}
                {' · '}
                עסקי {formatIls(purposeBreakdown.business.income, { decimals: false })}
                {purposeBreakdown.projects.income !== 0 && (
                  <> {' · '} פרויקטים {formatIls(purposeBreakdown.projects.income, { decimals: false })}</>
                )}
                {purposeBreakdown.other.income !== 0 && (
                  <> {' · '} אחר {formatIls(purposeBreakdown.other.income, { decimals: false })}</>
                )}
              </span>
            ) : undefined
          }
          icon={<TrendingUp className="size-3.5" />}
          info={
            'איך החישוב עובד:\n' +
            '• "הכנסות" = סכום של כל התנועות החיוביות (כסף שנכנס).\n' +
            '• הקטגוריה לא משפיעה — מה שקובע זה הסימן.\n' +
            '• כולל: משכורת, קצבה, זיכויים, החזרים, הכנסות מהעסק.\n' +
            '• בטאב "משולב" / "משק בית" — העברות בין חשבונות שלך מוסטרות (אין כפל ספירה — אם סימנת אותן כ-isTransfer בעת הייבוא או בעריכה).\n' +
            '• בטאב "משק בית" כולל גם הכנסות שמתויגות לפרויקטים (למשל מימון משכנתא); שאר הטאבים לא.\n' +
            '• בטאב אישי / עסקי — מסונן לחשבונות מאותו סוג.\n' +
            '• מוסטרות: תנועות מחוקות, "צפוי", ופרויקטים מוסתרים (חוץ מטאב "משק בית" שכולל גם אותם).\n' +
            (suspiciousIncomeIls > 0
              ? `\n⚠️ זוהו ${formatIls(suspiciousIncomeIls, { decimals: false })} בתנועות חיוביות גדולות שמתויגות בקטגוריות הוצאה. ` +
                'לרוב אלו העברות בין החשבונות שלך שלא סומנו כ"העברה". ' +
                'מומלץ לעבור לדף תנועות, לסנן לפי קטגוריה רלוונטית, ולסמן ידנית את התנועות הללו כ"העברה".\n'
              : '') +
            `\nתוצאה: ${formatIls(totalIncome, { decimals: false })}.`
          }
        />
        <Tile
          label={he.dashboard.monthBalance}
          value={formatIls(balance, { decimals: false })}
          tone={balance >= 0 ? 'success' : 'destructive'}
          caption={
            showBreakdown ? (
              <span className="block text-2xs text-muted-foreground/80 tabular-nums">
                {/* Per-bucket balance = that bucket's income − its expenses.
                    `spent` in purposeBreakdown is the signed negative sum,
                    so income+spent yields the signed balance directly. */}
                אישי {formatIls(purposeBreakdown.personal.income + purposeBreakdown.personal.spent, { decimals: false })}
                {' · '}
                עסקי {formatIls(purposeBreakdown.business.income + purposeBreakdown.business.spent, { decimals: false })}
                {(purposeBreakdown.projects.income !== 0 || purposeBreakdown.projects.spent !== 0) && (
                  <> {' · '} פרויקטים {formatIls(purposeBreakdown.projects.income + purposeBreakdown.projects.spent, { decimals: false })}</>
                )}
                {(purposeBreakdown.other.income !== 0 || purposeBreakdown.other.spent !== 0) && (
                  <> {' · '} אחר {formatIls(purposeBreakdown.other.income + purposeBreakdown.other.spent, { decimals: false })}</>
                )}
              </span>
            ) : undefined
          }
          icon={<Wallet className="size-3.5" />}
          info={
            'איך החישוב עובד:\n' +
            'מאזן = הכנסות − הוצאות\n' +
            `\n• הכנסות החודש: ${formatIls(totalIncome, { decimals: false })}    (כסף שנכנס)\n` +
            `• הוצאות החודש: ${formatIls(spent, { decimals: false })}    (כסף שיצא)\n` +
            `• מאזן: ${formatIls(totalIncome, { decimals: false })} − ${formatIls(spent, { decimals: false })} = ${formatIls(balance, { decimals: false })}\n` +
            '\n💡 איך אנחנו מתייחסים לכרטיסי אשראי:\n' +
            '• חיוב חודשי רגיל מאשראי — לא נספר פעמיים. השורה החודשית של ' +
            'הבנק (בד"כ ב-10 לחודש) היא המקור היחיד; הפירוטים של החיובים ' +
            'בכרטיס מסומנים אוטומטית כ"מכוסה ע"י השורה החודשית".\n' +
            '• חיוב מטבע חוץ מאשראי (Forex) — כן נספר. הוא יורד מהבנק שלך ' +
            'מיידית, לא ב-10 לחודש, ולכן הוא חלק מהתזרים האמיתי.\n' +
            '• בעוגה למטה: כל הקטגוריות כלולות, כדי לראות על מה הוצאת.\n' +
            '\nמשמעות המאזן:\n' +
            '• מאזן חיובי = הוצאת פחות ממה שהרווחת (יתרה לחיסכון/חודש הבא).\n' +
            '• מאזן שלילי = הוצאת יותר ממה שהרווחת.\n' +
            '\nמוסטרות מהחישוב: תנועות מחוקות, תנועות "צפוי", תנועות מסומנות ' +
            '"אל תספור בסיכומים"' +
            (view === 'household'
              ? '. בטאב "משק בית" כלולות גם תנועות פרויקטים מוסתרים.'
              : ', ותנועות שמתויגות לפרויקט עם "הסתר מהתצוגות החודשיות".') +
            ((view === 'combined' || view === 'household')
              ? ' העברות בין חשבונות שלך מוסטרות כדי למנוע ספירה כפולה.'
              : '')
          }
        />
        <Tile
          label="יתרה מצטברת בפועל"
          value={formatIls(cumulativeBalanceIls, { decimals: false })}
          // Phase 2 brand-book: positive cumulative standing reads navy
          // (primary) — calm/informational — to distinguish it from the
          // green "מאזן החודש" celebration tone. Negative stays destructive
          // because an overdrawn cumulative position IS a critical signal.
          tone={cumulativeBalanceIls >= 0 ? 'primary' : 'destructive'}
          icon={<Banknote className="size-3.5" />}
          caption={`לסוף ${formatMonthHe(month)}`}
          info={
            (cumulativeOpeningIls === 0
              ? 'עוד לא הזנת יתרת פתיחה לאף חשבון בנק, אז המספר שאתה רואה הוא ' +
                'רק סכום כל תנועות הבנק במערכת — לא משקף את היתרה האמיתית בבנק.\n' +
                '\nאיך לתקן:\n' +
                'עבור ל"ניהול חשבונות" → ערוך כל חשבון בנק → הזן את היתרה ' +
                'הנוכחית מאתר הבנק + סמן בתאריך "היום". שמור.\n' +
                'מהרגע הזה ואילך, המערכת תדע את הנקודת ההתחלה ותדאג שהמספר ' +
                'הזה תמיד יהיה מיושר עם הבנק שלך — בכל חודש, גם אחורה וגם קדימה.\n'
              : 'זה הסיפור של החישוב לסוף ' + formatMonthHe(month) + ':\n' +
                '\nתחילת הסיפור — כשהזנת את יתרות הפתיחה בכל חשבונות הבנק שלך, ' +
                'סיכמנו את כולן ויצא:\n' +
                `   📍 יתרת פתיחה (סך כל החשבונות): ${formatIls(cumulativeOpeningIls, { decimals: false })}\n` +
                '\nמה קרה מאז — בדקנו את כל תנועות הבנק הרלוונטיות לסוף ' + formatMonthHe(month) + '. ' +
                'הסכמנו אותן (הכנסות פחות הוצאות), ויצא:\n' +
                `   ${cumulativeTxnIls >= 0 ? '➕' : '➖'} שינוי נטו: ${formatIls(cumulativeTxnIls, { decimals: false })}\n` +
                '\nהתוצאה — חיברנו את שני המספרים יחד:\n' +
                `   ${formatIls(cumulativeOpeningIls, { decimals: false })} ${cumulativeTxnIls >= 0 ? '+' : '−'} ${formatIls(Math.abs(cumulativeTxnIls), { decimals: false })} = ${formatIls(cumulativeBalanceIls, { decimals: false })}\n` +
                '\n💡 איך זה עובד לחודשים אחרים — אם תבחר חודש בעבר, המערכת מחשבת ' +
                'אחורה: לוקחת את היתרה של היום ו"מבטלת" את כל מה שהוצאת/הכנסת ' +
                'מאז ועד אז. אם תבחר חודש עתידי, היא מוסיפה קדימה. הקסם: לא צריך ' +
                'לדעת את היתרה ההיסטורית — רק את היתרה של היום.\n') +
            '\nמי לא נספר במספר הזה:\n' +
            '🚫 כרטיסי אשראי (אלה מראים חוב, לא יתרה — וחיוב חודשי כבר מתבטא בבנק)\n' +
            '🚫 תנועות מחוקות\n' +
            '🚫 תנועות "צפוי" (תזכורות לעתיד)\n' +
            '🚫 תנועות שסומנו "אל תספור בסיכומים"'
          }
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
          // Phase 2 brand-book: forecast is forward-looking → always amber
          // (warning) when current month, regardless of sign. The dashboard
          // already has green for "income/balance" and red for "expenses";
          // amber separates "look ahead" from "here and now". Future months
          // use accent (teal) for "projected/planned".
          tone={isCurrentMonth ? 'warning' : 'accent'}
          caption={
            isCurrentMonth
              ? hasEnoughDataForProjection
                ? `${daysLeft} ימים נותרו · מבוסס על ${transactionCount} תנועות`
                : `צריך ≥ 5 ימים ו-3 תנועות לתחזית`
              : projectedThisMonth > 0
                ? 'תקציב צפוי לחודש'
                : undefined
          }
          info={
            isCurrentMonth && hasEnoughDataForProjection
              ? 'איך החישוב עובד:\n' +
                '1. ממוצע יומי = סה"כ הוצאות החודש עד היום ÷ מספר הימים שעברו.\n' +
                '2. תחזית הוצאות לסוף חודש = הוצאות עד עכשיו + (ממוצע יומי × הימים שנותרו).\n' +
                '3. תחזית מאזן = הכנסות החודש − תחזית הוצאות.\n' +
                '\n' +
                'הערה: זו אקסטרפולציה לינארית פשוטה — לא מתחשבת בקצב ' +
                'משתנה במהלך החודש. הסכום מתעדכן בזמן אמת ככל שמתווספות תנועות. ' +
                'התחזית פעילה רק כשעברו ≥5 ימים בחודש ויש ≥3 תנועות (כדי לא ' +
                'לחזות על בסיס דגימה קטנה מדי).'
              : isCurrentMonth
                ? 'אין עדיין מספיק נתונים לתחזית — נציג אותה כשיהיו ≥5 ימים בחודש ' +
                  'ו-≥3 תנועות. בינתיים מוצג המאזן בפועל (הכנסות פחות הוצאות).'
                : 'סך התנועות שמסומנות "מתוכנן" לחודש שצפית — בעיקר תוכניות ' +
                  'תשלומים והוצאות קבועות שעדיין לא חוייבו.'
          }
        />
        {/* Recurring monthly — total of all active recurring patterns,
            normalised to a monthly equivalent. Caption shows what % of the
            month's income that locks in. */}
        <Tile
          label="הוצאות קבועות חודשיות"
          value={formatIls(recurringMonthlyExpense, { decimals: false })}
          tone={recurringMonthlyExpense > 0 ? 'accent' : 'neutral'}
          icon={<Repeat className="size-3.5" />}
          caption={
            totalIncome > 0
              ? `${Math.round((recurringMonthlyExpense / totalIncome) * 100)}% מההכנסות`
              : undefined
          }
          info={
            'איך החישוב עובד:\n' +
            'סכמתי את כל ההוצאות הקבועות הפעילות (תבניות status=active מ-/recurring), ' +
            'ונרמלתי כל אחת לסכום חודשי לפי תדירות:\n' +
            '• חודשי × 1\n' +
            '• דו-חודשי ÷ 2\n' +
            '• רבעוני ÷ 3\n' +
            '• שנתי ÷ 12\n' +
            '\nרק תבניות הוצאה (סכום שלילי) נספרות כאן. הכנסות קבועות (כמו ' +
            'משכורת חוזרת) מופיעות בנפרד בכרטיס "הכנסות קבועות חודשיות" ' +
            'בווידג׳ט הקבועות למטה.\n' +
            '\nההפרש בין כרטיס זה לכרטיס "הוצאות" שלמעלה: כרטיס זה מציג את ' +
            'הסכום הצפוי על-פי התבניות שהגדרת (גם אם החיוב עוד לא הופיע השבוע), ' +
            'בעוד שכרטיס ההוצאות מציג רק תנועות שכבר נקלטו בפועל החודש.\n' +
            (totalIncome > 0
              ? `\nאחוז מההכנסות: ${formatIls(recurringMonthlyExpense, { decimals: false })} ÷ ${formatIls(totalIncome, { decimals: false })} = ${Math.round((recurringMonthlyExpense / totalIncome) * 100)}%.`
              : '')
          }
        />
      </section>

      {/* ── C2: charge-date cash-flow bar ── */}
      {isCurrentMonth && (alreadyChargedIls !== 0 || pendingChargedIls !== 0) && (
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-sm"
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

      {/* The Recurring + Savings paired row was moved BELOW the
          donut/categories grid — see further down in the data-exists
          branch — so the visual reading order is: insights → category
          spend (donut + bars) → recurring vs savings → recent
          transactions. */}

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
              <DashboardChatHint />
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
                    const barColor = cat.color ?? 'hsl(var(--chart-1))';
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

          {/* ── Side-by-side row: Recurring overview (left) + Savings stack (right).
              The right column is a vertical stack of:  Savings → Projects.
              Layout chosen so the user reads top-to-bottom:
                per-category spend → fixed commitments + (savings/projects) → transactions.
              Each child self-hides when empty; wrapper renders if any have data. ── */}
          {(activeRecurringPatterns.length > 0 || activeGoals.length > 0 || activeProjects.length > 0) && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {activeRecurringPatterns.length > 0 && (
                <section className="tile space-y-4" dir="rtl">
                  {/* Header — brand book §5.5: tonal icon-badge. Recurring
                      monthly commitments map to the same accent tone as the
                      "הוצאות קבועות" KPI tile, keeping the visual identity
                      consistent across both surfaces. */}
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <Repeat className="size-3.5" />
                      </span>
                      הוצאות קבועות (תמונת מצב חודשית)
                    </h2>
                    <Link
                      href="/recurring"
                      className="text-xs text-primary hover:underline"
                      title="ניהול הוצאות קבועות"
                    >
                      ניהול ←
                    </Link>
                  </div>

                  {/* Three numbers */}
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">הוצאות חודשיות</p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums">
                        {formatIls(recurringMonthlyExpense, { decimals: false })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">הכנסות חודשיות</p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums text-success">
                        {formatIls(recurringMonthlyIncome, { decimals: false })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">תזרים נטו צפוי</p>
                      <p className={cn(
                        'mt-0.5 text-lg font-semibold tabular-nums',
                        recurringMonthlyIncome - recurringMonthlyExpense >= 0 ? 'text-success' : 'text-destructive',
                      )}>
                        {formatIls(recurringMonthlyIncome - recurringMonthlyExpense, { decimals: false })}
                      </p>
                    </div>
                  </div>

                  {/* Visual ratio bar — what % of monthly income is "locked" by
                      recurring expenses. Tone shifts as the share grows. */}
                  {recurringMonthlyIncome > 0 && (() => {
                    const pct = Math.min(100, Math.round((recurringMonthlyExpense / recurringMonthlyIncome) * 100));
                    const tone =
                      pct >= 70 ? 'bg-destructive'
                      : pct >= 50 ? 'bg-warning'
                      : 'bg-primary';
                    return (
                      <div className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-muted-foreground">חלק קבוע מההכנסות</span>
                          <span className="font-semibold tabular-nums">{pct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Top 5 biggest recurring expenses */}
                  {topRecurringExpenses.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        ההוצאות הגדולות ביותר
                      </p>
                      {/* 3-column grid: merchant | category | amount.
                          The category column gets a FIXED 7rem width so
                          every badge starts at the same horizontal
                          position across rows. justify-self-end keeps
                          the badge right-aligned within that fixed slot. */}
                      <ul className="divide-y rounded-md border">
                        {topRecurringExpenses.map((p) => {
                          const cat = p.categoryId ? catMap.get(p.categoryId) : null;
                          return (
                            <li key={p.merchantNormalized} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 px-3 py-1.5 text-sm">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{p.merchantNormalized}</div>
                                {p.description && (
                                  <div className="truncate text-[11px] text-muted-foreground" title={p.description}>
                                    {p.description}
                                  </div>
                                )}
                              </div>
                              {cat ? (
                                // justify-self-start = right edge in RTL —
                                // every badge starts at the right edge of
                                // the 7rem slot so all right-edges line
                                // up vertically, matching the user's
                                // "aligned to the right" expectation.
                                <span
                                  className="justify-self-start inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                                  style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}
                                >
                                  {cat.nameHe}
                                </span>
                              ) : <span />}
                              <span className="shrink-0 font-semibold tabular-nums justify-self-end">
                                {formatIls(Math.abs(p.monthly), { decimals: false })}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {/* Right column stack: Savings on top, Projects beneath.
                  Wrapper renders if EITHER child has data so the column
                  isn't empty when only one of the two is present. */}
              {(activeGoals.length > 0 || activeProjects.length > 0) && (
              <div className="space-y-6">
              {activeGoals.length > 0 && (
                <section className="tile space-y-4">
                  {/* header — brand book §5.5: section heading with tonal
                      icon-badge. Savings/goals = success tone (long-term
                      growth). */}
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className="inline-flex size-7 items-center justify-center rounded-full bg-success-soft text-success">
                        <PiggyBank className="size-3.5" />
                      </span>
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
                      const barColor = g.color ?? 'hsl(var(--success))';
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
              {/* Projects widget — sits directly under savings inside the
                  right column (per design illustration). */}
              {activeProjects.length > 0 && (
                <ProjectsSummaryWidget projects={activeProjects} />
              )}
              </div>
              )}
            </div>
          )}

          {/* ── Transactions strip — full width ── */}
          {/* Pass server-computed full-month totals so the strip's summary
              bar always matches the top KPI cards (otherwise it'd sum only
              the 20 displayed rows and diverge for busy months). */}
          <DashboardTransactionsSection
            transactions={dashboardTxns}
            month={month}
            totalCount={totalTxCount}
            monthTotalIncome={totalIncome}
            monthTotalExpenses={spent}
          />
        </>
      )}

      {/* When the dashboard has no monthly data (empty state branch above),
          the projects widget still needs to be visible so the user can see
          their long-running projects. Render it standalone here. */}
      {!hasData && activeProjects.length > 0 && (
        <ProjectsSummaryWidget projects={activeProjects} />
      )}
    </div>
  );
}

// ── Projects summary widget ──────────────────────────────────────────────────
function ProjectsSummaryWidget({
  projects,
}: {
  projects: Array<{
    id: string;
    name: string;
    color: string | null;
    totalBudgetIls: string | null;
    status: string;
    excludeFromMonthlyTotals: boolean;
    totalSpent: string;
    txnCount: string;
  }>;
}) {
  const grandTotal = projects.reduce((s, p) => s + Number(p.totalSpent), 0);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" dir="rtl">
      {/* Heading row — brand book §5.5 + §1: projects = accent tone (teal).
          Count chip uses .pill shape with accent-soft fill. */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Briefcase className="size-3.5" />
          </span>
          פרויקטים פעילים
          <span className="pill bg-accent-soft text-accent">
            {projects.length}
          </span>
        </h2>
        <Link href="/projects" className="text-xs text-primary hover:underline">
          ניהול ←
        </Link>
      </div>
      {/* Disclaimer banner — informational, tied to the section's accent
          tone. Tokenized — no hardcoded amber. */}
      <div className="border-b bg-accent-soft/50 px-4 py-2 text-[11px] text-accent">
        <span className="inline-flex items-center gap-1">
          <Lightbulb className="size-3 shrink-0" />
          <span>
            <strong>רוב</strong> הסכומים כאן לא נספרים בכרטיסי הוצאות / הכנסות / מאזן
            החודשיים — פרויקטים גדולים מנוהלים בנפרד כדי שלא יציפו את התזרים הרגיל.
          </span>
        </span>
        <br />
        תנועות שסומנו ב-
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-accent">
          <CalendarCheck className="size-2.5" />
          גם חודשי
        </span>
        {' '}<em>כן</em> נספרות בסיכומים החודשיים. בדף הפרויקט תראה את התווית הזו ליד כל תנועה כזו;
        אפשר להוסיף או להסיר את הסימון מכפתור
        {' '}<Pencil className="inline size-2.5 align-baseline" />{' '}
        העריכה של תנועה בפרויקט.
      </div>
      <ul className="divide-y">
        {projects.map((p) => {
          const spent = Number(p.totalSpent);
          const budget = p.totalBudgetIls ? Number(p.totalBudgetIls) : null;
          const pct = budget && budget > 0 ? Math.round((spent / budget) * 100) : null;
          const overBudget = pct !== null && pct >= 100;
          const nearBudget = pct !== null && pct >= 80 && pct < 100;
          const barColor = overBudget
            ? 'var(--destructive)'
            : nearBudget
              ? 'var(--warning)'
              : (p.color ?? 'var(--primary)');
          return (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                {p.color && (
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-sm tabular-nums">
                      <span className="font-semibold">{formatIls(spent, { decimals: false })}</span>
                      {budget !== null && (
                        <span className="text-muted-foreground text-xs">
                          {' / '}{formatIls(budget, { decimals: false })}
                          {pct !== null && (
                            <span className={cn(
                              'ms-1.5',
                              overBudget && 'text-destructive font-medium',
                              nearBudget && 'text-warning',
                            )}>
                              ({pct}%)
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </div>
                  {budget !== null && pct !== null && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
                      />
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {p.txnCount} תנועות
                  </div>
                </div>
                <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
      {projects.length > 1 && (
        <div className="flex items-center justify-between border-t bg-muted/10 px-4 py-2 text-xs">
          <span className="text-muted-foreground">סה״כ בכל הפרויקטים</span>
          <span className="font-semibold tabular-nums">
            {formatIls(grandTotal, { decimals: false })}
          </span>
        </div>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Insights
// ─────────────────────────────────────────────────────────────────────────────

type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

interface Insight {
  id: string;
  severity: InsightSeverity;
  /** Icon NAME (string), not the Lucide component itself, so the Insight
   *  payload can cross the Server → Client boundary (props to
   *  InsightDetailsToggle). Resolved to a component via INSIGHT_ICONS. */
  icon: InsightIconName;
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
  /** Sum of EXPENSE-side active recurring patterns, normalised to monthly.
   *  Used for the "recurring eats N% of income" alert. */
  recurringMonthlyExpense:  number;
}): Insight[] {
  const {
    budgetRows, prevTotals, endingPlans, activeInstallmentPlans,
    projectedEom, hasEnoughDataForProjection, totalIncome,
    isCurrentMonth, day, daysInMonth, daysLeft, month, spent,
    recurringMonthlyExpense,
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
        icon: 'AlertOctagon',
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
      icon: 'TrendingDown',
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
          icon: 'AlertTriangle',
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
          icon: 'TrendingUp',
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
          icon: 'CreditCard',
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
  // Skip the insight when we've only observed the FIRST payment (or
  // anything earlier than second-to-last). Reaching the projected end
  // date by calendar without having actually recorded the matching
  // number of payments means imports are incomplete — telling the user
  // "ending this month" when they're at payment 1/4 is misleading.
  const nextMonth = addMonths(month, 1);
  for (const plan of endingPlans) {
    const end = plan.projectedEndMonth;
    if (!end) continue;
    const endingThisMonth = end === month;
    const endingNextMonth = end === nextMonth;
    if (!(endingThisMonth || endingNextMonth)) continue;

    // Only fire when we're actually on the last or second-to-last
    // recorded payment. Without totalPayments we can't tell, so keep
    // firing (rare case for plans the user added manually w/o total).
    if (plan.totalPayments && plan.currentPaymentNo < plan.totalPayments - 1) {
      continue;
    }

    const name = plan.description ?? plan.merchantNormalized;
    // Derive THIS-MONTH's payment number from the cycle position rather
    // than from plan.currentPaymentNo (which only advances when an actual
    // payment row is imported — for the LAST payment of a plan, the file
    // showing it might not be uploaded yet, so currentPaymentNo lags).
    // For "ending this month" the position IS totalPayments by definition;
    // for "ending next month" it's totalPayments - 1.
    const positionThisMonth = endingThisMonth
      ? (plan.totalPayments ?? plan.currentPaymentNo)
      : Math.max(1, (plan.totalPayments ?? plan.currentPaymentNo + 1) - 1);
    const isLastObserved = plan.totalPayments && plan.currentPaymentNo === plan.totalPayments;
    insights.push({
      id: `ending-soon-${plan.id}`,
      severity: 'info',
      icon: 'PartyPopper',
      title: `"${name}" ${endingThisMonth ? 'מסתיים החודש' : 'מסתיים בחודש הבא'}`,
      body: `תשלום חודשי ${ils(Math.abs(Number(plan.paymentAmountIls)))} · ${plan.totalPayments ? `${positionThisMonth}/${plan.totalPayments} תשלומים` : 'תשלום אחרון'}${isLastObserved ? ' (הושלם)' : ''}`,
      explanation:
        `בדקתי תאריכי סיום צפויים של תוכניות תשלומים פעילות.\n` +
        `\n` +
        `• תוכנית: "${name}"\n` +
        `• תשלום אחרון שנקלט: ${plan.currentPaymentNo}${plan.totalPayments ? ` מתוך ${plan.totalPayments}` : ''}\n` +
        `• תשלום חודשי: ${ils(Math.abs(Number(plan.paymentAmountIls)))}\n` +
        `• תאריך סיום צפוי: ${end}\n` +
        `• חודש נוכחי: ${month}\n` +
        `\n` +
        `אחרי שהתוכנית תסתיים, ${ils(Math.abs(Number(plan.paymentAmountIls)))} ייפנו בכל חודש — הזדמנות מצוינת להוסיף ליעד חיסכון.`,
      href: '/installments',
    });
  }

  // ⑦ No income recorded past day 10 of current month
  if (isCurrentMonth && day > 10 && totalIncome === 0) {
    insights.push({
      id: 'no-income',
      severity: 'warning',
      icon: 'Wallet',
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
          icon: 'Sparkles',
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

  // ⑨ Recurring expenses eat too much of monthly income
  // Severity bumps from info → warning at 50%, warning → critical at 70%.
  if (totalIncome > 0 && recurringMonthlyExpense > 0) {
    const pct = recurringMonthlyExpense / totalIncome;
    if (pct >= 0.5) {
      const pctRound = Math.round(pct * 100);
      const severity: InsightSeverity = pct >= 0.7 ? 'critical' : 'warning';
      insights.push({
        id: 'recurring-share',
        severity,
        icon: 'Repeat',
        title: `הוצאות קבועות = ${pctRound}% מההכנסות`,
        body: `${ils(recurringMonthlyExpense)} מתוך ${ils(totalIncome)} כבר מחויבים בכל חודש`,
        explanation:
          `סכמתי את כל ההוצאות הקבועות הפעילות (תבניות חוזרות עם status='active'),\n` +
          `נירמלתי לסכום חודשי (דו-חודשי ÷ 2, רבעוני ÷ 3, שנתי ÷ 12),\n` +
          `והשוויתי לסך ההכנסות שנרשמו החודש.\n` +
          `\n` +
          `• הוצאות קבועות חודשיות: ${ils(recurringMonthlyExpense)}\n` +
          `• הכנסות החודש: ${ils(totalIncome)}\n` +
          `• יחס: ${ils(recurringMonthlyExpense)} ÷ ${ils(totalIncome)} = ${pctRound}%\n` +
          `\n` +
          `סף התראה ${pct >= 0.7 ? '70%' : '50%'} — מעל סף זה, נשאר פחות מקום בתקציב להוצאות גמישות (אוכל בחוץ, חופשות, מתנות).`,
        href: '/recurring',
      });
    }
  }

  // Sort: critical → warning → info → positive
  const ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return insights.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

// ── Severity visual config ────────────────────────────────────────────────────

// Phase 3 brand-book: each insight is its own rounded tone-soft card, no
// shared row dividers, no border-stripe. Fields:
//   cardBg        tone-soft background for the whole insight card
//   pillBg/pillText  the small severity badge in the card's end
//   iconColor     tone foreground (also applied to the icon inside the badge)
//   label         the Hebrew severity label
const SEVERITY_CFG: Record<InsightSeverity, {
  cardBg:    string;
  pillBg:    string;
  pillText:  string;
  iconColor: string;
  label:     string;
}> = {
  critical: {
    cardBg:    'bg-destructive-soft',
    pillBg:    'bg-destructive',
    pillText:  'text-primary-foreground',
    iconColor: 'text-destructive',
    label:     'קריטי',
  },
  warning: {
    cardBg:    'bg-warning-soft',
    pillBg:    'bg-warning',
    pillText:  'text-primary-foreground',
    iconColor: 'text-warning',
    label:     'שים לב',
  },
  info: {
    cardBg:    'bg-primary-soft',
    pillBg:    'bg-primary-soft',
    pillText:  'text-primary',
    iconColor: 'text-primary',
    label:     'מידע',
  },
  positive: {
    cardBg:    'bg-success-soft',
    pillBg:    'bg-success-soft',
    pillText:  'text-success',
    iconColor: 'text-success',
    label:     'חיובי',
  },
};

function InsightsWidget({ insights, month }: { insights: Insight[]; month: string }) {
  // Phase 3: each insight is its own rounded tone-soft card stacked in a
  // gap-2 column. The first insight gets a Spotlight treatment — a larger
  // icon badge, an uppercase eyebrow label, and a bigger title — to surface
  // the most important alert without a separate hero section.
  void month;

  return (
    <section className="rounded-2xl border bg-card p-4" dir="rtl">
      {/* header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {/* Brand book §5.5: tonal icon-badge on section heading. The Sparkles
            icon in primary-soft pairs the AI section with the same navy
            identity used by primary-tone KPIs. */}
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Sparkles className="size-3.5" />
          </span>
          תובנות חכמות
        </h2>
        <InsightsCatalogToggle />
      </div>

      {/* empty state */}
      {insights.length === 0 && (
        <div className="rounded-xl bg-muted/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">אין תובנות פעילות כרגע</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            לחץ על אייקון ה-<Info className="inline size-3" /> למעלה כדי לראות אילו תובנות המערכת בודקת
          </p>
        </div>
      )}

      {/* insight cards. Two visual treatments to avoid the "stack of tonal
          bars" problem when many insights fire at once:
            • Spotlight (first insight): full tone-soft card, eyebrow label,
              big 40px icon badge, larger title. Visual anchor.
            • Rest: white-background rows in a single bordered card, divided
              by hairlines. Severity is signalled by a 3px tone-colored
              start-edge stripe + tone-soft icon badge + severity pill.
              Functional and scannable — color is an accent, not a fill. */}
      {insights.length > 0 && (
        <div className="space-y-3">
          {/* Spotlight */}
          {(() => {
            const insight = insights[0];
            const cfg = SEVERITY_CFG[insight.severity];
            const Icon = INSIGHT_ICONS[insight.icon];
            const inner = (
              <div className={cn('rounded-2xl p-4 transition-all', cfg.cardBg, insight.href && 'hover:brightness-95')}>
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-card">
                    <Icon className={cn('size-5', cfg.iconColor)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[10px] font-semibold uppercase tracking-wider', cfg.iconColor)}>
                      {cfg.label}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold leading-snug">
                      <span className="min-w-0">{insight.title}</span>
                      {insight.explanation && (
                        <InsightDetailsToggle
                          title={insight.title}
                          explanation={insight.explanation}
                          iconName={insight.icon}
                          iconColorClass={cfg.iconColor}
                        />
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{insight.body}</p>
                  </div>
                  {insight.href && <ChevronLeft className="size-4 shrink-0 self-center text-muted-foreground" />}
                </div>
              </div>
            );
            return insight.href ? <Link href={insight.href}>{inner}</Link> : inner;
          })()}

          {/* Rest — compact divided list, white bg, tone signalled by edge
              stripe + small icon badge. Tighter than spotlight; lets the
              spotlight breathe and keeps the list scannable. */}
          {insights.length > 1 && (
            <div className="overflow-hidden rounded-xl border bg-card divide-y">
              {insights.slice(1).map((insight) => {
                const cfg = SEVERITY_CFG[insight.severity];
                const Icon = INSIGHT_ICONS[insight.icon];
                const inner = (
                  <div
                    className={cn(
                      'relative flex items-start gap-3 px-3 py-2.5 transition-colors',
                      insight.href && 'hover:bg-muted/40',
                    )}
                  >
                    {/* Tone-colored start-edge stripe (3px) — replaces the
                        full tone-soft fill so multiple rows don't merge into
                        a wash of color. */}
                    <span
                      className={cn(
                        'absolute inset-y-2 start-0 w-[3px] rounded-full',
                        cfg.iconColor.replace('text-', 'bg-'),
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'inline-flex size-7 shrink-0 items-center justify-center rounded-full ms-1',
                        cfg.cardBg,
                      )}
                    >
                      <Icon className={cn('size-3.5', cfg.iconColor)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium leading-snug">
                        <span className="min-w-0">{insight.title}</span>
                        {insight.explanation && (
                          <InsightDetailsToggle
                            title={insight.title}
                            explanation={insight.explanation}
                            iconName={insight.icon}
                            iconColorClass={cfg.iconColor}
                          />
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{insight.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-center">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', cfg.pillBg, cfg.pillText)}>
                        {cfg.label}
                      </span>
                      {insight.href && <ChevronLeft className="size-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                );
                return insight.href ? (
                  <Link key={insight.id} href={insight.href} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={insight.id}>{inner}</div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

