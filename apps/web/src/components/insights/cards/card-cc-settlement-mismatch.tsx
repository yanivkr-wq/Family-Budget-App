/**
 * Insight #8f — CC Settlement Reconciliation.
 *
 * Surfaces (CC × month) cycles where the bank's settlement line and the sum
 * of CC details don't match. Each row shows both numbers + the gap, with a
 * direct hint to re-upload the CC excel for that cycle.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { ArrowUpDown, AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { CcSettlementMismatch } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  findings: CcSettlementMismatch[];
}

export function CardCcSettlementMismatch({ windowLabel, findings }: Props) {
  if (findings.length === 0) {
    return (
      <InsightCard
        id="cc-settlement-mismatch"
        title="התאמת חיובי אשראי"
        subtitle={windowLabel}
        icon={<ArrowUpDown className="size-4 shrink-0" aria-hidden />}
        tone="success"
        info={INSIGHT_EXPLANATIONS['cc-settlement-mismatch']}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span className="pill bg-success-soft text-success">✓ תקין</span>
          <p className="text-xs text-muted-foreground">פירוטי האשראי מסתדרים מול חיובי הבנק</p>
          <p className="text-2xs text-muted-foreground/80 max-w-[260px]">
            כל מחזור חיוב CC מתחת לטולרנס של ₪10 מהשורה המצרפית בבנק
          </p>
        </div>
      </InsightCard>
    );
  }

  // Group by CC account so the user sees the picture per card
  const byCc = new Map<string, { name: string; rows: CcSettlementMismatch[] }>();
  for (const f of findings) {
    if (!byCc.has(f.ccAccountId)) byCc.set(f.ccAccountId, { name: f.ccAccountName, rows: [] });
    byCc.get(f.ccAccountId)!.rows.push(f);
  }
  const totalGap = findings.reduce((s, f) => s + Math.abs(f.gap), 0);

  return (
    <InsightCard
      id="cc-settlement-mismatch"
      title="התאמת חיובי אשראי"
      subtitle={windowLabel}
      icon={<ArrowUpDown className="size-4 shrink-0" aria-hidden />}
      tone="warning"
      info={INSIGHT_EXPLANATIONS['cc-settlement-mismatch']}
    >
      <div className="flex h-full flex-col">
        {/* Headline: total gap across all mismatched cycles */}
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums text-warning">
            {formatIls(totalGap, { decimals: false })}
          </span>
          <span className="text-2xs text-muted-foreground">
            סך פערים על פני {findings.length.toLocaleString('he-IL')} מחזורים
          </span>
        </div>

        <ul className="flex-1 space-y-2.5">
          {[...byCc.entries()].slice(0, 3).map(([ccId, group]) => (
            <li key={ccId} className="space-y-1">
              <p className="truncate text-xs font-medium" title={group.name}>
                {group.name}
              </p>
              <ul className="space-y-1 ps-1">
                {group.rows.slice(0, 3).map((r) => {
                  // gap > 0 means details > settlement (extra detail rows that
                  // shouldn't be there OR settlement under-reported)
                  // gap < 0 means details < settlement (CC export is missing rows)
                  const detailsLess = r.gap < 0;
                  // Drill: filter transactions to that CC × billing month so the
                  // user can scan the detail rows quickly. Billing month is
                  // YYYY-MM; expand to a calendar month range.
                  const [yStr, mStr] = r.billingMonth.split('-');
                  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
                  const drill = `/transactions?accountId=${encodeURIComponent(r.ccAccountId)}&dateFrom=${r.billingMonth}-01&dateTo=${r.billingMonth}-${String(lastDay).padStart(2, '0')}`;
                  return (
                    <li key={`${ccId}-${r.billingMonth}`}>
                      <Link
                        href={drill}
                        className="group block text-2xs -mx-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-muted-foreground tabular-nums group-hover:text-accent transition-colors">{r.billingMonth}</span>
                          <span className="flex items-center gap-1 font-medium text-warning tabular-nums">
                            {detailsLess ? <ArrowDown className="size-2.5" /> : <ArrowUp className="size-2.5" />}
                            פער {formatIls(Math.abs(r.gap), { decimals: false })}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 text-muted-foreground/80 tabular-nums">
                          <span>פירוט {formatIls(r.detailsSum, { decimals: false })} ({r.detailsCount})</span>
                          <span>בנק {formatIls(r.settlementSum, { decimals: false })} ({r.settlementCount})</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>

        <Link
          href="/import"
          className="btn-secondary mt-auto pt-3 text-xs"
        >
          העלה קובץ CC חדש
        </Link>
      </div>
    </InsightCard>
  );
}
