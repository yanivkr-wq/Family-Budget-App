/**
 * Insight #8b — Low-confidence categorizations (categorySource='llm', not user-confirmed).
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Sparkles } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { LowConfidenceFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const INFO = INSIGHT_EXPLANATIONS['low-confidence-categorizations'];

interface Props {
  windowLabel: string;
  finding: LowConfidenceFinding;
}

export function CardLowConfidenceCategorizations({ windowLabel, finding }: Props) {
  if (finding.count === 0) {
    return (
      <InsightCard
        id="low-confidence-categorizations"
        title="סיווג בביטחון נמוך"
        subtitle={windowLabel}
        icon={<Sparkles className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INFO}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="pill bg-success-soft text-success">✓ תקין</span>
          <p className="text-xs text-muted-foreground">כל הסיווגים אומתו</p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="low-confidence-categorizations"
      title="סיווג בביטחון נמוך"
      subtitle={windowLabel}
      icon={<Sparkles className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INFO}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums text-warning">
            {finding.count.toLocaleString('he-IL')}
          </span>
          <span className="text-xs text-muted-foreground">תנועות סווגו אוטומטית</span>
        </div>

        {finding.recent.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              אחרונות
            </p>
            <ul className="text-xs">
              {finding.recent.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/transactions?text=${encodeURIComponent(r.merchant)}&highlight=${r.id}`}
                    className="group flex items-baseline justify-between gap-2 -mx-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/40"
                  >
                    <span className="truncate text-foreground group-hover:text-accent transition-colors" title={r.merchant}>
                      {r.merchant}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {formatIls(Math.abs(r.amountIls), { decimals: false })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link
          href="/transactions?categorySource=llm"
          className="btn-secondary mt-auto pt-3 text-xs"
        >
          סקור סיווגים
        </Link>
      </div>
    </InsightCard>
  );
}
