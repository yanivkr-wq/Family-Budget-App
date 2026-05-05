// Hebrew/Israel-aware formatters used across the app.

const ILS_FORMATTER = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
});

const ILS_NO_DECIMALS = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

const NUMBER_HE = new Intl.NumberFormat('he-IL');

const HE_DATE = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const HE_MONTH = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
});

const HE_DAY = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

const HE_DATE_SHORT = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'short', // e.g. "אפר׳"
});

export function formatIls(amount: number | string, opts?: { decimals?: boolean }): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return opts?.decimals === false ? ILS_NO_DECIMALS.format(n) : ILS_FORMATTER.format(n);
}

export function formatNumber(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(v) ? NUMBER_HE.format(v) : '—';
}

export function formatDateHe(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return HE_DATE.format(d);
}

export function formatMonthHe(yearMonth: string): string {
  // yearMonth: 'YYYY-MM'
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  return HE_MONTH.format(new Date(y, m - 1, 1));
}

export function formatDayHe(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return HE_DAY.format(d);
}

/** Short date: day + abbreviated month, no year. E.g. "11 באפר׳" */
export function formatShortDateHe(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;
  return HE_DATE_SHORT.format(d);
}

export function formatPercent(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

export function formatSignedIls(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${ILS_FORMATTER.format(v)}`;
}
