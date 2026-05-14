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
    // Scroll into view + flash warning-tone for 3 seconds (brand book §1).
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('!bg-warning-soft', 'ring-2', 'ring-warning');
    const t = setTimeout(() => {
      el.classList.remove('!bg-warning-soft', 'ring-2', 'ring-warning');
    }, 3000);
    return () => clearTimeout(t);
  }, [searchParams]);
  return null;
}
