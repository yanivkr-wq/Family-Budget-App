/**
 * NEW — Refunds & "found money".
 *
 * Surfaces positive amounts that landed in expense categories — the kind of
 * money that comes back (returns, refunds, reimbursements, cashback) and is
 * easy to miss when scanning expense lists.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Undo2, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { RefundFinding } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  rows: RefundFinding[];
  totalIls: number;
}

export function CardRefundsAndCredits({ windowLabel, rows, totalIls }: Props) {
  if (rows.length === 0) {
    return (
      <InsightCard
        id="refunds-and-credits"
        title="החזרים וזיכויים"
        subtitle={windowLabel}
        icon={<Undo2 className="size-4 shrink-0" aria-hidden />}
        tone="neutral"
        info={INSIGHT_EXPLANATIONS['refunds-and-credits']}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs text-muted-foreground">לא נמצאו החזרים בטווח הנבחר</p>
          <p className="text-2xs text-muted-foreground/80">
            כל סכום חיובי שנכנס לקטגוריית הוצאה יופיע כאן
          </p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="refunds-and-credits"
      title="החזרים וזיכויים"
      subtitle={windowLabel}
      icon={<Undo2 className="size-4 shrink-0" aria-hidden />}
      tone="success"
      info={INSIGHT_EXPLANATIONS['refunds-and-credits']}
    >
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums text-success">
            +{formatIls(totalIls, { decimals: false })}
          </span>
          <span className="text-2xs text-muted-foreground">
            {rows.length.toLocaleString('he-IL')} החזרים
          </span>
        </div>

        <ul className="divide-y text-sm">
          {rows.slice(0, 5).map((r) => (
            <li key={r.id}>
              <Link
                href={`/transactions?text=${encodeURIComponent(r.merchant)}&highlight=${r.id}`}
                className="group flex items-baseline justify-between gap-3 -mx-1 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs group-hover:text-accent transition-colors" title={r.merchant}>
                    {r.merchant}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {r.date}{r.category ? ` · ${r.category}` : ''}
                  </p>
                </div>
                <p className="shrink-0 text-xs font-semibold tabular-nums text-success flex items-center">
                  +{formatIls(r.amountIls, { decimals: false })}
                  <ChevronLeft className="ms-0.5 inline-block size-2.5 rtl-flip opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </InsightCard>
  );
}
