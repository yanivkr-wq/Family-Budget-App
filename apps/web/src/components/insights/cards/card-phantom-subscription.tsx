/**
 * Insight #3 — Phantom subscription (active recurring + dormant merchant).
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Ghost, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { PhantomSubFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: PhantomSubFinding[];
}

export function CardPhantomSubscription({ windowLabel, findings }: Props) {
  return (
    <InsightCard
      id="phantom-subscription"
      title="מנויים שלא בשימוש"
      subtitle={windowLabel}
      icon={<Ghost className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INSIGHT_EXPLANATIONS['phantom-subscription']}
    >
      {findings.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          לא נמצאו מנויים נטושים — כל המנויים בשימוש פעיל
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {findings.slice(0, 5).map((f) => (
            <li key={f.patternId}>
              {/* Whole row is now a link → /transactions filtered by merchant
                  so the user can investigate, decide whether to cancel, or
                  fix the categorization. The hover state is the visual signal
                  of clickability. */}
              <Link
                href={`/transactions?text=${encodeURIComponent(f.merchant)}&flag=recurring`}
                className="flex items-baseline justify-between gap-3 py-2 px-1 -mx-1 rounded-md transition-colors hover:bg-muted/40 group"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium group-hover:text-accent transition-colors" title={f.merchant}>
                    {f.description ?? f.merchant}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {f.daysSinceLastNonRecurringActivity == null
                      ? 'לא נמצאה אצלך אצל בית העסק שום פעילות חד-פעמית'
                      : `אין פעילות חד-פעמית אצל בית העסק ${f.daysSinceLastNonRecurringActivity} ימים`}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="font-semibold tabular-nums">
                    {formatIls(f.monthlyIls, { decimals: false })}
                    <span className="ms-0.5 text-2xs text-muted-foreground font-normal">/חודש</span>
                  </p>
                  <p className="flex items-center justify-end gap-0.5 text-2xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                    בדוק
                    <ChevronLeft className="size-3 rtl-flip" aria-hidden />
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}
