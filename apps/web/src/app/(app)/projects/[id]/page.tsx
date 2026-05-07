/**
 * Per-project dashboard (/projects/[id]).
 *
 * Renders all transactions tagged to a single project, plus aggregate
 * stats (spent vs budget, monthly breakdown, top merchants, category
 * distribution). This is the ONLY view where project transactions are
 * shown — by design, they're excluded from the personal/business/combined
 * dashboards so big project costs don't drown out regular spending.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { formatIls, formatShortDateHe } from '@fba/shared';
import { ChevronRight, Pencil, Calendar, Target, TrendingDown, Receipt } from 'lucide-react';
import { CategoryDonutLazy as CategoryDonut } from '@/components/ui/category-donut-lazy';
import { HighlightRowFromUrl } from './highlight-row';
import { ProjectTxnsTable } from './project-txns-table';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { householdId } = session.user;
  const { id } = await props.params;
  const db = getDb();

  // ── Project lookup (with ownership check) ─────────────────────────────────
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(
      eq(schema.projects.id, id),
      eq(schema.projects.householdId, householdId),
    ))
    .limit(1);
  if (!project) notFound();

  // ── Project transactions + lookup tables ──────────────────────────────────
  const [txns, cats, accs] = await Promise.all([
    db
      .select({
        id:                       schema.transactions.id,
        date:                     schema.transactions.transactionDate,
        chargeDate:               schema.transactions.chargeDate,
        billingMonth:             schema.transactions.billingMonth,
        merchant:                 schema.transactions.merchantRaw,
        amount:                   schema.transactions.amountIls,
        categoryId:               schema.transactions.categoryId,
        subCategoryId:            schema.transactions.subCategoryId,
        accountId:                schema.transactions.accountId,
        notes:                    schema.transactions.notes,
        isTransfer:               schema.transactions.isTransfer,
        includeInMonthlyOverride: schema.transactions.includeInMonthlyOverride,
      })
      .from(schema.transactions)
      .where(and(
        eq(schema.transactions.householdId, householdId),
        eq(schema.transactions.projectId, id),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
      ))
      .orderBy(desc(schema.transactions.transactionDate)),
    db
      .select({ id: schema.categories.id, nameHe: schema.categories.nameHe, color: schema.categories.color, parentId: schema.categories.parentId, sortOrder: schema.categories.sortOrder })
      .from(schema.categories)
      .where(eq(schema.categories.householdId, householdId))
      .orderBy(schema.categories.sortOrder),
    db
      .select({ id: schema.accounts.id, name: schema.accounts.name })
      .from(schema.accounts)
      .where(eq(schema.accounts.householdId, householdId)),
  ]);

  const catMap = new Map(cats.map((c) => [c.id, c]));

  // ── Aggregations ──────────────────────────────────────────────────────────
  const totalSpent = txns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const budget = project.totalBudgetIls ? Number(project.totalBudgetIls) : null;
  const remaining = budget !== null ? budget - totalSpent : null;
  const pctOfBudget = budget !== null && budget > 0
    ? Math.round((totalSpent / budget) * 100)
    : null;

  // Group by month → cash flow chart input.
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    const m = t.billingMonth;
    byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(Number(t.amount)));
  }
  const monthRows = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const monthlyMax = Math.max(...monthRows.map(([, v]) => v), 1);

  // Group by category → donut chart.
  const byCat = new Map<string | null, number>();
  for (const t of txns) {
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + Math.abs(Number(t.amount)));
  }
  const donutData = Array.from(byCat.entries())
    .map(([catId, v]) => {
      const cat = catId ? catMap.get(catId) : null;
      return {
        name:  cat?.nameHe ?? 'ללא קטגוריה',
        value: v,
        color: cat?.color ?? '#94a3b8',
      };
    })
    .sort((a, b) => b.value - a.value);

  // Top 5 single transactions (biggest hits).
  const topTxns = [...txns]
    .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Client island — handles ?highlight=<txnId> deep links from the
          global search palette by scrolling/flashing the matching row. */}
      <HighlightRowFromUrl />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" dir="rtl">
        <Link href="/projects" className="hover:underline">פרויקטים</Link>
        <ChevronRight className="size-3.5 rotate-180" />
        <span className="text-foreground font-medium">{project.name}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {project.color && (
            <span
              className="mt-2 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground">{project.description}</p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              {project.startDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  התחיל: {formatShortDateHe(project.startDate)}
                </span>
              )}
              {project.endDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  סיום צפוי: {formatShortDateHe(project.endDate)}
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                project.status === 'active' ? 'bg-success/10 text-success' :
                project.status === 'paused' ? 'bg-warning/10 text-warning' :
                'bg-muted text-muted-foreground'
              }`}>
                {project.status === 'active' ? 'פעיל' :
                 project.status === 'paused' ? 'מושהה' :
                 project.status === 'completed' ? 'הושלם' : 'בוטל'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Edit link uses the projects-list ?edit=<id> deep-link so
              clicking lands directly in the edit modal, not on the
              read-only dashboard. */}
          <Link
            href={`/projects?edit=${project.id}`}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent/40"
          >
            <Pencil className="size-3.5" />
            ערוך פרויקט
          </Link>
        </div>
      </header>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingDown className="size-3" /> סך הוצאה
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formatIls(totalSpent, { decimals: false })}
          </p>
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Target className="size-3" /> תקציב
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {budget !== null ? formatIls(budget, { decimals: false }) : '—'}
          </p>
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground">נותר</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${
            remaining !== null && remaining < 0 ? 'text-destructive' : 'text-success'
          }`}>
            {remaining !== null ? formatIls(remaining, { decimals: false }) : '—'}
          </p>
          {pctOfBudget !== null && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {pctOfBudget}% מהתקציב
            </p>
          )}
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Receipt className="size-3" /> תנועות
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {txns.length}
          </p>
        </div>
      </section>

      {/* Budget progress bar — only when budget is set */}
      {budget !== null && budget > 0 && (
        <section className="tile space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">התקדמות תקציב</span>
            <span className="tabular-nums text-muted-foreground">
              {formatIls(totalSpent, { decimals: false })} / {formatIls(budget, { decimals: false })}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${Math.min(100, pctOfBudget!)}%`,
                backgroundColor: pctOfBudget! >= 100
                  ? 'var(--destructive)'
                  : pctOfBudget! >= 80
                    ? 'var(--warning)'
                    : (project.color ?? 'var(--primary)'),
              }}
            />
          </div>
        </section>
      )}

      {txns.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          <Receipt className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p>אין תנועות מתויגות לפרויקט הזה עדיין.</p>
          <p className="mt-1 text-xs">
            עבור ל-<Link href="/transactions" className="text-primary hover:underline">דף התנועות</Link>{' '}
            ותייג תנועות לפרויקט באמצעות אייקון התיק שמופיע על כל שורה.
          </p>
        </div>
      ) : (
        <>
          {/* Charts row: donut + monthly bars */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="tile lg:col-span-1">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">לפי קטגוריה</h2>
              <CategoryDonut data={donutData} centerValue={totalSpent} centerLabel="הוצא" />
            </section>

            <section className="tile lg:col-span-2 space-y-3" dir="rtl">
              <h2 className="text-sm font-medium text-muted-foreground">הוצאה לפי חודש</h2>
              {monthRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">אין נתונים</p>
              ) : (
                <div className="space-y-2.5">
                  {monthRows.map(([m, v]) => {
                    const pct = Math.round((v / monthlyMax) * 100);
                    return (
                      <div key={m} className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-muted-foreground tabular-nums">{m}</span>
                          <span className="tabular-nums font-semibold">
                            {formatIls(v, { decimals: false })}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: project.color ?? 'var(--primary)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Top 5 transactions */}
          {topTxns.length > 0 && (
            <section className="tile space-y-3" dir="rtl">
              <h2 className="text-sm font-medium text-muted-foreground">5 התנועות הגדולות ביותר</h2>
              <ul className="divide-y rounded-md border">
                {topTxns.map((t) => {
                  const cat = t.categoryId ? catMap.get(t.categoryId) : null;
                  return (
                    <li key={t.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatShortDateHe(t.date)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{t.merchant}</div>
                        {cat && (
                          <span
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}
                          >
                            {cat.nameHe}
                          </span>
                        )}
                      </div>
                      <span className="tabular-nums font-semibold">
                        {formatIls(Math.abs(Number(t.amount)), { decimals: false })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Editable transactions table — opens the same EditTransactionModal
              that /transactions uses, so the user can re-categorize project
              transactions even though they're hidden from the main view. */}
          <ProjectTxnsTable
            txns={txns.map((t) => ({
              id:                       t.id,
              date:                     t.date,
              chargeDate:               t.chargeDate,
              billingMonth:             t.billingMonth,
              merchant:                 t.merchant,
              amount:                   Number(t.amount),
              categoryId:               t.categoryId,
              subCategoryId:            t.subCategoryId,
              accountId:                t.accountId,
              notes:                    t.notes,
              isTransfer:               t.isTransfer,
              includeInMonthlyOverride: t.includeInMonthlyOverride,
            }))}
            categories={cats
              .filter((c) => !c.parentId)
              .map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color }))}
            subCategories={cats
              .filter((c) => !!c.parentId)
              .map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color, parentId: c.parentId! }))}
            accounts={accs.map((a) => ({ id: a.id, name: a.name }))}
            catMap={catMap}
            accNameById={new Map(accs.map((a) => [a.id, a.name]))}
            projectId={project.id}
          />
        </>
      )}
    </div>
  );
}
