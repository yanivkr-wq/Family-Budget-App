'use client';

/**
 * Per-page Excel download button for the transactions table.
 *
 * Hits the same /api/export route the admin export page uses, but pre-scopes
 * the date range to the current billing month so a single click produces
 * "this month's transactions" without the user needing to specify dates.
 *
 * Lives in the filter-row's extraControls slot so it sits with the other
 * page-level data actions (Show transfers / CC view toggle).
 *
 * Uses DownloadButton so the user gets a "מוריד…" spinner state — the
 * server-side Excel assembly takes a moment and double-clicking shouldn't
 * fire two requests.
 */

import { FileSpreadsheet } from 'lucide-react';
import { DownloadButton } from '@/components/ui/download-button';

interface Props {
  /** Current calendar/billing month, e.g. "2026-05". */
  billingMonth: string;
}

/** Compute first/last day of the YYYY-MM month as YYYY-MM-DD strings. */
function monthRange(ym: string): { from: string; to: string } {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  // Day 0 of next month = last day of this month (handles 28/29/30/31).
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to:   `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function TransactionsExportButton({ billingMonth }: Props) {
  const { from, to } = monthRange(billingMonth);
  const href = `/api/export?sheets=transactions&from=${from}&to=${to}`;

  return (
    <DownloadButton
      href={href}
      defaultFilename={`family-budget_transactions_${billingMonth}.xlsx`}
      className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-success-soft/40 hover:text-success hover:border-success/40 disabled:opacity-50 disabled:cursor-wait transition-colors"
      title={`הורד את כל התנועות של ${billingMonth} כקובץ Excel`}
      aria-label={`הורד תנועות ${billingMonth} לאקסל`}
    >
      <span className="inline-flex items-center gap-1">
        <FileSpreadsheet className="size-3.5" />
        Excel
      </span>
    </DownloadButton>
  );
}
