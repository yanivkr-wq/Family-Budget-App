'use client';

/**
 * Tiny client island that reads ?highlight=<txnId> from the URL and
 * scrolls/flashes the matching row in the project's transactions table.
 *
 * Used when arriving from the global search palette — the search routes
 * project-tagged transactions to the project page, this brings the row
 * into view + adds a brief amber flash.
 *
 * Lives as a separate client component because the page itself is a
 * server component (needs auth + DB access).
 */

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export function HighlightRowFromUrl() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const hl = searchParams.get('highlight');
    if (!hl) return;
    const el = document.getElementById(`project-txn-row-${hl}`);
    if (!el) return;
    // Scroll into view + flash amber for 3 seconds.
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('!bg-amber-100', 'dark:!bg-amber-900/40', 'ring-2', 'ring-amber-400');
    const t = setTimeout(() => {
      el.classList.remove('!bg-amber-100', 'dark:!bg-amber-900/40', 'ring-2', 'ring-amber-400');
    }, 3000);
    return () => clearTimeout(t);
  }, [searchParams]);
  return null;
}
