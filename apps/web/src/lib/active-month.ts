/**
 * Persistent active-month state across pages.
 *
 * Single user complaint that drove this: "when I select April on the
 * dashboard and click to /transactions, the month resets to current —
 * keep it on the selected month." Same pattern as the View tab cookie
 * (`fba_view`), just for `?month`.
 *
 * Resolution order for "what month to show":
 *   1. URL search param (?month=YYYY-MM) — explicit, takes precedence
 *   2. fba_month cookie                  — what the user last picked
 *   3. activeBillingMonth(10)            — global default (current cycle)
 *
 * When the user explicitly picks a month (via MonthSwitcher), the cookie
 * is updated client-side so subsequent navigations preserve it.
 */

import { cookies } from 'next/headers';

export const MONTH_COOKIE = 'fba_month';
export const MONTH_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v);
}

/**
 * Resolve the active billing month for a server-rendered page.
 * Pass the URL's month-search-param if present; this helper handles the
 * cookie fallback and returns the default ONLY when both are absent.
 *
 * Returns `null` when no value is found in URL or cookie — callers
 * substitute their own page-specific default (most use activeBillingMonth(10)).
 */
export async function readActiveMonth(urlParam?: string): Promise<string | null> {
  if (isValidMonth(urlParam)) return urlParam;
  const cookieMonth = (await cookies()).get(MONTH_COOKIE)?.value;
  if (isValidMonth(cookieMonth)) return cookieMonth;
  return null;
}
