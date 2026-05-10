/**
 * Visual primitive for an iOS/Android-style on/off switch.
 *
 *   OFF: gray pill, knob on the LEFT
 *   ON:  success-green pill, knob on the RIGHT
 *
 * Convention is physical (left/right), NOT logical (start/end). RTL pages
 * still want the knob to slide LEFT→RIGHT when activating, matching the
 * universal iOS/Android pattern. Verified by checking iOS Hebrew system UI.
 *
 * This is a presentational primitive only — it does NOT wrap a button or
 * input. Compose it inside a parent <button> that handles the click + a11y.
 */

import { cn } from '@/lib/utils';

interface Props {
  active: boolean;
  /** Optional size variant. Default: 'sm' (h-4 w-7), large: 'md' (h-5 w-9). */
  size?: 'sm' | 'md';
  className?: string;
}

export function ToggleSwitch({ active, size = 'sm', className }: Props) {
  const dims =
    size === 'md'
      ? { pill: 'h-5 w-9', knob: 'size-4', offX: 'left-0.5', onX: 'left-4' }
      : { pill: 'h-4 w-7', knob: 'size-3', offX: 'left-0.5', onX: 'left-[14px]' };

  return (
    <span
      className={cn(
        'relative inline-block shrink-0 rounded-full transition-colors',
        dims.pill,
        active ? 'bg-success' : 'bg-muted-foreground/30',
        className,
      )}
      aria-hidden
    >
      <span
        className={cn(
          'absolute top-0.5 rounded-full bg-white shadow transition-all',
          dims.knob,
          active ? dims.onX : dims.offX,
        )}
      />
    </span>
  );
}
