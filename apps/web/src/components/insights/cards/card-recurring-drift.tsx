/**
 * Insight #2 — Recurring drift (subscription price increased / dropped silently).
 *
 * Visual rule: ↑ red = cost went UP (bad — you're paying more), ↓ green = cost
 * went DOWN (good — paying less). Arrows are vertical (ArrowUp / ArrowDown),
 * not diagonal, to read clearly at small sizes.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { ArrowUp, ArrowDown, Repeat, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { RecurringDriftFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: RecurringDriftFinding[];
}

export function CardRecurringDrift({ windowLabel, findings }: Props) {
  return (
    <InsightCard
      id="recurring-drift"
      title="הוצאות קבועות שהמחיר השתנה"
      subtitle={windowLabel}
      icon={<Repeat className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INSIGHT_EXPLANATIONS['recurring-drift']}
    >
      {findings.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center">
          <p className="text-xs text-muted-foreground">אף הוצאה קבועה לא חרגה מהטווח המקובל</p>
          <p className="text-2xs text-muted-foreground/80">
            כשמנוי יעלה במחיר או יוזל, זה יופיע כאן
          </p>
        </div>
      ) : (
        <ul className="divide-y text-sm">
          {findings.slice(0, 5).map((f) => {
            const up = f.diffPct > 0;
            const Arrow = up ? ArrowUp : ArrowDown;
            // Cost went UP = bad for the user (red). Cost went DOWN = good (green).
            // Pair the arrow with an explicit Hebrew verb so the meaning is
            // unambiguous regardless of how the user reads the chart.
            const tone = up ? 'text-destructive' : 'text-success';
            const verb = up ? 'עלה' : 'ירד';
            return (
              <li key={f.patternId}>
                <Link
                  href={`/transactions?text=${encodeURIComponent(f.merchant)}&flag=recurring`}
                  className="group flex items-baseline justify-between gap-3 -mx-1 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium group-hover:text-accent transition-colors" title={f.merchant}>
                      {f.description ?? f.merchant}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      היה: {formatIls(f.expectedIls, { decimals: false })} · {f.latestDate}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="font-semibold tabular-nums">
                      {formatIls(f.latestActualIls, { decimals: false })}
                    </p>
                    <p
                      className={`flex items-center justify-end gap-1 text-2xs tabular-nums font-semibold ${tone}`}
                    >
                      <Arrow className="size-3" aria-hidden />
                      {verb} {Math.abs(f.diffPct).toFixed(0)}%
                      <ChevronLeft className="ms-0.5 inline-block size-2.5 rtl-flip opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                    </p>
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
