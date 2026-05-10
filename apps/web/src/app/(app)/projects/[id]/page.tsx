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
import { ChevronRight, Pencil, Calendar, Target, TrendingDown, TrendingUp, Wallet, Receipt } from 'lucide-react';
import { CategoryDonutLazy as CategoryDonut } from '@/components/ui/category-donut-lazy';
import { InfoModalButton } from '@/components/ui/info-modal-button';
import { HighlightRowFromUrl } from './highlight-row';
import { ProjectTxnsTable } from './project-txns-table';

const fmt = (n: number) => formatIls(n, { decimals: false });

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
        excludedFromTotals:       schema.transactions.excludedFromTotals,
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

  // ── Sign-aware aggregations ──────────────────────────────────────────────
  // A project's transactions naturally have BOTH directions:
  //   • negative amounts = expenses (vendor payments, materials, contractors)
  //   • positive amounts = income/funding (mortgage disbursement, refunds,
  //     grants, sale of leftover materials)
  // We track them separately so the project budget reflects reality:
  // budget compares against EXPENSES only; "net out-of-pocket" is the
  // honest measure of how much real money has left the household.
  //
  // Rows flagged `excludedFromTotals` are accounting artifacts — loan
  // refinancing where one loan was opened only to be closed by the new
  // mortgage a month later, CC settlement lines, internal corrections.
  // They stay in the table for audit/visibility but are filtered out of
  // EVERY aggregation: totals, charts, donut, top-5 lists.
  const countableTxns = txns.filter((t) => !t.excludedFromTotals);
  const expenseTxns   = countableTxns.filter((t) => Number(t.amount) < 0);
  const incomeTxns    = countableTxns.filter((t) => Number(t.amount) > 0);
  const totalExpenses = expenseTxns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const totalIncome   = incomeTxns.reduce((s, t)  => s + Number(t.amount), 0);
  const netOutOfPocket = totalExpenses - totalIncome;
  // Surfaced separately so the user can see "X of your N tagged transactions
  // are excluded from sums" — useful trust-but-verify info on the KPI tile.
  const excludedTxnCount = txns.length - countableTxns.length;

  const budget = project.totalBudgetIls ? Number(project.totalBudgetIls) : null;
  const remaining = budget !== null ? budget - totalExpenses : null;
  const pctOfBudget = budget !== null && budget > 0
    ? Math.round((totalExpenses / budget) * 100)
    : null;

  // Group by month → cash flow chart input. Tracks expenses + income side
  // by side so the user can see "this month I spent X but received Y in
  // funding". Excluded rows are skipped — they're accounting noise, not
  // real cash flow.
  interface MonthBucket { expenses: number; income: number }
  const byMonth = new Map<string, MonthBucket>();
  for (const t of countableTxns) {
    const m = t.billingMonth;
    const amt = Number(t.amount);
    const bucket = byMonth.get(m) ?? { expenses: 0, income: 0 };
    if (amt < 0) bucket.expenses += Math.abs(amt);
    else         bucket.income   += amt;
    byMonth.set(m, bucket);
  }
  const monthRows = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const monthlyMax = Math.max(
    ...monthRows.map(([, v]) => Math.max(v.expenses, v.income)),
    1,
  );

  // Group by category — EXPENSES ONLY. Income/funding doesn't have a
  // meaningful category in the spending breakdown sense (where did the
  // mortgage money go? It went into the bank account, not "Construction
  // Materials"). Including funding here would distort the donut.
  const byCat = new Map<string | null, number>();
  for (const t of expenseTxns) {
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

  // Top 5 — split into top expenses + top income lines so the user sees
  // both "biggest payments" AND "biggest funding events" if any.
  const topExpenseTxns = [...expenseTxns]
    .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
    .slice(0, 5);
  const topIncomeTxns = [...incomeTxns]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
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

      {/* KPI tiles — sign-aware. The 4-tile row is:
          [expenses] [income] [net out-of-pocket] [txn count]
          Budget + remaining live in their own row below since they only
          appear when the project has a budget set, and they need more
          horizontal space for the explanatory subtitles. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <TrendingDown className="size-3" /> סך הוצאות
            </span>
            <InfoModalButton
              title="סך הוצאות"
              body={[
                `כל הכסף שיצא מהחשבון בעבור הפרויקט "${project.name}".`,
                '',
                'איך מחשבים: סוכמים את הערך המוחלט של כל התנועות עם סכום שלילי המתויגות לפרויקט הזה. זה כולל תשלומי ספקים, חומרים, אגרות, מיסים וכל תנועה שהכסף יצא ממנה.',
                '',
                `חישוב נוכחי: ${expenseTxns.length} תנועות עם סכום שלילי, סה"כ ${fmt(totalExpenses)}.`,
                '',
                'אינו כולל: מימון/הכנסה (תנועות חיוביות, ראה תיק נפרד), העברות בין חשבונות פנימיים, תנועות שלא תויגו לפרויקט.',
              ].join('\n')}
            />
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formatIls(totalExpenses, { decimals: false })}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {expenseTxns.length} תנועות יוצאות
          </p>
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <TrendingUp className="size-3" /> מימון / הכנסה
            </span>
            <InfoModalButton
              title="מימון / הכנסה"
              body={[
                `כסף שנכנס לחשבון בעבור הפרויקט "${project.name}" — בדרך כלל הלוואה שירדה לחשבון, מענק, החזר מקבלן, מכירת חומרים שנותרו וכדומה.`,
                '',
                'איך מחשבים: סוכמים את כל התנועות עם סכום חיובי המתויגות לפרויקט הזה.',
                '',
                totalIncome > 0
                  ? `חישוב נוכחי: ${incomeTxns.length} תנועות חיוביות, סה"כ ${fmt(totalIncome)}.`
                  : 'חישוב נוכחי: אין כלום. תייג את ההלוואה / המענק כך שיופיעו כאן ולא ירגישו כמו "הוצאה" בטעות.',
                '',
                'למה זה חשוב: בלי הפרדה זו, "סך הוצאות" יציג גם את הכסף שקיבלת כאילו הוצאת אותו, ויעלה את הסכום הכולל לפי שניים מהמציאות.',
              ].join('\n')}
            />
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-success">
            {totalIncome > 0 ? formatIls(totalIncome, { decimals: false }) : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {incomeTxns.length > 0 ? `${incomeTxns.length} תנועות נכנסות` : 'אין מימון מתויג'}
          </p>
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <Wallet className="size-3" /> נטו מהכיס
            </span>
            <InfoModalButton
              title="נטו מהכיס"
              body={[
                'כמה כסף אמיתי יצא מההון שלך בעבור הפרויקט — אחרי קיזוז כל המימון שקיבלת.',
                '',
                'איך מחשבים: סך הוצאות פחות סך מימון/הכנסה.',
                '',
                `חישוב נוכחי: ${fmt(totalExpenses)} (הוצאות) − ${fmt(totalIncome)} (מימון) = ${fmt(netOutOfPocket)}.`,
                '',
                netOutOfPocket > 0
                  ? `מספר חיובי (${fmt(netOutOfPocket)}) = הוצאת יותר ממה שמימנת. ההפרש יצא מההון העצמי שלך.`
                  : netOutOfPocket < 0
                    ? `מספר שלילי (${fmt(Math.abs(netOutOfPocket))}) = יש לך עודף מימון בכיס. נשאר כסף שטרם הוצאת.`
                    : 'יציאות והכנסות מתאזנות בדיוק.',
                '',
                'זה המספר שמשקף "כמה הפרויקט באמת עלה לי עד עכשיו".',
              ].join('\n')}
            />
          </p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${
            netOutOfPocket > 0 ? 'text-destructive' : 'text-success'
          }`}>
            {formatIls(Math.abs(netOutOfPocket), { decimals: false })}
            {netOutOfPocket <= 0 && totalIncome > 0 && (
              <span className="ms-1 text-2xs font-normal text-muted-foreground">עודף</span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            הוצאות פחות מימון
          </p>
        </div>
        <div className="tile">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <Receipt className="size-3" /> סך תנועות
            </span>
            <InfoModalButton
              title="סך תנועות"
              body={[
                `מספר התנועות הכולל המתויגות לפרויקט "${project.name}".`,
                '',
                `חישוב נוכחי: ${txns.length} תנועות סך הכל.`,
                `· ${expenseTxns.length} יוצאות (נספרות בהוצאות)`,
                `· ${incomeTxns.length} נכנסות (נספרות במימון)`,
                excludedTxnCount > 0
                  ? `· ${excludedTxnCount} מסומנות כ"לא נספרות" (תנועות חשבונאיות בלבד — לא נכללות בסיכומים)`
                  : '',
                '',
                'איך לתייג עוד תנועות: לחצי על אייקון התיק (Briefcase) ליד כל תנועה בעמוד "תנועות" ובחרי את הפרויקט. תנועות מתויגות מוסרות מהתצוגות החודשיות (אישי / עסקי / משולב) כדי שלא יעוותו את הסיכומים.',
                '',
                'איך לסמן תנועה כ"לא נספרת": פתחי את התנועה לעריכה וסמני "אל תספור בסיכומים". שימושי לתנועות חשבונאיות שאינן תזוזת כסף אמיתית — למשל פתיחת הלוואה ישנה כדי לסגור אותה במשכנתא חדשה.',
              ].filter(Boolean).join('\n')}
            />
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {txns.length}
          </p>
          {excludedTxnCount > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {excludedTxnCount} מהן לא נספרות בסיכומים
            </p>
          )}
        </div>
      </section>

      {/* Budget row — only when budget is set */}
      {budget !== null && budget > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-2 max-w-2xl">
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <Target className="size-3" /> תקציב מתוכנן
              </span>
              <InfoModalButton
                title="תקציב מתוכנן"
                body={[
                  `הסכום הכולל שתכננת להוציא על הפרויקט "${project.name}" — הוגדר כשיצרת/ערכת את הפרויקט.`,
                  '',
                  `חישוב נוכחי: ${fmt(budget)}.`,
                  '',
                  'זהו תכנון מראש, לא בפועל. אם תרצי לעדכן: עברי לעריכת הפרויקט בעמוד הראשי של הפרויקטים.',
                  '',
                  'מימון אינו משפיע על התקציב — תקציב מבטא "כמה אני מתכננת לשלם", לא "כמה כסף אני מתכננת לקבל".',
                ].join('\n')}
              />
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatIls(budget, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>נותר מהתקציב</span>
              <InfoModalButton
                title="נותר מהתקציב"
                body={[
                  'הסכום שעדיין נשאר לי להוציא על הפרויקט לפני שאחרוג מהתקציב המתוכנן.',
                  '',
                  'איך מחשבים: תקציב מתוכנן פחות סך הוצאות בפועל. מימון אינו משפיע — הוא לא "משחרר" תקציב נוסף.',
                  '',
                  `חישוב נוכחי: ${fmt(budget)} (תקציב) − ${fmt(totalExpenses)} (הוצאות) = ${remaining !== null ? fmt(remaining) : '0'}.`,
                  '',
                  pctOfBudget !== null
                    ? `אחוז ניצול: ${pctOfBudget}% מהתקציב נוצל בהוצאות בפועל.`
                    : '',
                  '',
                  remaining !== null && remaining < 0
                    ? 'מספר שלילי = חרגת מהתקציב. שווה לבחון את התכנון מחדש או לעדכן את התקציב.'
                    : 'מספר חיובי = יש עוד מקום בתקציב להוצאות.',
                ].filter(Boolean).join('\n')}
              />
            </p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${
              remaining !== null && remaining < 0 ? 'text-destructive' : 'text-success'
            }`}>
              {remaining !== null ? formatIls(remaining, { decimals: false }) : '—'}
            </p>
            {pctOfBudget !== null && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {pctOfBudget}% מהתקציב נוצל בהוצאות
              </p>
            )}
          </div>
        </section>
      )}

      {/* Budget progress bar — only when budget is set. Shows expenses
          progress against the planned budget (independent of income). */}
      {budget !== null && budget > 0 && (
        <section className="tile space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">התקדמות הוצאות מול תקציב</span>
            <span className="tabular-nums text-muted-foreground">
              {formatIls(totalExpenses, { decimals: false })} / {formatIls(budget, { decimals: false })}
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
          {/* Charts row: donut (expenses only) + monthly bars (split) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="tile lg:col-span-1">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                הוצאות לפי קטגוריה
                <span className="ms-1 text-2xs text-muted-foreground/70">
                  (לא כולל מימון)
                </span>
              </h2>
              <CategoryDonut data={donutData} centerValue={totalExpenses} centerLabel="הוצא" />
            </section>

            <section className="tile lg:col-span-2 space-y-3" dir="rtl">
              <h2 className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
                <span>תזרים חודשי</span>
                {/* Legend dots — match the actual bar colors. The expense bar
                    uses the project's color (set in project settings), so the
                    dot inherits the same backgroundColor. The income bar is
                    always success-green. */}
                <span className="flex items-center gap-3 text-2xs text-muted-foreground/70">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: project.color ?? 'var(--primary)' }}
                    />
                    הוצאות
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block size-2 rounded-full bg-success" />
                    הכנסה
                  </span>
                </span>
              </h2>
              {monthRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">אין נתונים</p>
              ) : (
                <div className="space-y-3">
                  {monthRows.map(([m, v]) => {
                    const expensePct = Math.round((v.expenses / monthlyMax) * 100);
                    const incomePct  = Math.round((v.income   / monthlyMax) * 100);
                    return (
                      <div key={m} className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-muted-foreground tabular-nums">{m}</span>
                          <span className="flex items-center gap-2 text-2xs tabular-nums">
                            {v.expenses > 0 && (
                              <span className="text-foreground font-medium">
                                ↓ {formatIls(v.expenses, { decimals: false })}
                              </span>
                            )}
                            {v.income > 0 && (
                              <span className="text-success font-medium">
                                ↑ {formatIls(v.income, { decimals: false })}
                              </span>
                            )}
                          </span>
                        </div>
                        {/* Two stacked bars — expense above (red/project),
                            income below (green). Each scaled to monthlyMax
                            so they're visually comparable across months. */}
                        <div className="space-y-0.5">
                          {v.expenses > 0 && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${expensePct}%`,
                                  backgroundColor: project.color ?? 'var(--primary)',
                                }}
                              />
                            </div>
                          )}
                          {v.income > 0 && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-success transition-all duration-700"
                                style={{ width: `${incomePct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Top expenses + top income, side-by-side. Income column only
              shown when there's at least one funding txn. Both lists are
              capped at 5 — anything beyond that is in the full table below. */}
          {(topExpenseTxns.length > 0 || topIncomeTxns.length > 0) && (
            <div className={`grid grid-cols-1 gap-6 ${topIncomeTxns.length > 0 ? 'lg:grid-cols-2' : ''}`}>
              {topExpenseTxns.length > 0 && (
                <section className="tile space-y-3" dir="rtl">
                  <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="size-3.5" />
                    הוצאות הגדולות ביותר
                  </h2>
                  <ul className="divide-y rounded-md border">
                    {topExpenseTxns.map((t) => {
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
              {topIncomeTxns.length > 0 && (
                <section className="tile space-y-3" dir="rtl">
                  <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="size-3.5 text-success" />
                    מימון / הכנסות גדולות
                  </h2>
                  <ul className="divide-y rounded-md border">
                    {topIncomeTxns.map((t) => {
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
                          <span className="tabular-nums font-semibold text-success">
                            +{formatIls(Number(t.amount), { decimals: false })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
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
              excludedFromTotals:       t.excludedFromTotals,
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
