'use client';

/**
 * Toggle for showing CC settlements / cross-account transfers on /transactions.
 *
 * Default: HIDDEN. Cross-account movements (e.g. salary moving from your
 * business → personal account) shouldn't normally count as expense/income —
 * they're the same money, just shuffled. Toggle ON to surface them for audit.
 *
 * Visual: iOS/Android-style switch (see ToggleSwitch primitive). Knob on the
 * RIGHT when ON, LEFT when OFF, regardless of RTL.
 *
 * URL-driven: writes ?showTransfers=1 via router.replace; the page (Server
 * Component) re-renders with the new flag.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

interface Props {
  /** True when ?showTransfers=1 is set. */
  active: boolean;
  /** How many transfer rows are currently HIDDEN — shown as a small badge. */
  hiddenCount: number;
}

export function ShowTransfersToggle({ active, hiddenCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const params = new URLSearchParams(sp.toString());
    if (active) params.delete('showTransfers');
    else params.set('showTransfers', '1');
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  // If there are zero hidden transfers AND the toggle is off, render nothing
  // to avoid clutter — the toggle is only useful when there's something to
  // surface (or when it's currently active and the user wants to turn it off).
  if (!active && hiddenCount === 0) return null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={toggle}
      disabled={pending}
      dir="rtl"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-xs font-medium shadow-sm transition-all hover:bg-muted',
        pending && 'opacity-60',
      )}
      title="כלול חיובי כרטיסי אשראי בעו״ש (החיוב המצרפי) ושאר העברות בין חשבונות"
    >
      <span className={cn('whitespace-nowrap', active ? 'text-foreground' : 'text-muted-foreground')}>הצג העברות</span>
      <ToggleSwitch active={active} />
      {hiddenCount > 0 && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-2xs tabular-nums',
            active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {hiddenCount.toLocaleString('he-IL')}
        </span>
      )}
    </button>
  );
}
