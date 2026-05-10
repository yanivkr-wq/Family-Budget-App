import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getDb, schema, activeBillingMonth, billingCycleRange, isSettlementLineExpr } from '@fba/db';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { formatIls, formatMonthHe, formatShortDateHe, he } from '@fba/shared';
import { createTransaction } from './actions';
import { redirect } from 'next/navigation';
import { TransactionsList } from './transactions-list';
import { MonthSwitcher } from './month-switcher';
import { ShowTransfersToggle } from './show-transfers-toggle';
import { CcViewToggle } from './cc-view-toggle';
import { TransactionsExportButton } from './export-button';
import { InfoModalButton } from '@/components/ui/info-modal-button';
import { readActiveMonth } from '@/lib/active-month';
import { autoComputeChargeDate } from '@/lib/charge-date';
import { Clock, CheckCircle2, CalendarClock } from 'lucide-react';
import { ViewTabs, ViewStripe, type View } from '@/components/view-tabs';
import { readActiveView } from '@/components/view-tabs-server';
import { excludeHiddenProjectTxns } from '@/lib/project-filter';

export const dynamic = 'force-dynamic';

/** Shift a YYYY-MM string by `delta` months. */
function addMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  let nm = m! + delta;
  let ny = y!;
  while (nm > 12) { nm -= 12; ny++; }
  while (nm < 1)  { nm += 12; ny--; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export default async function TransactionsPage(props: {
  searchParams: Promise<{ month?: string; view?: string; error?: string; ok?: string; showTransfers?: string; ccView?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  // `month` here is a calendar month, e.g. "2026-05"
  // Resolution: URL param > fba_month cookie > activeBillingMonth(10).
  // Cookie persistence makes the active month sticky across pages.
  const month = (await readActiveMonth(sp.month)) ?? activeBillingMonth(10);
  // View tab: filters to accounts of a given purpose. Resolved from URL →
  // fba_view cookie → 'combined' default; cookie keeps the view sticky as
  // the user moves between pages.
  const view: View = await readActiveView(sp.view);
  // Cross-account transfer rows hidden by default. Pass ?showTransfers=1.
  const showTransfers = sp.showTransfers === '1';
  // Phase 6 — CC view mode. Two states:
  //   undefined / 'settlement' (DEFAULT): show settlement lines (bank-side
  //     "דיינרס -₪41K" rows), hide CC details (excluded_from_totals=true).
  //     This is the "source of truth" view; matches the canonical totals.
  //   'details': show CC details, HIDE bank-side settlement lines via
  //     pattern detection. Same totals (math invariant), different visual.
  const ccView: 'settlement' | 'details' = sp.ccView === 'details' ? 'details' : 'settlement';
  const db = getDb();

  // Load lookup data for the form. We pull `purpose` so we can filter by view.
  const [allAccountsRaw, categories, rules, projects, txnIdsWithNotificationsRaw] = await Promise.all([
    db
      .select({ id: schema.accounts.id, name: schema.accounts.name, type: schema.accounts.type, purpose: schema.accounts.purpose })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.isActive, true)))
      .orderBy(schema.accounts.name),
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.householdId, householdId))
      .orderBy(schema.categories.sortOrder),
    db
      .select({
        id: schema.categoryRules.id,
        name: schema.categoryRules.name,
        pattern: schema.categoryRules.pattern,
        categoryId: schema.categoryRules.categoryId,
      })
      .from(schema.categoryRules)
      .where(
        and(
          eq(schema.categoryRules.householdId, householdId),
          eq(schema.categoryRules.isActive, true),
        ),
      )
      .orderBy(schema.categoryRules.priority),
    // Active + paused projects for the per-row "assign to project" menu.
    // We omit completed/cancelled to keep the menu short — those projects
    // can still be reached from /projects to retag manually if needed.
    db
      .select({
        id:    schema.projects.id,
        name:  schema.projects.name,
        color: schema.projects.color,
      })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.householdId, householdId),
          // status filter happens client-side; we want both active+paused
        ),
      )
      .orderBy(schema.projects.createdAt),
    // Notification associations — which transactions have at least one
    // notification task linked to them. Drives the colored bell on each
    // row so the user can see at a glance which txns already have a
    // reminder set up. We exclude completed/cancelled tasks because those
    // no longer represent an "active" reminder relationship.
    db
      .select({ transactionId: schema.notificationTasks.transactionId })
      .from(schema.notificationTasks)
      .where(
        and(
          eq(schema.notificationTasks.householdId, householdId),
          isNotNull(schema.notificationTasks.transactionId),
          ne(schema.notificationTasks.status, 'completed'),
          ne(schema.notificationTasks.status, 'cancelled'),
        ),
      ),
  ]);
  const txnIdsWithNotifications = new Set(
    txnIdsWithNotificationsRaw
      .map((r) => r.transactionId)
      .filter((id): id is string => id !== null),
  );

  // Household contacts for the per-row "set reminder" modal recipient picker.
  const notificationContacts = await db
    .select({
      id:        schema.notificationContacts.id,
      label:     schema.notificationContacts.label,
      phoneE164: schema.notificationContacts.phoneE164,
      email:     schema.notificationContacts.email,
      isDefault: schema.notificationContacts.isDefault,
    })
    .from(schema.notificationContacts)
    .where(eq(schema.notificationContacts.householdId, householdId))
    .orderBy(schema.notificationContacts.label);

  const topCats = categories.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const subCats = categories.filter((c) => !!c.parentId);

  // ── View-tab filter ────────────────────────────────────────────────────────
  // 'shared'-purpose accounts always show in personal AND business views.
  // 'combined' and 'household' = no account filter (both show all accounts);
  // they differ only in project-row inclusion (handled below in WHERE clauses).
  const showAllAccounts = view === 'combined' || view === 'household';
  const accountFilter: string[] | null = showAllAccounts
    ? null
    : allAccountsRaw
        .filter((a) => a.purpose === view || a.purpose === 'shared')
        .map((a) => a.id);
  const noAccountsForView = accountFilter !== null && accountFilter.length === 0;
  // The form/table only show the accounts visible in the current view.
  const accounts = showAllAccounts
    ? allAccountsRaw
    : allAccountsRaw.filter((a) => a.purpose === view || a.purpose === 'shared');

  // Project-row inclusion: every view EXCEPT household hides transactions
  // tagged to a project with excludeFromMonthlyTotals=true. Household view
  // explicitly INCLUDES them so the user can audit total household cash flow
  // (regular monthly + project capex together).
  const projectFilter = view === 'household' ? undefined : excludeHiddenProjectTxns();

  // ── Calendar-month range for the query ────────────────────────────────────
  const [y, m] = month.split('-').map(Number);
  const monthStart   = `${month}-01`;
  const daysInMonth  = new Date(y!, m!, 0).getDate(); // day-0 of next month = last day of this month
  const monthEnd     = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  // Cycle dates needed early (used by the cycleBreakdownQuery below).
  const range = billingCycleRange(month, 10);
  const cycleChargeDate = range?.end ?? `${month}-10`;
  const nextCycleChargeDate = `${addMonth(month, 1)}-10`;

  /**
   * Fetch everything relevant to this calendar month:
   *   1. All transactions DATED in this month (includes days 11+ which bill next cycle)
   *   2. Carry-over: transactions billed TO this month but dated in a prior month
   */
  // Defined as a thenable here, awaited together with `activePlans` below
  // (the two reads are independent → run in parallel instead of serial).
  const txnsQuery = db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      chargeDate: schema.transactions.chargeDate,
      billingMonth: schema.transactions.billingMonth,
      amount: schema.transactions.amountIls,
      merchant: schema.transactions.merchantRaw,
      categoryId: schema.transactions.categoryId,
      subCategoryId: schema.transactions.subCategoryId,
      accountId: schema.transactions.accountId,
      isManual: schema.transactions.isManual,
      notes: schema.transactions.notes,
      appliedRuleId: schema.transactions.appliedRuleId,
      categorySource: schema.transactions.categorySource,
      ruleName: schema.categoryRules.name,
      rulePattern: schema.categoryRules.pattern,
      // Distinguishes user-created rules ('user') from AI-created
      // rules ('llm_confirmed') so the UI can show different badges:
      // blue "כלל" for user intent vs purple "AI" for auto-created.
      ruleSource: schema.categoryRules.source,
      // Installment-plan link (null for one-off transactions). When non-null,
      // we surface a "תשלום N/Y · עד MM/YY" pill on the row.
      installmentPlanId:           schema.transactions.installmentPlanId,
      installmentCurrentPaymentNo: schema.installmentPlans.currentPaymentNo,
      installmentTotalPayments:    schema.installmentPlans.totalPayments,
      installmentEndMonth:         schema.installmentPlans.projectedEndMonth,
      // Match by merchant against the user's recurring patterns. When the
      // merchant matches an active pattern, the row gets a "🔄 קבוע" badge
      // and contributes to the cycle-header recurring subtotal.
      recurringPatternId:        schema.recurringPatterns.id,
      recurringPatternFrequency: schema.recurringPatterns.frequency,
      // Forex: when the original purchase was in a non-NIS currency, we
      // keep the original amount + currency code so the row can show a
      // small "$ 20.00" badge alongside the NIS amount.
      originalAmount:   schema.transactions.originalAmount,
      originalCurrency: schema.transactions.originalCurrency,
      // Transfer-pair link — when set, this row pairs with another in a
      // different account (cross-account transfer; cancels out in cash flow).
      transferPairId: schema.transactions.transferPairId,
      // Provenance: which file did this row come from + when. Surfaced
      // in the "ייבוא" badge tooltip on /transactions so the user can
      // trace any imported row back to the upload that produced it.
      importFilename:  schema.importSessions.filename,
      importCreatedAt: schema.importSessions.committedAt,
      // Project tag (e.g. "construction") — when set AND the project has
      // excludeFromMonthlyTotals=true, the row was already filtered out
      // by the where-clause; we keep the column anyway to power the
      // per-row "assign/remove project" button + the project pill in
      // the merchant cell.
      projectId: schema.transactions.projectId,
      // Cross-account transfer flag. Passed through so the edit modal
      // reflects the correct toggle state (was previously omitted, so
      // toggling "isTransfer" off→on→off in the same session lost state).
      isTransfer: schema.transactions.isTransfer,
      // Settlement-basis flag (migration 0015). When TRUE, this row is a
      // CC detail covered by a bank-side settlement line — render it in
      // the list but skip it in the cycle-banner sum reducers below.
      excludedFromTotals: schema.transactions.excludedFromTotals,
      // Per-row computed flag: this row is a bank-side settlement line
      // (the canonical "₪41K Diners" row that pays for a whole CC cycle).
      // Used to filter the LIST visually based on the ccView toggle,
      // WITHOUT removing the row from the data set — so the cycle-banner
      // sum reducers can still count it. This preserves the math invariant:
      // both ccView modes produce the same headline total.
      isSettlementLine: sql<boolean>`(${isSettlementLineExpr()})`.as('is_settlement_line'),
      // Per-row "include in monthly" override (capex/opex split for project
      // transactions). When true, project rows are kept in monthly views
      // even though their project is excluded.
      includeInMonthlyOverride: schema.transactions.includeInMonthlyOverride,
    })
    .from(schema.transactions)
    .leftJoin(
      schema.categoryRules,
      eq(schema.transactions.appliedRuleId, schema.categoryRules.id),
    )
    .leftJoin(
      schema.installmentPlans,
      eq(schema.transactions.installmentPlanId, schema.installmentPlans.id),
    )
    .leftJoin(
      schema.importSessions,
      eq(schema.transactions.importSessionId, schema.importSessions.id),
    )
    .leftJoin(
      schema.recurringPatterns,
      and(
        eq(schema.recurringPatterns.householdId, schema.transactions.householdId),
        eq(schema.recurringPatterns.merchantNormalized, schema.transactions.merchantNormalized),
        eq(schema.recurringPatterns.status, 'active'),
      ),
    )
    // JOIN accounts — needed for the Phase 6 settlement-line detection
    // (isSettlementLineExpr filters on account.type = 'bank').
    .leftJoin(
      schema.accounts,
      eq(schema.transactions.accountId, schema.accounts.id),
    )
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        // Hide transactions tagged to a project with excludeFromMonthlyTotals=true.
        // Those live on /projects/[id] only; mixing them into the regular monthly
        // view would drown out everyday spending with one-off ₪200K transfers.
        projectFilter,
        // View-tab filter — limit to the accounts visible in the current
        // view (personal / business / combined).
        accountFilter !== null
          ? inArray(schema.transactions.accountId, accountFilter)
          : undefined,
        // Hide transfer rows by default. These are CC settlements + manually
        // marked cross-account transfers — real bank movements but not real
        // expenses. The toggle in the page header lets the user surface them.
        showTransfers ? undefined : eq(schema.transactions.isTransfer, false),
        // ccView filtering is NOT applied at the WHERE level — settlement
        // lines (counted) and CC details (excluded but still data) must
        // BOTH stay in the data set so the cycle-banner sum reducers can
        // see them. The list rendering filters them visually based on the
        // ccView toggle. See the txnsForList computation below.
        or(
          // All transactions dated in this calendar month (days 1–end, any billing month)
          and(
            gte(schema.transactions.transactionDate, monthStart),
            lte(schema.transactions.transactionDate, monthEnd),
          ),
          // Carry-over: billed to this month but dated before the 1st (prev-month transactions)
          and(
            eq(schema.transactions.billingMonth, month),
            lt(schema.transactions.transactionDate, monthStart),
          ),
        ),
      ),
    )
    .orderBy(desc(schema.transactions.transactionDate));

  // Count how many transfer rows exist in the same window — drives the
  // "(N hidden)" label on the toggle so the user knows there's something there.
  const hiddenTransfersCountQuery = db
    .select({ n: sql<string>`count(*)` })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        eq(schema.transactions.isTransfer, true),
        projectFilter,
        accountFilter !== null
          ? inArray(schema.transactions.accountId, accountFilter)
          : undefined,
        or(
          and(
            gte(schema.transactions.transactionDate, monthStart),
            lte(schema.transactions.transactionDate, monthEnd),
          ),
          and(
            eq(schema.transactions.billingMonth, month),
            lt(schema.transactions.transactionDate, monthStart),
          ),
        ),
      ),
    );

  // (Cycle breakdown for the info modal is computed in JS further down,
  // iterating the SAME currentCycleTxns/nextCycleTxns rows the headline
  // sumExp/sumInc reducers iterate. This guarantees the breakdown buckets
  // sum exactly to the headline — no server-vs-JS source-of-truth gap,
  // and projected installment rows (synthesized in JS) participate in
  // the breakdown the same way they do in the headline.)

  // Phase 6 — count what the OPPOSITE ccView mode would show that the
  // current mode is hiding. Drives the badge on the CcViewToggle.
  //
  // settlement mode → counts CC details (excluded_from_totals=true) currently hidden
  // details mode    → counts settlement lines (bank+CC pattern) currently hidden
  const hiddenCcCountQuery = db
    .select({ n: sql<string>`count(*)` })
    .from(schema.transactions)
    .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        projectFilter,
        accountFilter !== null
          ? inArray(schema.transactions.accountId, accountFilter)
          : undefined,
        ccView === 'settlement'
          ? eq(schema.transactions.excludedFromTotals, true)
          : isSettlementLineExpr(),
        or(
          and(
            gte(schema.transactions.transactionDate, monthStart),
            lte(schema.transactions.transactionDate, monthEnd),
          ),
          and(
            eq(schema.transactions.billingMonth, month),
            lt(schema.transactions.transactionDate, monthStart),
          ),
        ),
      ),
    );

  // ── Projected installment payments ────────────────────────────────────────
  //
  // Each active installment_plan represents a multi-month obligation
  // (e.g., ג'ון ברייס: 4 payments of ₪1,106 from Feb→May 2026). When the
  // user only imported the file containing payment 1, payments 2/3/4
  // never appear on /transactions for those months until they upload the
  // matching CC files later — which makes cash-flow projection wrong.
  //
  // Solution: synthesize projected rows on-the-fly here. For each active
  // plan, work out the expected billing month for each remaining payment.
  // If the current view's month matches AND no real transaction exists
  // for that plan in that month, add a projected row (isProjected=true).
  // The list renders these with a "צפוי" badge + reduced opacity so the
  // user can tell them apart from real charges.
  const activePlansQuery = db
    .select({
      id: schema.installmentPlans.id,
      accountId: schema.installmentPlans.accountId,
      merchantNormalized: schema.installmentPlans.merchantNormalized,
      description: schema.installmentPlans.description,
      paymentAmountIls: schema.installmentPlans.paymentAmountIls,
      totalPayments: schema.installmentPlans.totalPayments,
      currentPaymentNo: schema.installmentPlans.currentPaymentNo,
      startMonth: schema.installmentPlans.startMonth,
      projectedEndMonth: schema.installmentPlans.projectedEndMonth,
    })
    .from(schema.installmentPlans)
    .where(and(
      eq(schema.installmentPlans.householdId, householdId),
      eq(schema.installmentPlans.status, 'active'),
      accountFilter !== null
        ? inArray(schema.installmentPlans.accountId, accountFilter)
        : undefined,
    ));

  // Resolve all reads concurrently.
  const [txns, activePlans, hiddenTransfersCountRows, hiddenCcCountRows] = await Promise.all([
    txnsQuery,
    activePlansQuery,
    hiddenTransfersCountQuery,
    hiddenCcCountQuery,
  ]);
  const hiddenTransfersCount = Number(hiddenTransfersCountRows[0]?.n ?? 0);
  const hiddenCcCount = Number(hiddenCcCountRows[0]?.n ?? 0);
  // (cycleBreakdown is computed in JS further down — see buildBreakdown.)

  // Look up the most-recent real transaction per plan so the projected
  // row can inherit its category (one less unknown for the user).
  const planCategoryHints = new Map<string, { categoryId: string | null; subCategoryId: string | null }>();
  for (const t of txns) {
    if (t.installmentPlanId && !planCategoryHints.has(t.installmentPlanId)) {
      planCategoryHints.set(t.installmentPlanId, {
        categoryId: t.categoryId,
        subCategoryId: t.subCategoryId,
      });
    }
  }

  type TxnRow = typeof txns[number];
  const projectedTxns: TxnRow[] = [];
  for (const plan of activePlans) {
    if (!plan.totalPayments) continue;
    // Only project payments that haven't been recorded yet — anything
    // up to currentPaymentNo is already in the file (or earlier files).
    for (let n = plan.currentPaymentNo + 1; n <= plan.totalPayments; n++) {
      const paymentMonth = addMonth(plan.startMonth, n - 1);
      if (paymentMonth !== month) continue; // not in the view's billing month

      // Skip if a real transaction for this plan already exists in this
      // billing month (handles re-imports and edge cases gracefully).
      const realExists = txns.some((t) =>
        t.installmentPlanId === plan.id && t.billingMonth === paymentMonth,
      );
      if (realExists) continue;

      const hints = planCategoryHints.get(plan.id);
      // Synth charge_date = the 10th of the billing month (Israeli CC
      // convention). transaction_date = same — projections don't have a
      // real purchase date, so we use the charge date as a placeholder.
      const synthDate = `${paymentMonth}-10`;
      projectedTxns.push({
        ...({} as TxnRow), // satisfy TS — we override every field below
        id:           `projected-${plan.id}-${n}`,
        date:         synthDate,
        chargeDate:   synthDate,
        billingMonth: paymentMonth,
        amount:       String(-Math.abs(Number(plan.paymentAmountIls))),
        merchant:     plan.description ?? plan.merchantNormalized,
        categoryId:   hints?.categoryId ?? null,
        subCategoryId: hints?.subCategoryId ?? null,
        accountId:    plan.accountId ?? '',
        isManual:     false,
        notes:        `תשלום ${n} מתוך ${plan.totalPayments} (צפוי — טרם נקלט)`,
        appliedRuleId:     null,
        categorySource:    null,
        ruleName:          null,
        rulePattern:       null,
        installmentPlanId:           plan.id,
        installmentCurrentPaymentNo: n,
        installmentTotalPayments:    plan.totalPayments,
        installmentEndMonth:         plan.projectedEndMonth,
        recurringPatternId:        null,
        recurringPatternFrequency: null,
        originalAmount:   null,
        originalCurrency: null,
        transferPairId:   null,
        importFilename:   null,
        importCreatedAt:  null,
        projectId:        null,
        isTransfer:       false,
        excludedFromTotals: false,
        // Synthesized projection rows are never settlement lines (those
        // come from bank statements; projections are forward-looking
        // installment forecasts).
        isSettlementLine: false,
        includeInMonthlyOverride: false,
      });
    }
  }

  // Inject projections at the END of the array (most recent dates first
  // already due to the orderBy). The list will sort/group naturally.
  // We tag them via `isProjected: true` on the row interface — adding
  // that flag to the row type extension below.
  const txnsWithProjections = [...txns, ...projectedTxns];

  // ── ccView render-time filter ─────────────────────────────────────────────
  // The cycle banner sum reducers run on the FULL set above (so settlement
  // lines, CC details, etc. all stay accounted for). The user-visible LIST
  // filters per the toggle:
  //   • settlement (default) → hide CC details (excluded_from_totals=true)
  //   • details              → hide bank-side settlement lines (isSettlementLine)
  // Same total either way — only what's visible changes.
  const txnsForList = txnsWithProjections.filter((t) => {
    if (ccView === 'settlement') return !t.excludedFromTotals;
    /* details */ return !t.isSettlementLine;
  });

  // ── Cycle metadata ────────────────────────────────────────────────────────
  // (cycleChargeDate + nextCycleChargeDate already computed at line ~125
  // because the breakdown query needs them before this point.)
  const todayStr            = new Date().toISOString().slice(0, 10);
  const isCycleCharged      = cycleChargeDate <= todayStr;
  const daysUntilCharge     = isCycleCharged
    ? 0
    : Math.round(
        (new Date(cycleChargeDate + 'T12:00:00').getTime() -
          new Date(todayStr + 'T12:00:00').getTime()) /
          (1000 * 60 * 60 * 24),
      );

  // ── Totals split by cycle ─────────────────────────────────────────────────
  // Current cycle = carry-over (date < monthStart) + days 1-10 (date <= cycleChargeDate)
  // Next cycle    = days 11+ (date > cycleChargeDate)
  // Includes projected installment payments so the user sees the full
  // expected outflow, not just what's been imported so far.
  const currentCycleTxns = txnsWithProjections.filter(
    (t) => String(t.date) <= cycleChargeDate,
  );
  const nextCycleTxns = txnsWithProjections.filter(
    (t) => String(t.date) > cycleChargeDate,
  );

  // Sum reducers skip rows where excluded_from_totals=true (CC detail rows
  // covered by their bank-side settlement) and rows where is_transfer=true
  // (cross-account transfers). The cycle banner totals always reflect the
  // settlement-basis truth regardless of which rows are visible in the list.
  const sumExp = (rows: typeof txns) =>
    rows.reduce(
      (s, t) =>
        t.excludedFromTotals || t.isTransfer
          ? s
          : Number(t.amount) < 0 ? s + Math.abs(Number(t.amount)) : s,
      0,
    );
  const sumInc = (rows: typeof txns) =>
    rows.reduce(
      (s, t) =>
        t.excludedFromTotals || t.isTransfer
          ? s
          : Number(t.amount) >= 0 ? s + Number(t.amount) : s,
      0,
    );

  const curExpenses  = sumExp(currentCycleTxns);
  const curIncome    = sumInc(currentCycleTxns);
  const nextExpenses = sumExp(nextCycleTxns);
  const nextIncome   = sumInc(nextCycleTxns);
  // Cycle row counts use the SAME filter the reducers do — so "29 עסקאות"
  // means "29 rows that contributed to the displayed totals", not "29
  // including hidden settlement-basis duplicates".
  const cycleCountFilter = (t: typeof txns[number]) => !t.isTransfer && !t.excludedFromTotals;
  const curCount  = currentCycleTxns.filter(cycleCountFilter).length;
  const nextCount = nextCycleTxns.filter(cycleCountFilter).length;

  // ── Breakdown buckets — JS-side computation ───────────────────────────────
  // CRITICAL: iterate the SAME rows the sumExp/sumInc reducers iterate
  // (currentCycleTxns / nextCycleTxns, which include synthesized projected
  // installment rows). This guarantees the breakdown buckets always sum
  // exactly to the headline — no server-vs-JS source-of-truth gap.
  function buildBreakdown(rows: typeof currentCycleTxns) {
    const b = {
      regularExpN: 0, regularExpSum: 0,
      settlementN: 0, settlementSum: 0,
      forexN:      0, forexSum:      0,
      excludedCcN: 0, excludedCcSum: 0,
      transferN:   0, transferSum:   0,
      incomeN:     0, incomeSum:     0,
    };
    for (const t of rows) {
      const amt = Number(t.amount);
      const abs = Math.abs(amt);
      // Mutually exclusive bucketing (same precedence the headline uses)
      if (t.isTransfer) {
        b.transferN++; b.transferSum += abs;
        continue;
      }
      if (t.excludedFromTotals) {
        b.excludedCcN++; b.excludedCcSum += abs;
        continue;
      }
      if (amt < 0) {
        const isForex = t.originalCurrency != null && t.originalCurrency !== 'ILS';
        if (t.isSettlementLine) {
          b.settlementN++; b.settlementSum += abs;
        } else if (isForex) {
          b.forexN++; b.forexSum += abs;
        } else {
          b.regularExpN++; b.regularExpSum += abs;
        }
      } else if (amt > 0) {
        b.incomeN++; b.incomeSum += amt;
      }
    }
    return b;
  }
  const cycleBreakdown = {
    current: buildBreakdown(currentCycleTxns),
    next:    buildBreakdown(nextCycleTxns),
  };

  // Navigation
  const prevMonth       = addMonth(month, -1);
  const nextMonth       = addMonth(month, 1);
  const curBillingMonth = activeBillingMonth(10);
  const cycleLabel =
    month === curBillingMonth ? 'חודש נוכחי' :
    month > curBillingMonth   ? 'חודש הבא'   :
    'חודש קודם';

  // Server action wrapper
  async function addAction(formData: FormData) {
    'use server';
    const result = await createTransaction(formData);
    if (!result.ok) {
      const m = String(formData.get('billingMonthHint') ?? activeBillingMonth(10));
      const sp = new URLSearchParams({ month: m, error: result.error ?? 'unknown' });
      redirect(`/transactions?${sp.toString()}`);
    }
  }

  return (
    <div className="space-y-6">
      {/* 2px colored stripe — anchors which view (אישי/עסקי/משולב) is active. */}
      <ViewStripe view={view} />

      {/* ── Page header ── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{he.nav.transactions}</h1>
          <p className="text-sm text-muted-foreground">
            {formatMonthHe(month)}
            {range && (
              <span className="ms-2 text-xs text-muted-foreground/60">
                ({formatShortDateHe(range.start)} – {formatShortDateHe(range.end)})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ViewTabs
            current={view}
            hrefs={{
              combined:  `/transactions?view=combined&month=${month}`,
              personal:  `/transactions?view=personal&month=${month}`,
              business:  `/transactions?view=business&month=${month}`,
              household: `/transactions?view=household&month=${month}`,
            }}
          />
          <MonthSwitcher
            month={month}
            view={view}
            prev={prevMonth}
            next={nextMonth}
            label={cycleLabel}
            activeMonth={activeBillingMonth(10)}
          />
          {/* The two toggles (showTransfers, ccView) used to live here in
              the page header. They moved DOWN into the TransactionsFilter
              row so all list-affecting controls sit on one band, and the
              header stays focused on view + month navigation. */}
        </div>
      </header>

      {noAccountsForView && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
          אין חשבונות מסוג <strong>{view === 'business' ? 'עסקי' : 'אישי'}</strong>. כדי שתצוגה זו תציג נתונים, פתח חשבון מסוג זה תחת{' '}
          <Link href="/admin/accounts" className="underline">חשבונות</Link>.
        </div>
      )}

      {sp.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      {/* ── Add transaction form ── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-base font-semibold">{he.transaction.addManual}</h2>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <form id="add-tx-form" action={addAction} className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <input type="hidden" name="billingMonthHint" value={month} />
          <Field label={he.transaction.date} required>
            <input
              type="date"
              name="transactionDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="תאריך חיוב">
            <input
              type="date"
              name="chargeDate"
              defaultValue={autoComputeChargeDate(new Date().toISOString().slice(0, 10)) ?? ''}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              title="מחושב אוטומטית לפי כלל העשירי. ניתן לשנות ידנית."
            />
          </Field>
          <script dangerouslySetInnerHTML={{ __html: `(function(){
  var f=document.getElementById('add-tx-form');
  if(!f)return;
  var d=f.querySelector('[name="transactionDate"]'), c=f.querySelector('[name="chargeDate"]');
  if(!d||!c)return;
  function calc(s){if(!s)return '';var p=s.split('-').map(Number),y=p[0],m=p[1],day=p[2],cut=10;if(day<=cut)return y+'-'+String(m).padStart(2,'0')+'-'+String(cut).padStart(2,'0');var nm=m===12?1:m+1,ny=m===12?y+1:y;return ny+'-'+String(nm).padStart(2,'0')+'-'+String(cut).padStart(2,'0');}
  d.addEventListener('change',function(){c.value=calc(d.value);});
})();` }} />
          <Field label={he.transaction.merchant} required className="col-span-2">
            <input type="text" name="merchantRaw" required maxLength={200} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label={he.transaction.amount} required>
            <input type="number" name="amountIls" step="0.01" required className="w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums" />
          </Field>
          <Field label="סוג">
            <select name="sign" defaultValue="expense" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              <option value="expense">הוצאה</option>
              <option value="income">הכנסה</option>
            </select>
          </Field>
          <Field label={he.transaction.account}>
            <select name="accountId" defaultValue="" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              <option value="">ידני (אוטומטי)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label={he.transaction.category} className="col-span-2 md:col-span-2">
            <select name="categoryId" defaultValue="" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              <option value="">— ללא —</option>
              {topCats.map((c) => (
                <option key={c.id} value={c.id}>{c.nameHe}</option>
              ))}
            </select>
          </Field>
          <Field label={he.transaction.notes} className="col-span-2 md:col-span-3">
            <input type="text" name="notes" maxLength={2000} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
          </Field>
          <div className="col-span-2 flex items-end md:col-span-1">
            <button type="submit" className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {he.common.save}
            </button>
          </div>
        </form>
      </section>

      {/* ── Dual-cycle summary banner — sits between add-form and the table ── */}
      <DualCycleBanner
        cycleChargeDate={cycleChargeDate}
        cycleCharged={isCycleCharged}
        daysUntil={daysUntilCharge}
        curExpenses={curExpenses}
        curIncome={curIncome}
        curCount={curCount}
        curBreakdown={cycleBreakdown.current}
        nextCycleChargeDate={nextCycleChargeDate}
        nextExpenses={nextExpenses}
        nextIncome={nextIncome}
        nextCount={nextCount}
        nextBreakdown={cycleBreakdown.next}
      />

      <TransactionsList
        transactions={txnsForList.map((t) => ({
          id: t.id,
          date: t.date,
          chargeDate: t.chargeDate,
          amount: Number(t.amount),
          merchant: t.merchant,
          categoryId: t.categoryId,
          subCategoryId: t.subCategoryId,
          accountId: t.accountId,
          notes: t.notes,
          appliedRuleId: t.appliedRuleId,
          categorySource: t.categorySource,
          ruleName: t.ruleName ?? t.rulePattern ?? null,
          ruleSource: t.ruleSource ?? null,
          isManual: t.isManual,
          installmentPlanId:           t.installmentPlanId,
          installmentCurrentPaymentNo: t.installmentCurrentPaymentNo,
          installmentTotalPayments:    t.installmentTotalPayments,
          installmentEndMonth:         t.installmentEndMonth,
          recurringPatternId:        t.recurringPatternId,
          recurringPatternFrequency: t.recurringPatternFrequency,
          originalAmount:   t.originalAmount !== null ? Number(t.originalAmount) : null,
          originalCurrency: t.originalCurrency,
          transferPairId:   t.transferPairId,
          importFilename:   t.importFilename,
          importCreatedAt:  t.importCreatedAt ? t.importCreatedAt.toISOString() : null,
          // True for the synthesized projection rows; identifies them in
          // the list so we can render with reduced opacity + "צפוי" badge.
          isProjected:      String(t.id).startsWith('projected-'),
          projectId:        t.projectId,
          isTransfer:       t.isTransfer,
          includeInMonthlyOverride: t.includeInMonthlyOverride,
        }))}
        categories={topCats.map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color }))}
        subCategories={subCats.map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color, parentId: c.parentId! }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
        rules={rules.map((r) => ({ id: r.id, label: r.name ?? r.pattern, categoryId: r.categoryId }))}
        projects={projects}
        billingMonth={month}
        cycleChargeDate={cycleChargeDate}
        nextCycleChargeDate={nextCycleChargeDate}
        nextMonth={nextMonth}
        txnIdsWithNotifications={Array.from(txnIdsWithNotifications)}
        notificationContacts={notificationContacts}
        filterExtraControls={
          <>
            <ShowTransfersToggle active={showTransfers} hiddenCount={hiddenTransfersCount} />
            <CcViewToggle active={ccView === 'details'} hiddenCount={hiddenCcCount} />
            <TransactionsExportButton billingMonth={month} />
          </>
        }
      />
    </div>
  );
}

