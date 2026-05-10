'use client';

/**
 * Phase 6 toggle — show CC details vs the bank-side settlement summary.
 *
 * Two states:
 *   • OFF (default): Show settlement lines on bank accounts (e.g.
 *     "דיינרס -₪41K"), hide CC detail rows. The "source of truth" view —
 *     matches what the bank actually moved.
 *   • ON: Show CC detail rows ("מסעדה אביב ₪87"), hide bank-side
 *     settlement lines. The "where did it go?" view.
 *
 * Totals are identical in both modes (math invariant). Only the LIST changes.
 *
 * Visual: iOS/Android-style switch (see ToggleSwitch primitive).
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

interface Props {
  /** True when ?ccView=details is in the URL. */
  active: boolean;
  /** How many rows are currently HIDDEN by this toggle's current state. */
  hiddenCount: number;
}

export function CcViewToggle({ active, hiddenCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const params = new URLSearchParams(sp.toString());
    if (active) params.delete('ccView');
    else params.set('ccView', 'details');
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

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
      title={
        active
          ? 'מציג את פירוט חיובי כרטיסי האשראי. הקש להצגת חיוב מצרפי בלבד (מצב ברירת מחדל).'
          : 'מציג חיובי אשראי מצרפיים בעו״ש. הקש להצגת פירוט החיובים מהאשראי.'
      }
    >
      <span className={cn('whitespace-nowrap', active ? 'text-foreground' : 'text-muted-foreground')}>
        פירוט אשראי
      </span>
      <ToggleSwitch active={active} />
      {hiddenCount > 0 && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-2xs tabular-nums',
            active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
          )}
          title={
            active
              ? 'מספר שורות חיוב מצרפי שמסתיר כעת'
              : 'מספר שורות פירוט אשראי שמסתיר כעת'
          }
        >
          {hiddenCount.toLocaleString('he-IL')}
        </span>
      )}
    </button>
  );
}
