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
import { Briefcase } from 'lucide-react';
import { listProjects } from './actions';
import { ProjectsList } from './projects-list';
import { formatIls } from '@fba/shared';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const projects = await listProjects();

  // ── Aggregate KPIs ─────────────────────────────────────────────────────────
  const active = projects.filter((p) => p.status === 'active');
  const totalSpentAll = projects.reduce((s, p) => s + p.totalSpent, 0);
  const totalBudgetAll = projects.reduce(
    (s, p) => s + (p.totalBudgetIls ? Number(p.totalBudgetIls) : 0),
    0,
  );

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

      {/* Summary tiles — only show when we have projects */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="tile">
            <p className="text-xs text-muted-foreground">פרויקטים פעילים</p>
            <p className="mt-1 text-xl font-semibold flex items-center gap-2">
              <Briefcase className="size-4 text-muted-foreground" />
              {active.length}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">סך הוצאה בכל הפרויקטים</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatIls(totalSpentAll, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">סך תקציב כולל</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {totalBudgetAll > 0 ? formatIls(totalBudgetAll, { decimals: false }) : '—'}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">נותר בתקציב</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${
              totalBudgetAll - totalSpentAll < 0 ? 'text-destructive' : 'text-success'
            }`}>
              {totalBudgetAll > 0
                ? formatIls(totalBudgetAll - totalSpentAll, { decimals: false })
                : '—'}
            </p>
          </div>
        </div>
      )}

      <ProjectsList projects={projects} />
    </div>
  );
}