// ViewTabs is now imported from @/components/view-tabs (shared with dashboard).

// ── DualCycleBanner ───────────────────────────────────────────────────────────

interface CycleBreakdown {
  regularExpN: number; regularExpSum: number;
  settlementN: number; settlementSum: number;
  forexN: number; forexSum: number;
  excludedCcN: number; excludedCcSum: number;
  transferN: number; transferSum: number;
  incomeN: number; incomeSum: number;
}

function DualCycleBanner({
  cycleChargeDate, cycleCharged, daysUntil,
  curExpenses, curIncome, curCount, curBreakdown,
  nextCycleChargeDate, nextExpenses, nextIncome, nextCount, nextBreakdown,
}: {
  cycleChargeDate: string; cycleCharged: boolean; daysUntil: number;
  curExpenses: number; curIncome: number; curCount: number; curBreakdown: CycleBreakdown;
  nextCycleChargeDate: string; nextExpenses: number; nextIncome: number; nextCount: number; nextBreakdown: CycleBreakdown;
}) {
  if (curCount + nextCount === 0) return null;
  const fmtDate = (d: string) => formatShortDateHe(d);
  const fmtIls = (n: number) => formatIls(n, { decimals: false });

  // Build a row-level breakdown for the info modal. Tells the user EXACTLY
  // which rows contributed to the cycle's expense total and which rows
  // were excluded. Critical for "validate the math" / debug-confidence.
  function buildBreakdownText(label: string, chargeDate: string, b: CycleBreakdown, expenses: number, income: number): string {
    return `─── חישוב מפורט עבור ${label} (${fmtDate(chargeDate)}) ───

הוצאות (${fmtIls(expenses)}) = סכום של:
  • ${b.regularExpN} תנועות בנק רגילות: ${fmtIls(b.regularExpSum)}
  • ${b.settlementN} חיובי כרטיס אשראי מצרפיים בעו״ש: ${fmtIls(b.settlementSum)}
  • ${b.forexN} תנועות במטבע זר (CC, חיוב מיידי): ${fmtIls(b.forexSum)}

הכנסות (${fmtIls(income)}) = ${b.incomeN} תנועות נכנסות

לא נכלל בחישוב:
  • ${b.excludedCcN} שורות פירוט אשראי (${fmtIls(b.excludedCcSum)}) — מכוסות על ידי שורת חיוב מצרפי בבנק
  • ${b.transferN} העברות בין חשבונות (${fmtIls(b.transferSum)}) — לא מייצגות הוצאה אמיתית`;
  }

  // Explanations for the "i" icons. Centralized here so the wording stays
  // consistent and matches the actual math in page.tsx (lines ~398-418).
  const currentInfo = `מה זה: סיכום למחזור החיוב הנוכחי — מה שיירד מחשבון הבנק בתאריך ${fmtDate(cycleChargeDate)}.

איך מחשבים:
• כוללים את כל התנועות שתאריך הביצוע שלהן ≤ ${fmtDate(cycleChargeDate)} — כולל ה"גרירה" מהחודש הקודם.
• הוצאות = סכום ה|סכומים השליליים| (יציאות מהחשבון), לא כולל פירוטי אשראי שמכוסים על ידי שורת חיוב מצרפי.
• הכנסות = סכום הסכומים החיוביים.

${buildBreakdownText('המחזור הנוכחי', cycleChargeDate, curBreakdown, curExpenses, curIncome)}

מה לא כלול: העברות בין חשבונות (מוסתרות כברירת מחדל) ופרויקטים מוסתרים.

⚠️ שים לב: בעמוד /insights החישוב מחמיר יותר (רק קטגוריות הכנסה נחשבות הכנסה).`;

  const nextInfo = `מה זה: סיכום למחזור החיוב הבא — מה שיירד מחשבון הבנק בתאריך ${fmtDate(nextCycleChargeDate)}.

איך מחשבים: תנועות שתאריך הביצוע שלהן > ${fmtDate(cycleChargeDate)} — שבוצעו אחרי תאריך החיוב של המחזור הנוכחי.

${buildBreakdownText('המחזור הבא', nextCycleChargeDate, nextBreakdown, nextExpenses, nextIncome)}

לשם מה: תחזית מה שיירד מהבנק בעוד כמה שבועות. עוזר לתכנן תזרים מזומנים.`;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {/* Current cycle */}
      <div className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm ${
        cycleCharged
          ? 'border-success/30 bg-success/5'
          : 'border-amber-300/50 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/10'
      }`}>
        <div className={`flex items-center gap-1.5 font-medium ${cycleCharged ? 'text-success' : 'text-amber-800 dark:text-amber-300'}`}>
          {cycleCharged
            ? <><CheckCircle2 className="size-4 shrink-0" /><span>חויב ב-{fmtDate(cycleChargeDate)}</span></>
            : <><Clock className="size-4 shrink-0" /><span>יחויב ב-{fmtDate(cycleChargeDate)}{daysUntil > 0 && <span className="ms-1 text-xs font-normal opacity-70">(עוד {daysUntil} {daysUntil === 1 ? 'יום' : 'ימים'})</span>}</span></>
          }
          <InfoModalButton title={`מחזור חיוב — ${fmtDate(cycleChargeDate)}`} body={currentInfo} />
        </div>
        <div className="flex gap-3 tabular-nums text-xs text-muted-foreground">
          {curExpenses > 0 && <span>הוצאות: <strong className="text-foreground">{formatIls(curExpenses, { decimals: false })}</strong></span>}
          {curIncome  > 0 && <span className="text-success">הכנסות: <strong>{formatIls(curIncome, { decimals: false })}</strong></span>}
          <span>{curCount} עסקאות</span>
        </div>
      </div>

      {/* Next cycle */}
      {nextCount > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-blue-200/60 bg-blue-50/40 px-4 py-3 text-sm dark:border-blue-800/40 dark:bg-blue-900/10">
          <div className="flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
            <CalendarClock className="size-4 shrink-0" />
            <span>חיוב הבא — {fmtDate(nextCycleChargeDate)}</span>
            <InfoModalButton title={`מחזור חיוב הבא — ${fmtDate(nextCycleChargeDate)}`} body={nextInfo} />
          </div>
          <div className="flex gap-3 tabular-nums text-xs text-muted-foreground">
            {nextExpenses > 0 && <span>הוצאות: <strong className="text-foreground">{formatIls(nextExpenses, { decimals: false })}</strong></span>}
            {nextIncome  > 0 && <span className="text-success">הכנסות: <strong>{formatIls(nextIncome, { decimals: false })}</strong></span>}
            <span>{nextCount} עסקאות</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({ label, children, className, required }: { label: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${className ?? ''}`}>
      <span>{label}{required && <span className="text-destructive"> *</span>}</span>
      {children}
    </label>
  );
}
