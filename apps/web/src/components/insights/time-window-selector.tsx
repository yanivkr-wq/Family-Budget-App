'use client';

/**
 * URL-driven time-window selector for /insights.
 *
 *   MTD · 30D · 90D · טווח מותאם...
 *
 * Writes to ?window=, ?from=, ?to= search params via router.replace; the page
 * (Server Component) re-renders on the new URL with the new aggregations.
 *
 * Custom range opens a tiny inline date-input row. We intentionally use native
 * <input type="date"> to stay zero-dependency — it works, it's accessible,
 * and Heebo/RTL handle it cleanly.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import type { InsightWindowKind } from '@/app/(app)/insights/types';

const OPTIONS: Array<{ kind: InsightWindowKind; label: string }> = [
  { kind: 'mtd', label: 'מתחילת החודש' },
  { kind: '30d', label: '30 ימים' },
  { kind: '90d', label: '90 ימים' },
  { kind: 'custom', label: 'טווח מותאם' },
];

export function TimeWindowSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = (sp.get('window') ?? 'mtd') as InsightWindowKind;
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');

  function setWindow(kind: InsightWindowKind) {
    const params = new URLSearchParams(sp.toString());
    params.set('window', kind);
    if (kind !== 'custom') {
      params.delete('from');
      params.delete('to');
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  function applyCustom() {
    if (!from || !to) return;
    const params = new URLSearchParams(sp.toString());
    params.set('window', 'custom');
    params.set('from', from);
    params.set('to', to);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="space-y-2" dir="rtl">
      <div className="inline-flex rounded-md border bg-card p-0.5 shadow-sm">
        {OPTIONS.map((opt) => {
          const isActive = current === opt.kind;
          return (
            <button
              key={opt.kind}
              type="button"
              onClick={() => setWindow(opt.kind)}
              disabled={pending}
              className={cn(
                'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                pending && 'opacity-60',
              )}
              aria-pressed={isActive}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {current === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">מ:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="form-input py-1"
              dir="ltr"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">עד:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="form-input py-1"
              dir="ltr"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to || pending}
            className="btn-secondary py-1 text-xs"
          >
            החל
          </button>
        </div>
      )}
    </div>
  );
}
