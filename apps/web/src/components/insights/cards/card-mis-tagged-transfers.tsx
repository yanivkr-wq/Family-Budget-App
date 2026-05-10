'use client';

/**
 * Insight #8d — Possible mis-tagged transfer candidates.
 *
 * Now ACTIONABLE: each pair has two buttons —
 *   • "סמן כהעברה" — calls markPairAsTransfer server action; on success, the
 *     row collapses with a "סומן" pill and the page re-validates so it
 *     disappears from the next render.
 *   • "בדוק" — deep-links to /transactions filtered by the candidate's date
 *     range so the user can see both sides in context before deciding.
 */

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { formatIls } from '@fba/shared';
import { ArrowLeftRight, Check, Loader2, ExternalLink } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { TransferCandidatePair } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';
import { markPairAsTransfer } from '@/app/(app)/insights/actions';

const INFO = INSIGHT_EXPLANATIONS['mis-tagged-transfers'];

interface Props {
  windowLabel: string;
  pairs: TransferCandidatePair[];
}

export function CardMisTaggedTransfers({ windowLabel, pairs }: Props) {
  if (pairs.length === 0) {
    return (
      <InsightCard
        id="mis-tagged-transfers"
        title="העברות שלא קושרו"
        subtitle={windowLabel}
        icon={<ArrowLeftRight className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INFO}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="pill bg-success-soft text-success">✓ תקין</span>
          <p className="text-xs text-muted-foreground">כל ההעברות בין חשבונות מקושרות</p>
        </div>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      id="mis-tagged-transfers"
      title="העברות שלא קושרו"
      subtitle={windowLabel}
      icon={<ArrowLeftRight className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INFO}
    >
      <div className="flex h-full flex-col">
        <p className="text-xs text-muted-foreground mb-2">
          זוגות תנועות שנראים כמו העברות בין חשבונות אך לא סומנו ככאלה
        </p>
        <ul className="divide-y text-sm">
          {pairs.slice(0, 4).map((p) => (
            <PairRow key={`${p.outId}-${p.inId}`} pair={p} />
          ))}
        </ul>
      </div>
    </InsightCard>
  );
}

function PairRow({ pair }: { pair: TransferCandidatePair }) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<{ ok: boolean; message: string } | null>(null);

  function handleMark() {
    startTransition(async () => {
      const result = await markPairAsTransfer(pair.outId, pair.inId);
      setResolved(result);
    });
  }

  // Drill URL: /transactions filtered by the date range so both sides show.
  // Use the earlier date as start, later as end. Hits the existing
  // ?dateFrom=&dateTo= params on /transactions.
  const start = pair.outDate <= pair.inDate ? pair.outDate : pair.inDate;
  const end = pair.outDate <= pair.inDate ? pair.inDate : pair.outDate;
  const drillHref = `/transactions?dateFrom=${start}&dateTo=${end}`;

  return (
    <li className="space-y-1.5 py-2.5">
      {/* Row 1: accounts → arrow → amount */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs">
          {pair.outAccount} ← {pair.inAccount}
        </span>
        <span className="font-semibold tabular-nums text-xs">
          {formatIls(pair.amountIls, { decimals: false })}
        </span>
      </div>

      {/* Row 2: dates */}
      <p className="text-2xs text-muted-foreground tabular-nums">
        {pair.outDate}
        {pair.outDate !== pair.inDate && ` / ${pair.inDate}`}
      </p>

      {/* Row 3: action buttons OR resolved status */}
      {resolved ? (
        <p
          className={`flex items-center gap-1 text-2xs font-medium ${
            resolved.ok ? 'text-success' : 'text-destructive'
          }`}
        >
          {resolved.ok ? <Check className="size-3" aria-hidden /> : null}
          {resolved.message}
        </p>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleMark}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success-soft px-2 py-1 text-2xs font-medium text-success hover:bg-success/15 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3" aria-hidden />
            )}
            סמן כהעברה
          </button>
          <Link
            href={drillHref}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3" aria-hidden />
            בדוק
          </Link>
        </div>
      )}
    </li>
  );
}
