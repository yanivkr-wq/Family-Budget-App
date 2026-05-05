// Compute the billing month a transaction belongs to, given the account's cutoff_day.
//
// Rule (per the user's Excel convention):
//   - If transaction_day <= cutoff_day: billing_month = transaction_month
//   - If transaction_day >  cutoff_day: billing_month = transaction_month + 1
//   - cutoff_day = 0 means "always the actual month" (used for bank-direct lines:
//     mortgage, recurring debits, ATM, deposits, salary).
//
// Inputs are normalized strings to avoid timezone surprises across the wire.

export function computeBillingMonth(transactionDate: string, cutoffDay: number): string {
  // transactionDate: 'YYYY-MM-DD'
  const [yearStr, monthStr, dayStr] = transactionDate.split('-');
  if (!yearStr || !monthStr || !dayStr) {
    throw new Error(`Invalid transactionDate: ${transactionDate}`);
  }
  let year = Number(yearStr);
  let month = Number(monthStr);
  const day = Number(dayStr);

  if (cutoffDay > 0 && day > cutoffDay) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function nextBillingMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function addMonths(yearMonth: string, n: number): string {
  let [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  m += n;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function currentBillingMonth(now: Date = new Date(), tz = 'Asia/Jerusalem'): string {
  // Format using Israel timezone (assumes Node 22 with full ICU)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

/**
 * The billing-cycle month that "today" belongs to, accounting for the cutoff day.
 *
 * Differs from currentBillingMonth() when today is PAST the cutoff:
 *   - Apr 15, cutoff=10 → active billing month = May 2026 (transactions from Apr 15 will
 *     be charged on May 10, so they belong to the May billing cycle).
 *   - May 3, cutoff=10  → active billing month = May 2026 (day 3 ≤ 10, still in May cycle).
 *
 * Use this as the default month on the dashboard / transactions pages so the user
 * always lands on the billing cycle they're currently "living in".
 */
export function activeBillingMonth(
  cutoffDay: number = 10,
  now: Date = new Date(),
  tz = 'Asia/Jerusalem',
): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? '0');

  if (cutoffDay > 0 && d > cutoffDay) {
    // Today's transactions will be billed NEXT month
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * The calendar date range of a billing cycle (the actual transaction dates it covers).
 *
 * For billingMonth='2026-05', cutoff=10:
 *   → { start: '2026-04-11', end: '2026-05-10' }
 *   Meaning: transactions dated Apr 11–May 10 belong to the May 2026 billing cycle.
 *
 * Returns null when cutoffDay=0 (bank-direct accounts — no billing cycle concept).
 */
export function billingCycleRange(
  billingMonth: string,
  cutoffDay: number = 10,
): { start: string; end: string } | null {
  if (cutoffDay <= 0) return null;
  const [yStr, mStr] = billingMonth.split('-');
  if (!yStr || !mStr) return null;
  const y = Number(yStr);
  const m = Number(mStr);

  // Cycle ends on the cutoff day of the billing month (e.g., May 10)
  const end = `${billingMonth}-${String(cutoffDay).padStart(2, '0')}`;

  // Cycle starts the day AFTER the cutoff of the PREVIOUS month (e.g., Apr 11)
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const start = `${py}-${String(pm).padStart(2, '0')}-${String(cutoffDay + 1).padStart(2, '0')}`;

  return { start, end };
}

/**
 * Compute the actual charge date — when the money leaves the user's bank account.
 *
 * Rules:
 *  - 'immediate' schedule (banks, debit cards): chargeDate = transactionDate
 *  - 'monthly_billing' (credit cards):
 *      if transactionDate.day <= cutoffDay  → chargeDay of SAME month
 *      otherwise                            → chargeDay of NEXT month
 *  - Forex exception: if isForex, charge is immediate even on monthly_billing.
 */
export function computeChargeDate(
  transactionDate: string,
  account: {
    paymentSchedule: 'immediate' | 'monthly_billing';
    chargeDay: number;
    cutoffDay: number;
  },
  opts?: { isForex?: boolean },
): string {
  if (account.paymentSchedule === 'immediate' || opts?.isForex) {
    return transactionDate;
  }
  const [yStr, mStr, dStr] = transactionDate.split('-');
  if (!yStr || !mStr || !dStr) return transactionDate;
  let y = Number(yStr);
  let m = Number(mStr);
  const day = Number(dStr);
  const cutoff = account.cutoffDay > 0 ? account.cutoffDay : 10;
  const charge = account.chargeDay > 0 ? account.chargeDay : 10;
  if (day > cutoff) {
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(charge).padStart(2, '0')}`;
}
