/**
 * Insight #8a — Untagged transactions (categoryId IS NULL).
 * Server Component. Headline number + top merchants + drill link to /transactions.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Tag } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { UntaggedFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const INFO = INSIGHT_EXPLANATIONS['untagged-transactions'];

interface Props {
  windowLabel: string;
  finding: UntaggedFinding;
}

export function CardUntaggedTransactions({ windowLabel, finding }: Props) {
  if (finding.count === 0) return <CleanCard windowLabel={windowLabel} />;

  return (
    <InsightCard id="untagged-transactions" title="תנועות ללא קטגוריה" subtitle={windowLabel} icon={<Tag className="size-4 shrink-0" aria-hidden />} tone="warning" info={INFO}>
      <div className="flex h-full flex-col">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums text-warning">
            {finding.count.toLocaleString('he-IL')}
          </span>
          <span className="text-xs text-muted-foreground">
            סה"כ {formatIls(finding.totalAbsIls, { decimals: false })}
          </span>
        </div>

        {finding.topMerchants.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              בתי עסק מובילים
            </p>
            <ul className="text-xs">
              {finding.topMerchants.slice(0, 4).map((m) => (
                <li key={m.merchant}>
                  <Link
                    href={`/transactions?categoryId=none&text=${encodeURIComponent(m.merchant)}`}
                    className="group flex items-baseline justify-between gap-2 -mx-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/40"
                  >
                    <span className="truncate text-foreground group-hover:text-accent transition-colors" title={m.merchant}>
                      {m.merchant}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{m.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link
          href="/transactions?categoryId=none"
          className="btn-secondary mt-auto pt-3 text-xs"
        >
          תקן עכשיו
        </Link>
      </div>
    </InsightCard>
  );
}

function CleanCard({ windowLabel }: { windowLabel: string }) {
  return (
    <InsightCard id="untagged-transactions" title="תנועות ללא קטגוריה" subtitle={windowLabel} icon={<Tag className="size-4 shrink-0" aria-hidden />} tone="success" info={INFO}>
      <CleanState message="כל התנועות מקוטלגות" />
    </InsightCard>
  );
}

function CleanState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span className="pill bg-success-soft text-success">✓ תקין</span>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
