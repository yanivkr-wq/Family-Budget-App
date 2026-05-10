'use client';

/**
 * Month-picker for /transactions. Replaces the old prev/next arrows with
 * a proper dropdown so the user can jump to any month directly. The
 * arrows are kept as small steppers on either side for one-tap moves to
 * the immediate neighbours.
 *
 * Range shown: 12 months back to 1 month forward, centered on the
 * currently-active billing month. That covers normal use (looking at
 * recent history) without a giant dropdown.
 */

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthHe } from '@fba/shared';

const MONTH_COOKIE = 'fba_month';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year, mirrors active-month.ts

/**
 * Persist the active month to a cookie so navigating to another page
 * (e.g. /transactions → /) preserves the choice. Pages read this cookie
 * via readActiveMonth() in @/lib/active-month.
 *
 * Centralized here (and also in the dropdown / prev / next anchors via
 * onClick) so every interaction with the month picker stamps the cookie.
 */
function rememberMonth(m: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${MONTH_COOKIE}=${m}; path=/; max-age=${COOKIE_MAX_AGE_S}; SameSite=Lax`;
}

function addMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  let nm = m! + delta;
  let ny = y!;
  while (nm > 12) { nm -= 12; ny++; }
  while (nm < 1)  { nm += 12; ny--; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function buildOptions(activeMonth: string): string[] {
  // 12 months back .. 1 month forward (most recent first → reverse-chronological)
  const out: string[] = [];
  for (let i = 1; i >= -12; i--) out.push(addMonth(activeMonth, i));
  return out;
}

export function MonthSwitcher({
  month,
  view,
  prev,
  next,
  label,
  activeMonth,
  basePath = '/transactions',
}: {
  month: string;
  view: string;
  prev: string;
  next: string;
  label: string;
  /** The current real-world active billing month — used to anchor the range
   *  shown in the dropdown so it doesn't drift if the user is browsing far
   *  in the past. */
  activeMonth: string;
  /** URL path to navigate to (default: /transactions). Pass '/' for the
   *  dashboard so the same component works on both pages. */
  basePath?: string;
}) {
  const router = useRouter();
  const buildHref = (m: string) => `${basePath}?month=${m}&view=${view}`;
  const options = buildOptions(activeMonth);

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm shadow-sm">
      {/* Previous month — quick step */}
      <a
        href={buildHref(prev)}
        onClick={() => rememberMonth(prev)}
        className="flex items-center rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title={`חודש קודם: ${formatMonthHe(prev)}`}
        aria-label={`חודש קודם: ${formatMonthHe(prev)}`}
      >
        <ChevronRight className="size-4" />
      </a>

      {/* Dropdown — jump to any month directly */}
      <div className="flex min-w-[10rem] flex-col items-center px-1">
        <span className="text-xs font-medium text-primary">{label}</span>
        <select
          value={month}
          onChange={(e) => {
            rememberMonth(e.target.value);
            router.push(buildHref(e.target.value));
          }}
          className="cursor-pointer bg-transparent text-center font-semibold focus:outline-none focus:ring-2 focus:ring-ring rounded"
          aria-label="בחר חודש"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {formatMonthHe(m)}
            </option>
          ))}
        </select>
      </div>

      {/* Next month — quick step */}
      <a
        href={buildHref(next)}
        onClick={() => rememberMonth(next)}
        className="flex items-center rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title={`חודש הבא: ${formatMonthHe(next)}`}
        aria-label={`חודש הבא: ${formatMonthHe(next)}`}
      >
        <ChevronLeft className="size-4" />
      </a>
    </div>
  );
}
