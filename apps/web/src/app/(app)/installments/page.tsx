import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, eq, count, sql } from 'drizzle-orm';
import { formatIls } from '@fba/shared';
import { CreditCard, Layers, TrendingDown, CalendarCheck } from 'lucide-react';
import { Tile } from '@/components/ui/tile';
import { InstallmentsList } from './installments-list';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────

export default async function InstallmentsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;

  // Three independent reads → run them all in parallel.
  const [plans, txCounts, accounts] = await Promise.all([
    db
      .select({
        id:                schema.installmentPlans.id,
        merchantNormalized:schema.installmentPlans.merchantNormalized,
        description:       schema.installmentPlans.description,
        paymentAmountIls:  schema.installmentPlans.paymentAmountIls,
        totalPayments:     schema.installmentPlans.totalPayments,
        currentPaymentNo:  schema.installmentPlans.currentPaymentNo,
        startMonth:        schema.installmentPlans.startMonth,
        projectedEndMonth: schema.installmentPlans.projectedEndMonth,
        actualEndMonth:    schema.installmentPlans.actualEndMonth,
        accountId:         schema.installmentPlans.accountId,
        status:            schema.installmentPlans.status,
        notes:             schema.installmentPlans.notes,
        accountName:       schema.accounts.name,
      })
      .from(schema.installmentPlans)
      .leftJoin(
        schema.accounts,
        eq(schema.installmentPlans.accountId, schema.accounts.id),
      )
      .where(eq(schema.installmentPlans.householdId, householdId))
      .orderBy(schema.installmentPlans.status, schema.installmentPlans.startMonth),

    // Linked transaction counts per plan.
    db
      .select({
        installmentPlanId: schema.transactions.installmentPlanId,
        cnt:               count(),
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          sql`${schema.transactions.installmentPlanId} IS NOT NULL`,
        ),
      )
      .groupBy(schema.transactions.installmentPlanId),

    // Accounts for the add/edit modal.
    db
      .select({ id: schema.accounts.id, name: schema.accounts.name })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.isActive, true)))
      .orderBy(schema.accounts.name),
  ]);

  const txCountMap = new Map(txCounts.map((r) => [r.installmentPlanId!, Number(r.cnt)]));

  // ── Derive status from the data ──────────────────────────────────────────
  // The DB `status` column is the canonical store, but it can drift: a plan
  // can be edited directly (via the modal) to currentPaymentNo == totalPayments
  // while leaving status='active'. The "advance payment" action auto-completes
  // when reaching the final payment, but the modal/import paths don't.
  //
  // To keep the UI honest, we treat any active plan with currentPaymentNo >=
  // totalPayments as COMPLETE for display purposes. The summary tiles, filter
  // tabs, table status badge, and sort all read this derived value.
  //
  // The DB heals itself the next time a user edits or bulk-updates such a
  // plan — see the auto-complete logic in actions.ts.
  const isFullyPaid = (p: typeof plans[number]) =>
    p.totalPayments !== null && p.currentPaymentNo >= p.totalPayments;
  const derivedStatus = (p: typeof plans[number]): 'active' | 'complete' | 'cancelled' => {
    if (p.status === 'cancelled') return 'cancelled';
    if (p.status === 'complete') return 'complete';
    return isFullyPaid(p) ? 'complete' : 'active';
  };

  // ── Summary stats ────────────────────────────────────────────────────────
  const active    = plans.filter((p) => derivedStatus(p) === 'active');
  const complete  = plans.filter((p) => derivedStatus(p) === 'complete');

  // Monthly commitment = sum of active payment amounts
  const monthlyCommitment = active.reduce((s, p) => s + Math.abs(Number(p.paymentAmountIls)), 0);

  // Total remaining across all active plans.
  // currentPaymentNo = payments made so far. Remaining = total - current.
  // (Was off by +1 — counted the current payment AGAIN even though it's done.)
  const totalRemaining = active.reduce((s, p) => {
    const rem = p.totalPayments
      ? Math.max(0, p.totalPayments - p.currentPaymentNo)
      : null;
    return rem !== null ? s + rem * Math.abs(Number(p.paymentAmountIls)) : s;
  }, 0);

  // Soonest UPCOMING end month among active plans with known total.
  // We deliberately exclude projected ends that have already passed — a
  // stuck plan whose projected_end is months in the past shouldn't be
  // surfaced as "closest to completion"; that's misleading. If every
  // active plan is past its projected end (all stuck), show "—".
  const currentYm = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit',
  }).format(new Date()).slice(0, 7); // YYYY-MM
  const endMonths = active
    .map((p) => p.projectedEndMonth)
    .filter((m): m is string => !!m && m >= currentYm)
    .sort();
  const soonestEnd = endMonths[0] ?? null;

  // ── Build enriched plan list for client ───────────────────────────────────
  // Pass derived status (not raw DB status) — the list uses it for the badge,
  // filter tabs, and sort. Bulk-status actions still write to the DB column;
  // the read path just re-derives on next render.
  const enriched = plans.map((p) => ({
    ...p,
    paymentAmountIls: String(p.paymentAmountIls),
    accountName:      p.accountName ?? null,
    txCount:          txCountMap.get(p.id) ?? 0,
    status:           derivedStatus(p),
  }));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">תשלומים</h1>
        <p className="text-sm text-muted-foreground">ניהול תוכניות תשלומים חודשיים</p>
      </header>

      {/* ── Summary tiles — brand book §5.1: shared <Tile /> gives the
            tonal icon-badge + tone-colored number for free. ── */}
      {plans.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            tone="primary"
            icon={<CreditCard className="size-3.5" />}
            label="הוצאה חודשית פעילה"
            value={formatIls(monthlyCommitment, { decimals: false })}
            caption={`${active.length} תוכניות פעילות`}
          />
          <Tile
            tone="destructive"
            icon={<TrendingDown className="size-3.5" />}
            label="סה״כ נותר לתשלום"
            value={totalRemaining > 0 ? formatIls(totalRemaining, { decimals: false }) : '—'}
            caption="בכל התוכניות הפעילות"
          />
          <Tile
            tone="success"
            icon={<CalendarCheck className="size-3.5" />}
            label="הושלמו"
            value={String(complete.length)}
            caption="תוכניות שסיימנו"
          />
          <Tile
            tone="neutral"
            icon={<Layers className="size-3.5" />}
            label="הסתיימות קרובה"
            value={soonestEnd ? formatMonth(soonestEnd) : '—'}
            caption="תוכנית פעילה הקרובה ביותר לסיום"
          />
        </div>
      )}

      {/* ── Interactive list ── */}
      <InstallmentsList plans={enriched} accounts={accounts} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function formatMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${HE_MONTHS[(m ?? 1) - 1]} ${y}`;
}

