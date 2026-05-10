/**
 * Insight #1 — Unusual transaction (z-score outlier).
 * Server Component. List up to top 5 outliers with merchant + amount + delta.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { TrendingUp, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { OutlierFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: OutlierFinding[];
}

export function CardUnusualTransaction({ windowLabel, findings }: Props) {
  return (
    <InsightCard
      id="unusual-transaction"
      title="תנועות חריגות"
      subtitle={windowLabel}
      icon={<TrendingUp className="size-4 shrink-0" aria-hidden />}
      tone="destructive"
      info={INSIGHT_EXPLANATIONS['unusual-transaction']}
    >
      {findings.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y text-sm">
          {findings.slice(0, 5).map((f) => (
            <li key={f.id}>
              <Link
                href={`/transactions?text=${encodeURIComponent(f.merchant)}&highlight=${f.id}`}
                className="group flex items-baseline justify-between gap-3 -mx-1 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium group-hover:text-accent transition-colors" title={f.merchant}>
                    {f.merchant}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {f.date} · ממוצע: {formatIls(f.merchantMean, { decimals: false })}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="font-semibold tabular-nums text-destructive">
                    {formatIls(Math.abs(f.amountIls), { decimals: false })}
                  </p>
                  <p className="text-2xs text-muted-foreground tabular-nums">
                    z = {f.zScore > 0 ? '+' : ''}
                    {f.zScore.toFixed(1)}
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

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center">
      <p className="text-xs text-muted-foreground">אין תנועות חריגות בטווח</p>
      <p className="text-2xs text-muted-foreground/80">
        מצריך לפחות 3 תנועות באותו בית עסק כדי לחשב סטיית תקן
      </p>
    </div>
  );
}
