/**
 * Projects landing page (/projects).
 *
 * Lists every project for the household with aggregated stats (total spent,
 * txn count, % of budget). Lets the user create / edit / delete projects.
 *
 * Why this exists: a "project" is a long-running expense bucket (e.g.
 * "בניית בית" — multi-year construction). Per the project's
 * `excludeFromMonthlyTotals` flag, transactions tagged to it are
 * automatically removed from the personal / business / combined dashboards
 * so they don't pollute regular monthly summaries.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Briefcase, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { listProjects } from './actions';
import { ProjectsList } from './projects-list';
import { formatIls } from '@fba/shared';
import { InfoModalButton } from '@/components/ui/info-modal-button';

/** Hebrew formatter for the explanation modals' calculation breakdown. */
const fmt = (n: number) => formatIls(n, { decimals: false });

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const projects = await listProjects();

  // ── Aggregate KPIs ─────────────────────────────────────────────────────────
  // Sign-aware: expenses + income are tracked separately so funding
  // (mortgage disbursements, refunds) doesn't get added to the spending bar.
  // Net out-of-pocket = expenses - income (positive means you spent more
  // than was funded; negative means you have a funding surplus).
  const active = projects.filter((p) => p.status === 'active');
  const totalExpensesAll = projects.reduce((s, p) => s + p.totalExpenses, 0);
  const totalIncomeAll   = projects.reduce((s, p) => s + p.totalIncome,   0);
  const netOutOfPocket   = totalExpensesAll - totalIncomeAll;
  const totalBudgetAll = projects.reduce(
    (s, p) => s + (p.totalBudgetIls ? Number(p.totalBudgetIls) : 0),
    0,
  );
  const remainingBudget = totalBudgetAll - totalExpensesAll;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">פרויקטים</h1>
          <p className="text-sm text-muted-foreground">
            דליים של הוצאה לטווח ארוך — בנייה, חתונה, חופשה גדולה.
            תנועות שמתויגות לפרויקט <strong>אינן</strong> נספרות בתצוגות החודשיות
            (אישי / עסקי / משולב).
          </p>
        </div>
      </header>

      {/* Summary tiles — only show when we have projects.
          Two-row layout:
            Row 1 = activity (count) + sign-aware money flow (expenses, income, net)
            Row 2 = budget vs remaining (only when at least one project has a budget) */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>פרויקטים פעילים</span>
              <InfoModalButton
                title="פרויקטים פעילים"
                body={[
                  'מספר הפרויקטים שהסטטוס שלהם הוא "פעיל".',
                  '',
                  `חישוב נוכחי: סה"כ ${projects.length} פרויקטים, מתוכם ${active.length} פעילים.`,
                  '',
                  'פרויקטים במצב "מושהה", "הושלם" או "בוטל" אינם נספרים כאן אך עדיין מוצגים ברשימה.',
                ].join('\n')}
              />
            </p>
            <p className="mt-1 text-xl font-semibold flex items-center gap-2">
              <Briefcase className="size-4 text-muted-foreground" />
              {active.length}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <TrendingDown className="size-3" />
                סך הוצאות
              </span>
              <InfoModalButton
                title="סך הוצאות"
                body={[
                  'סך כל הכסף שיצא מהחשבון בעבור כל הפרויקטים יחד.',
                  '',
                  'איך מחשבים: סוכמים את הערך המוחלט של כל התנועות עם סכום שלילי (חיובים, תשלומי קבלן, חומרים, אגרות) המתויגות לאחד מהפרויקטים שלך.',
                  '',
                  `חישוב נוכחי: ${fmt(totalExpensesAll)} מסך כל הפרויקטים יחד.`,
                  '',
                  'אינו כולל: תנועות מימון/הכנסה (ראה תיק נפרד), תנועות לא מתויגות לפרויקט.',
                ].join('\n')}
              />
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatIls(totalExpensesAll, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <TrendingUp className="size-3" />
                סך מימון / הכנסה
              </span>
              <InfoModalButton
                title="סך מימון / הכנסה"
                body={[
                  'סך כל הכסף שנכנס לחשבון בעבור כל הפרויקטים — הלוואות שירדו לחשבון, מענקים, החזרים, מכירת חומרים שנותרו.',
                  '',
                  'איך מחשבים: סוכמים את כל התנועות עם סכום חיובי המתויגות לאחד מהפרויקטים שלך.',
                  '',
                  `חישוב נוכחי: ${fmt(totalIncomeAll)} מסך כל הפרויקטים.`,
                  '',
                  'למה זה חשוב: בלי להפריד מימון מהוצאות, "סך הוצאות" היה כולל גם את ההלוואה שקיבלת, ויוצר רושם שהוצאת פי שניים ממה שבאמת הוצאת.',
                ].join('\n')}
              />
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-success">
              {totalIncomeAll > 0 ? formatIls(totalIncomeAll, { decimals: false }) : '—'}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <Wallet className="size-3" />
                נטו מהכיס
              </span>
              <InfoModalButton
                title="נטו מהכיס"
                body={[
                  'כמה כסף אמיתי יצא מהכיס שלך לכל הפרויקטים יחד — אחרי קיזוז המימון שקיבלת.',
                  '',
                  'איך מחשבים: סך הוצאות פחות סך מימון/הכנסה.',
                  '',
                  `חישוב נוכחי: ${fmt(totalExpensesAll)} (הוצאות) − ${fmt(totalIncomeAll)} (מימון) = ${fmt(netOutOfPocket)}.`,
                  '',
                  netOutOfPocket > 0
                    ? 'מספר חיובי = הוצאת יותר ממה שמימנת. ההפרש יצא מההון שלך.'
                    : 'מספר 0 או שלילי = יש לך עודף מימון. נשאר כסף שטרם הוצאת על הפרויקט.',
                ].join('\n')}
              />
            </p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${
              netOutOfPocket > 0 ? 'text-destructive' : 'text-success'
            }`}>
              {formatIls(Math.abs(netOutOfPocket), { decimals: false })}
              {netOutOfPocket <= 0 && totalIncomeAll > 0 && (
                <span className="ms-1 text-2xs font-normal text-muted-foreground">עודף</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              הוצאות פחות מימון
            </p>
          </div>
          {totalBudgetAll > 0 && (
            <>
              <div className="tile md:col-start-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>סך תקציב מתוכנן</span>
                  <InfoModalButton
                    title="סך תקציב מתוכנן"
                    body={[
                      'סכום ההוצאות הצפוי שהגדרת בעמוד עריכת הפרויקט עבור כל הפרויקטים יחד.',
                      '',
                      'איך מחשבים: סכום שדה "תקציב כולל" של כל הפרויקטים שיש להם תקציב מוגדר. פרויקטים ללא תקציב מוגדר אינם נספרים.',
                      '',
                      `חישוב נוכחי: ${fmt(totalBudgetAll)}.`,
                      '',
                      'זה תכנון מראש, לא בפועל. אינו כולל מימון — תקציב מבטא "כמה אני מתכנן לשלם", לא "כמה אני מתכנן לקבל".',
                    ].join('\n')}
                  />
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatIls(totalBudgetAll, { decimals: false })}
                </p>
              </div>
              <div className="tile">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>נותר מהתקציב</span>
                  <InfoModalButton
                    title="נותר מהתקציב"
                    body={[
                      'הסכום שעדיין נותר לי להוציא לפני שאחרוג מהתקציב המתוכנן.',
                      '',
                      'איך מחשבים: סך התקציב המתוכנן פחות סך ההוצאות בפועל. מימון אינו משפיע — תקציב נשפט מול הוצאות בלבד.',
                      '',
                      `חישוב נוכחי: ${fmt(totalBudgetAll)} (תקציב) − ${fmt(totalExpensesAll)} (הוצאות) = ${fmt(remainingBudget)}.`,
                      '',
                      remainingBudget < 0
                        ? 'מספר שלילי = חרגת מהתקציב. שווה לבחון את התכנון מחדש.'
                        : 'מספר חיובי = יש עוד תקציב פנוי לפרויקטים האלה.',
                    ].join('\n')}
                  />
                </p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${
                  remainingBudget < 0 ? 'text-destructive' : 'text-success'
                }`}>
                  {formatIls(remainingBudget, { decimals: false })}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  תקציב מינוס הוצאות בפועל
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <ProjectsList projects={projects} />
    </div>
  );
}
