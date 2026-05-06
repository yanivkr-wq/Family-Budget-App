import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getDb, schema, activeBillingMonth, billingCycleRange } from '@fba/db';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { formatIls, formatMonthHe, formatShortDateHe, he } from '@fba/shared';
import { createTransaction } from './actions';
import { redirect } from 'next/navigation';
import { TransactionsList } from './transactions-list';
import { MonthSwitcher } from './month-switcher';
import { autoComputeChargeDate } from '@/lib/charge-date';
import { Clock, CheckCircle2, CalendarClock } from 'lucide-react';
import { ViewTabs, ViewStripe, type View } from '@/components/view-tabs';
import { readActiveView } from '@/components/view-tabs-server';

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
  searchParams: Promise<{ month?: string; view?: string; error?: string; ok?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  // `month` here is a calendar month, e.g. "2026-05"
  const month = sp.month ?? activeBillingMonth(10);
  // View tab: filters to accounts of a given purpose. Resolved from URL →
  // fba_view cookie → 'combined' default; cookie keeps the view sticky as
  // the user moves between pages.
  const view: View = await readActiveView(sp.view);
  const db = getDb();

  // Load lookup data for the form. We pull `purpose` so we can filter by view.
  const [allAccountsRaw, categories, rules] = await Promise.all([
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
  ]);

  const topCats = categories.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const subCats = categories.filter((c) => !!c.parentId);

  // ── View-tab filter ────────────────────────────────────────────────────────
  // 'shared'-purpose accounts always show in personal AND business views.
  // 'combined' = no filter at all.
  const accountFilter: string[] | null = view === 'combined'
    ? null
    : allAccountsRaw
        .filter((a) => a.purpose === view || a.purpose === 'shared')
        .map((a) => a.id);
  const noAccountsForView = accountFilter !== null && accountFilter.length === 0;
  // The form/table only show the accounts visible in the current view.
  const accounts = view === 'combined'
    ? allAccountsRaw
    : allAccountsRaw.filter((a) => a.purpose === view || a.purpose === 'shared');

  // ── Calendar-month range for the query ────────────────────────────────────
  const [y, m] = month.split('-').map(Number);
  const monthStart   = `${month}-01`;
  const daysInMonth  = new Date(y!, m!, 0).getDate(); // day-0 of next month = last day of this month
  const monthEnd     = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  /**
   * Fetch everything relevant to this calendar month:
   *   1. All transactions DATED in this month (includes days 11+ which bill next cycle)
   *   2. Carry-over: transactions billed TO this month but dated in a prior month
   */
  const txns = await db
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
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        // View-tab filter — limit to the accounts visible in the current
        // view (personal / business / combined).
        accountFilter !== null
          ? inArray(schema.transactions.accountId, accountFilter)
          : undefined,
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
  const activePlans = await db
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
      });
    }
  }

  // Inject projections at the END of the array (most recent dates first
  // already due to the orderBy). The list will sort/group naturally.
  // We tag them via `isProjected: true` on the row interface — adding
  // that flag to the row type extension below.
  const txnsWithProjections = [...txns, ...projectedTxns];

  // ── Cycle metadata ────────────────────────────────────────────────────────
  const range = billingCycleRange(month, 10);
  const cycleChargeDate     = range?.end ?? `${month}-10`;   // e.g. "2026-05-10"
  const nextCycleChargeDate = `${addMonth(month, 1)}-10`;    // e.g. "2026-06-10"
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

  const sumExp = (rows: typeof txns) =>
    rows.reduce((s, t) => (Number(t.amount) < 0 ? s + Math.abs(Number(t.amount)) : s), 0);
  const sumInc = (rows: typeof txns) =>
    rows.reduce((s, t) => (Number(t.amount) >= 0 ? s + Number(t.amount) : s), 0);

  const curExpenses  = sumExp(currentCycleTxns);
  const curIncome    = sumInc(currentCycleTxns);
  const nextExpenses = sumExp(nextCycleTxns);
  const nextIncome   = sumInc(nextCycleTxns);

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
              combined: `/transactions?view=combined&month=${month}`,
              personal: `/transactions?view=personal&month=${month}`,
              business: `/transactions?view=business&month=${month}`,
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
        curCount={currentCycleTxns.length}
        nextCycleChargeDate={nextCycleChargeDate}
        nextExpenses={nextExpenses}
        nextIncome={nextIncome}
        nextCount={nextCycleTxns.length}
      />

      <TransactionsList
        transactions={txnsWithProjections.map((t) => ({
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
        }))}
        categories={topCats.map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color }))}
        subCategories={subCats.map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color, parentId: c.parentId! }))}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
        rules={rules.map((r) => ({ id: r.id, label: r.name ?? r.pattern, categoryId: r.categoryId }))}
        billingMonth={month}
        cycleChargeDate={cycleChargeDate}
        nextCycleChargeDate={nextCycleChargeDate}
        nextMonth={nextMonth}
      />
    </div>
  );
}

// ViewTabs is now imported from @/components/view-tabs (shared with dashboard).

// ── DualCycleBanner ───────────────────────────────────────────────────────────

function DualCycleBanner({
  cycleChargeDate, cycleCharged, daysUntil,
  curExpenses, curIncome, curCount,
  nextCycleChargeDate, nextExpenses, nextIncome, nextCount,
}: {
  cycleChargeDate: string; cycleCharged: boolean; daysUntil: number;
  curExpenses: number; curIncome: number; curCount: number;
  nextCycleChargeDate: string; nextExpenses: number; nextIncome: number; nextCount: number;
}) {
  if (curCount + nextCount === 0) return null;
  const fmtDate = (d: string) => formatShortDateHe(d);

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
