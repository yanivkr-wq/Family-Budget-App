import { auth } from '@/lib/auth';
import { getDb, schema, activeBillingMonth, billingCycleRange } from '@fba/db';
import { and, desc, eq, gte, isNull, lt, lte, or } from 'drizzle-orm';
import { formatIls, formatMonthHe, formatShortDateHe, he } from '@fba/shared';
import { createTransaction } from './actions';
import { redirect } from 'next/navigation';
import { TransactionsList } from './transactions-list';
import { autoComputeChargeDate } from '@/lib/charge-date';
import { ChevronLeft, ChevronRight, Clock, CheckCircle2, CalendarClock } from 'lucide-react';

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
  searchParams: Promise<{ month?: string; error?: string; ok?: string }>;
}) {
  const session = await auth();
  const householdId = session!.user.householdId;
  const sp = await props.searchParams;
  // `month` here is a calendar month, e.g. "2026-05"
  const month = sp.month ?? activeBillingMonth(10);
  const db = getDb();

  // Load lookup data for the form
  const [accounts, categories, rules] = await Promise.all([
    db
      .select({ id: schema.accounts.id, name: schema.accounts.name, type: schema.accounts.type })
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
    })
    .from(schema.transactions)
    .leftJoin(
      schema.categoryRules,
      eq(schema.transactions.appliedRuleId, schema.categoryRules.id),
    )
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
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
  const currentCycleTxns = txns.filter(
    (t) => String(t.date) <= cycleChargeDate,
  );
  const nextCycleTxns = txns.filter(
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
        <CycleSwitcher month={month} prev={prevMonth} next={nextMonth} label={cycleLabel} />
      </header>

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
        transactions={txns.map((t) => ({
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

// ── CycleSwitcher ─────────────────────────────────────────────────────────────

function CycleSwitcher({ month, prev, next, label }: { month: string; prev: string; next: string; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm shadow-sm">
      <a href={`/transactions?month=${prev}`} className="flex items-center rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground" title={`חודש קודם: ${formatMonthHe(prev)}`}>
        <ChevronRight className="size-4" />
      </a>
      <div className="flex min-w-[9rem] flex-col items-center px-2">
        <span className="text-xs font-medium text-primary">{label}</span>
        <span className="font-semibold">{formatMonthHe(month)}</span>
      </div>
      <a href={`/transactions?month=${next}`} className="flex items-center rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground" title={`חודש הבא: ${formatMonthHe(next)}`}>
        <ChevronLeft className="size-4" />
      </a>
    </div>
  );
}

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
