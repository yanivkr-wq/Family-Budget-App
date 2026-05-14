'use client';

/**
 * Collapsible transactions strip shown on the main dashboard.
 * RTL-first design: date → merchant → category → amount (right-to-left reading order).
 * Includes a mini income/expense summary bar and per-day grouping.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Clock, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react';
import { formatIls, formatDateHe } from '@fba/shared';
import { cn } from '@/lib/utils';

export interface DashboardTx {
  id: string;
  date: string;            // YYYY-MM-DD
  chargeDate: string | null;
  merchant: string;
  amount: string;          // signed numeric string
  categoryName: string | null;
  categoryColor: string | null;
}

const STORAGE_KEY = 'dashboard-tx-open';

export function DashboardTransactionsSection({
  transactions,
  month,
  totalCount,
  monthTotalIncome,
  monthTotalExpenses,
}: {
  transactions: DashboardTx[];
  month: string;
  totalCount: number;
  /** Optional: full-month income computed server-side. When provided, the
   *  summary bar uses this instead of summing the visible (limited) array.
   *  Keeps the strip aligned with the top KPI cards on busy months. */
  monthTotalIncome?: number;
  /** Same as above for expenses (positive number, already abs'd). */
  monthTotalExpenses?: number;
}) {
  // Default open; sync with localStorage after mount
  const [isOpen, setIsOpen] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setIsOpen(stored === 'true');
  }, []);

  function toggle() {
    const next = !isOpen;
    setIsOpen(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  // ── Derived summary figures ──────────────────────────────────────────────
  // Prefer server-computed full-month totals when provided so the strip
  // matches the top KPI cards (the visible array is capped at 20 rows).
  const totalExpenses = monthTotalExpenses ?? transactions
    .filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const totalIncome = monthTotalIncome ?? transactions
    .filter((t) => Number(t.amount) >= 0)
    .reduce((s, t) => s + Number(t.amount), 0);

  // ── Group transactions by date ───────────────────────────────────────────
  const grouped: { date: string; items: DashboardTx[] }[] = [];
  for (const tx of transactions) {
    const last = grouped[grouped.length - 1];
    if (last && last.date === tx.date) {
      last.items.push(tx);
    } else {
      grouped.push({ date: tx.date, items: [tx] });
    }
  }

  const remaining = totalCount - transactions.length;

  return (
    <section className="rounded-lg border bg-card overflow-hidden" dir="rtl">

      {/* ── Header ── */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors"
        aria-expanded={isOpen}
      >
        {/* Right side: title + count */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">עסקאות החודש</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {totalCount}
          </span>
        </div>

        {/* Left side: link + chevron */}
        <div className="flex items-center gap-3" dir="ltr">
          <Link
            href={`/transactions?month=${month}`}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            ראה הכל
            <ExternalLink className="size-3" />
          </Link>
          {isOpen
            ? <ChevronUp className="size-4 text-muted-foreground" />
            : <ChevronDown className="size-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* ── Body ── */}
      {isOpen && (
        <div className="border-t">

          {/* ── Mini summary bar ── */}
          {(totalExpenses > 0 || totalIncome > 0) && (
            <div className="flex items-center gap-x-5 gap-y-0.5 flex-wrap border-b bg-muted/30 px-4 py-1.5 text-xs">
              {totalExpenses > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingDown className="size-3.5 shrink-0 text-destructive/70" />
                  <span>הוצאות:</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatIls(totalExpenses, { decimals: false })}
                  </span>
                  {totalCount > transactions.length && (
                    <span className="text-muted-foreground/60">
                      ({transactions.length} מוצגות מתוך {totalCount})
                    </span>
                  )}
                </span>
              )}
              {totalIncome > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="size-3.5 shrink-0 text-success" />
                  <span>הכנסות:</span>
                  <span className="font-semibold tabular-nums text-success">
                    {formatIls(totalIncome, { decimals: false })}
                  </span>
                </span>
              )}
            </div>
          )}

          {transactions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              אין עסקאות לחודש זה
            </p>
          ) : (
            <ul className="divide-y">
              {grouped.map(({ date, items }) => (
                <li key={date}>
                  {/* ── Date group header (only when multiple groups) ── */}
                  {grouped.length > 1 && (
                    <div className="sticky top-0 bg-muted/40 px-4 py-0.5 text-[10px] font-medium text-muted-foreground border-b">
                      {formatDateHe(date)}
                    </div>
                  )}

                  {/* ── Transactions for this date ── */}
                  <ul className="divide-y divide-muted/60">
                    {items.map((tx) => {
                      const amount    = Number(tx.amount);
                      const isIncome  = amount >= 0;
                      const isPending = !!tx.chargeDate && tx.chargeDate > today;

                      return (
                        <li key={tx.id}>
                          <Link
                            href={`/transactions?month=${month}`}
                            className={cn(
                              'flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/30 transition-colors',
                              // Income rows get a subtle right-border highlight (right = start in RTL)
                              isIncome && 'border-r-2 border-success/50',
                            )}
                          >
                            {/* ① Date — rightmost (RTL start). Single-line dd/mm to save height. */}
                            <time
                              dateTime={tx.date}
                              className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground"
                            >
                              <span className="font-medium text-foreground/80">
                                {tx.date.slice(8)}
                              </span>
                              <span className="text-muted-foreground/70">
                                /{tx.date.slice(5, 7)}
                              </span>
                            </time>

                            {/* ② Category colour dot */}
                            <span
                              className="size-2 rounded-full shrink-0"
                              style={{ background: tx.categoryColor ?? 'hsl(var(--muted-foreground))' }}
                            />

                            {/* ③ Merchant + category name — inline on one line */}
                            <div className="flex-1 min-w-0 truncate text-sm leading-tight">
                              <span className="font-medium">{tx.merchant}</span>
                              {tx.categoryName && (
                                <span className="text-[11px] text-muted-foreground">
                                  {' · '}{tx.categoryName}
                                </span>
                              )}
                            </div>

                            {/* ④ Pending badge */}
                            {isPending && (
                              <span className="flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning shrink-0">
                                <Clock className="size-2.5" />
                                ממתין
                              </span>
                            )}

                            {/* ⑤ Amount — leftmost (RTL end) */}
                            <span
                              className={cn(
                                'shrink-0 text-sm font-semibold tabular-nums',
                                isIncome ? 'text-success' : 'text-foreground',
                              )}
                            >
                              {isIncome ? '+' : '−'}
                              {formatIls(Math.abs(amount), { decimals: false })}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {/* ── "N more" footer ── */}
          {remaining > 0 && (
            <div className="border-t px-4 py-1.5 text-center">
              <Link
                href={`/transactions?month=${month}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                dir="ltr"
              >
                <span dir="rtl">+ {remaining} עסקאות נוספות — ראה הכל</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
