/**
 * NEW — Project burn-rate (per active project).
 *
 * Per project: spent vs budget (BudgetProgress style), monthly burn rate
 * (3-month average), projected months remaining at current pace.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Briefcase } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import { BudgetProgress } from '@/components/ui/budget-progress';
import type { ProjectBurnFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: ProjectBurnFinding[];
}

export function CardProjectBurnRate({ windowLabel, findings }: Props) {
  if (findings.length === 0) {
    return (
      <InsightCard
        id="project-burn-rate"
        title="קצב פרויקטים"
        subtitle={windowLabel}
        icon={<Briefcase className="size-4 shrink-0" aria-hidden />}
        tone="neutral"
        info={INSIGHT_EXPLANATIONS['project-burn-rate']}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs text-muted-foreground">אין פרויקטים פעילים</p>
          <p className="text-2xs text-muted-foreground/80">
            ניתן ליצור פרויקטים ב/projects כדי לעקוב אחרי תקציב חוצה-חודשים
          </p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="project-burn-rate"
      title="קצב פרויקטים"
      subtitle={windowLabel}
      icon={<Briefcase className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['project-burn-rate']}
    >
      <div className="flex h-full flex-col">
        <ul className="space-y-3">
          {findings.slice(0, 3).map((p) => (
            <li key={p.projectId} className="space-y-1">
              <BudgetProgress
                label={p.name}
                actual={p.spentIls}
                target={p.totalBudgetIls}
                color={p.color}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-2xs text-muted-foreground tabular-nums px-0.5">
                <span>
                  קצב: {formatIls(p.monthlyBurnIls, { decimals: false })}/חודש
                </span>
                {p.projectedMonthsToBudget != null && (
                  <span>
                    תחזית סיום:{' '}
                    {p.projectedMonthsToBudget < 1
                      ? 'תוך פחות מחודש'
                      : `~${Math.round(p.projectedMonthsToBudget)} חודשים`}
                  </span>
                )}
              </div>
              <Link
                href={`/projects/${p.projectId}`}
                className="block text-2xs text-accent hover:underline px-0.5"
              >
                לפרטי פרויקט →
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </InsightCard>
  );
}
