/**
 * Phase 8 — Per-category breakdown for either charge-date OR transaction-date
 * basis. Both views use the same SQL shape (category × total × count) and
 * the same visualization, just with different inputs.
 *
 *   • Charge-date  → "what hit my bank this billing cycle"
 *   • Transaction-date → "what I bought this calendar month"
 *
 * Visual: horizontal bar list ordered by amount, with a colored swatch per
 * category. Top 8 shown explicitly, rest collapsed into "אחרות". Total at
 * the top frames the picture.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Wallet, ShoppingBag, ChevronLeft } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { CategoryByDateBucket } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

const FALLBACK_COLOR = 'hsl(215 65% 35%)';

interface Props {
  /** 'charge' = bank-cycle view; 'txn' = calendar-month buying view. */
  basis: 'charge' | 'txn';
  /** Hebrew sub-header (e.g. "אפריל 2026" or "מאי 2026 (מחזור)"). */
  subtitle: string;
  buckets: CategoryByDateBucket[];
  /**
   * YYYY-MM string used to build calendar-month date filters when drilling.
   * Optional so older callers without month context still render — they just
   * get a category-only drill (no date range).
   */
  monthYM?: string;
}

/** First/last day of a YYYY-MM string, in YYYY-MM-DD format. */
function monthRange(ym?: string): { from: string; to: string } | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  // last day of month: day 0 of next month
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function CardCategoryByDate({ basis, subtitle, buckets, monthYM }: Props) {
  const total = buckets.reduce((s, b) => s + b.totalIls, 0);
  const top = buckets.slice(0, 8);
  const restSum = buckets.slice(8).reduce((s, b) => s + b.totalIls, 0);
  const restCount = buckets.slice(8).length;
  const max = buckets[0]?.totalIls ?? 1;

  const meta =
    basis === 'charge'
      ? {
          id: 'category-by-charge-date',
          title: 'הוצאות לפי קטגוריה — מועד חיוב',
          icon: <Wallet className="size-4 shrink-0" aria-hidden />,
          info: INSIGHT_EXPLANATIONS['category-by-charge-date'],
        }
      : {
          id: 'category-by-txn-date',
          title: 'הוצאות לפי קטגוריה — מועד עסקה',
          icon: <ShoppingBag className="size-4 shrink-0" aria-hidden />,
          info: INSIGHT_EXPLANATIONS['category-by-txn-date'],
        };

  return (
    <InsightCard
      id={meta.id}
      title={meta.title}
      subtitle={subtitle}
      icon={meta.icon}
      tone="accent"
      info={meta.info}
    >
      {buckets.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          אין הוצאות מקוטלגות בטווח הזה
        </p>
      ) : (
        <div className="flex h-full flex-col">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums">{formatIls(total, { decimals: false })}</span>
            <span className="text-2xs text-muted-foreground">סך {buckets.length} קטגוריות</span>
          </div>

          <ul className="flex-1 space-y-2">
            {top.map((b) => {
              const pct = (b.totalIls / max) * 100;
              const color = b.color ?? FALLBACK_COLOR;
              const range = monthRange(monthYM);
              const params = new URLSearchParams({
                categoryId: b.categoryId,
                sign: 'expense',
              });
              if (range) {
                params.set('dateFrom', range.from);
                params.set('dateTo', range.to);
              }
              return (
                <li key={b.categoryId}>
                  <Link
                    href={`/transactions?${params.toString()}`}
                    className="group block -mx-1 rounded-md px-1 py-1 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <span className="truncate font-medium group-hover:text-accent transition-colors" title={b.category}>{b.category}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums flex items-center">
                        {formatIls(b.totalIls, { decimals: false })}
                        <ChevronLeft className="ms-0.5 inline-block size-2.5 rtl-flip opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                      </span>
                    </div>
                    <div className="mt-1">
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.max(4, pct)}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {restCount > 0 && (
              <li className="text-2xs text-muted-foreground tabular-nums px-1">
                + עוד {restCount} קטגוריות: {formatIls(restSum, { decimals: false })}
              </li>
            )}
          </ul>
        </div>
      )}
    </InsightCard>
  );
}
