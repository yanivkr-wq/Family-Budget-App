/**
 * Resolve the time-window selector to concrete date ranges / billing months
 * the aggregation queries can use.
 *
 * Per the spec (§3 D1 + §4): MTD uses billing-month logic to match the rest
 * of the app; 30D / 90D / Custom use calendar transactionDate windows.
 */

import { activeBillingMonth } from '@fba/db';
import type { InsightWindow, InsightWindowKind } from './types';

export const DEFAULT_WINDOW_KIND: InsightWindowKind = 'mtd';

/** Read window from URL searchParams. Falls back to MTD. */
export function readWindow(sp: URLSearchParams | Record<string, string | undefined>): InsightWindow {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    return sp[k];
  };
  const raw = (get('window') ?? DEFAULT_WINDOW_KIND).toLowerCase();
  const kind = (['mtd', '30d', '90d', 'custom'].includes(raw) ? raw : DEFAULT_WINDOW_KIND) as InsightWindowKind;

  if (kind === 'mtd') {
    return { kind, billingMonth: activeBillingMonth(10) };
  }
  if (kind === 'custom') {
    return {
      kind,
      dateFrom: get('from') ?? isoDaysAgo(30),
      dateTo: get('to') ?? isoToday(),
    };
  }
  const days = kind === '30d' ? 30 : 90;
  return {
    kind,
    dateFrom: isoDaysAgo(days),
    dateTo: isoToday(),
  };
}

/** YYYY-MM-DD for "today" in Israel time. */
export function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** YYYY-MM-DD for "today minus N days" in Israel time. */
export function isoDaysAgo(n: number): string {
  const t = new Date();
  t.setDate(t.getDate() - n);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}

/**
 * Number of months covered by the window (used to gate insights that need
 * monthly buckets — e.g. trend insights need ≥3). For MTD this is 1.
 */
export function windowMonthCount(w: InsightWindow): number {
  if (w.kind === 'mtd') return 1;
  if (w.kind === '30d') return 1;
  if (w.kind === '90d') return 3;
  // Custom: rough month count between dateFrom/dateTo
  const f = new Date(w.dateFrom!);
  const t = new Date(w.dateTo!);
  const diffDays = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1);
  return Math.max(1, Math.round(diffDays / 30));
}

/** Hebrew label for the active window — shown in card sub-headers. */
export function windowLabelHe(w: InsightWindow): string {
  if (w.kind === 'mtd') return `חודש ${w.billingMonth}`;
  if (w.kind === '30d') return '30 ימים אחרונים';
  if (w.kind === '90d') return '90 ימים אחרונים';
  return `${w.dateFrom} → ${w.dateTo}`;
}
