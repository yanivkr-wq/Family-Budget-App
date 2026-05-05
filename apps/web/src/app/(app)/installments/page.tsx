import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, eq, count, sql } from 'drizzle-orm';
import { formatIls } from '@fba/shared';
import { CreditCard, Layers, TrendingDown, CalendarCheck } from 'lucide-react';
import { InstallmentsList } from './installments-list';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────

export default async function InstallmentsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;

  // ── Fetch plans with account name + linked transaction count ──────────────
  const plans = await db
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
    .orderBy(schema.installmentPlans.status, schema.installmentPlans.startMonth);

  // ── Linked transaction counts per plan ────────────────────────────────────
  const txCounts = await db
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
    .groupBy(schema.transactions.installmentPlanId);

  const txCountMap = new Map(txCounts.map((r) => [r.installmentPlanId!, Number(r.cnt)]));

  // ── Accounts for the add/edit modal ──────────────────────────────────────
  const accounts = await db
    .select({ id: schema.accounts.id, name: schema.accounts.name })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.isActive, true)))
    .orderBy(schema.accounts.name);

  // ── Summary stats ────────────────────────────────────────────────────────
  const active    = plans.filter((p) => p.status === 'active');
  const complete  = plans.filter((p) => p.status === 'complete');

  // Monthly commitment = sum of active payment amounts
  const monthlyCommitment = active.reduce((s, p) => s + Math.abs(Number(p.paymentAmountIls)), 0);

  // Total remaining across all active plans
  const totalRemaining = active.reduce((s, p) => {
    const rem = p.totalPayments
      ? Math.max(0, p.totalPayments - p.currentPaymentNo + 1)
      : null;
    return rem !== null ? s + rem * Math.abs(Number(p.paymentAmountIls)) : s;
  }, 0);

  // Soonest end month among active plans with known total
  const endMonths = active
    .map((p) => p.projectedEndMonth)
    .filter(Boolean)
    .sort();
  const soonestEnd = endMonths[0] ?? null;

  // ── Build enriched plan list for client ───────────────────────────────────
  const enriched = plans.map((p) => ({
    ...p,
    paymentAmountIls: String(p.paymentAmountIls),
    accountName:      p.accountName ?? null,
    txCount:          txCountMap.get(p.id) ?? 0,
    status:           (p.status ?? 'active') as 'active' | 'complete' | 'cancelled',
  }));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">תשלומים</h1>
        <p className="text-sm text-muted-foreground">ניהול תוכניות תשלומים חודשיים</p>
      </header>

      {/* ── Summary tiles ── */}
      {plans.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryTile
            icon={<CreditCard className="size-4 text-primary" />}
            label="הוצאה חודשית פעילה"
            value={formatIls(monthlyCommitment, { decimals: false })}
            sub={`${active.length} תוכניות פעילות`}
          />
          <SummaryTile
            icon={<TrendingDown className="size-4 text-destructive" />}
            label="סה״כ נותר לתשלום"
            value={totalRemaining > 0 ? formatIls(totalRemaining, { decimals: false }) : '—'}
            sub="בכל התוכניות הפעילות"
          />
          <SummaryTile
            icon={<CalendarCheck className="size-4 text-success" />}
            label="הושלמו"
            value={String(complete.length)}
            sub="תוכניות שסיימנו"
          />
          <SummaryTile
            icon={<Layers className="size-4 text-muted-foreground" />}
            label="הסתיימות קרובה"
            value={soonestEnd ? formatMonth(soonestEnd) : '—'}
            sub="תוכנית פעילה הקרובה ביותר לסיום"
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

function SummaryTile({ icon, label, value, sub }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="tile flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
