/**
 * Auto-compute the charge (debit) date from a transaction date + cutoff day.
 *
 * Israeli credit-card billing rule (default cutoff = 10):
 *   transaction day ≤ cutoffDay  →  charged on the cutoffDay of the SAME month
 *   transaction day >  cutoffDay  →  charged on the cutoffDay of the NEXT month
 *
 * Works in both server actions and client-side form components.
 *
 * @param dateStr     ISO date string "YYYY-MM-DD"
 * @param cutoffDay   Card's cutoff day (1-31). Pass 0 to treat as 10 (manual default).
 * @returns           ISO date string "YYYY-MM-DD" or null if dateStr is invalid
 */
export function autoComputeChargeDate(dateStr: string, cutoffDay: number = 10): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  // cutoffDay=0 means the account is bank-direct / immediate settlement.
  // There is no separate charge date — the debit happens the same day.
  // Return null so callers treat it as "already charged" and billing month
  // falls back to computeBillingMonth(transactionDate, 0) = the transaction's own month.
  if (cutoffDay === 0) return null;

  const cutoff = cutoffDay;

  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (day <= cutoff) {
    // Charge this month on the cutoff day
    return `${year}-${String(month).padStart(2, '0')}-${String(cutoff).padStart(2, '0')}`;
  } else {
    // Charge next month on the cutoff day
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    return `${ny}-${String(nm).padStart(2, '0')}-${String(cutoff).padStart(2, '0')}`;
  }
}
