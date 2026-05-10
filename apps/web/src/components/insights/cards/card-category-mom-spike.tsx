/**
 * Insight #6 — Category MoM spike (this billing month vs trailing 3-month median).
 *
 * Server Component. Renders a small horizontal bar list of categories with the
 * biggest jumps. Drill-stack not yet wired (Phase B will add sub-category drill).
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Flame, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { MomSpikeFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const CHART_FALLBACK = 'hsl(215 65% 35%)';

interface Props {
  windowLabel: string;
  findings: MomSpikeFinding[];
}

export function CardCategoryMomSpike({ windowLabel, findings }: Props) {
  return (
    <InsightCard
      id="category-mom-spike"
      title="קפיצות לעומת חודשים קודמים"
      subtitle={windowLabel}
      icon={<Flame className="size-4 shrink-0" aria-hidden />}
      tone="destructive"
      info={INSIGHT_EXPLANATIONS['category-mom-spike']}
    >
      {findings.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          אין קפיצות חריגות לעומת החודשים הקודמים
        </p>
      ) : (
        <ul className="space-y-2.5 text-sm">
          {findings.slice(0, 5).map((f) => {
            const max = findings[0]?.thisMonthIls || 1;
            const widthPct = Math.max(8, (f.thisMonthIls / max) * 100);
            const color = f.color ?? CHART_FALLBACK;
            return (
              <li key={f.categoryId}>
                <Link
                  href={`/transactions?categoryId=${encodeURIComponent(f.categoryId)}&sign=expense`}
                  className="group block space-y-1 -mx-1 rounded-md px-1 py-1 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium group-hover:text-accent transition-colors" title={f.category}>
                      {f.category}
                    </span>
                    <span className="shrink-0 text-2xs font-semibold tabular-nums text-destructive flex items-center">
                      +{f.pctOver.toFixed(0)}%
                      <ChevronLeft className="ms-0.5 inline-block size-2.5 rtl-flip opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                    </span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="flex justify-between text-2xs text-muted-foreground tabular-nums">
                    <span>חציון: {formatIls(f.trailingMedianIls, { decimals: false })}</span>
                    <span>עכשיו: {formatIls(f.thisMonthIls, { decimals: false })}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </InsightCard>
  );
}
