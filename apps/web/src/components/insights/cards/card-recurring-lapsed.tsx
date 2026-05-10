/**
 * Insight #4 — Recurring lapsed (expected charge missing this cycle).
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { CalendarX, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { LapsedFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: LapsedFinding[];
}

export function CardRecurringLapsed({ windowLabel, findings }: Props) {
  return (
    <InsightCard
      id="recurring-lapsed"
      title="חיובים קבועים שלא הופיעו בזמן"
      subtitle={windowLabel}
      icon={<CalendarX className="size-4 shrink-0" aria-hidden />}
      tone="destructive"
      info={INSIGHT_EXPLANATIONS['recurring-lapsed']}
    >
      {findings.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center">
          <span className="pill bg-success-soft text-success">✓ הכל בזמן</span>
          <p className="text-xs text-muted-foreground">כל ההוצאות הקבועות הופיעו בזמן</p>
          <p className="text-2xs text-muted-foreground/80 max-w-[260px]">
            כרטיס נדיר — מתמלא רק כשהיום הנוכחי עבר את היום-בחודש הצפוי של תבנית מסוימת ועדיין לא הופיע חיוב. בתחילת החודש או כשהכל בזמן, יישאר ריק.
          </p>
        </div>
      ) : (
        <ul className="divide-y text-sm">
          {findings.slice(0, 5).map((f) => (
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
                    צפוי עד {f.expectedByDate} · באיחור {f.daysOverdue} ימים
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="font-semibold tabular-nums text-muted-foreground">
                    {formatIls(f.expectedIls, { decimals: false })}
                    <ChevronLeft className="ms-0.5 inline-block size-2.5 rtl-flip opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
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
