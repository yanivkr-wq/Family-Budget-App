import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { InfoModalButton } from './info-modal-button';

export interface TileProps {
  label: string;
  value: ReactNode;
  /** Small caption shown below the value (e.g. "מתוך 8,000 ₪") */
  caption?: ReactNode;
  /** Tone changes the value color AND the icon-badge color. */
  tone?: 'neutral' | 'success' | 'warning' | 'destructive' | 'accent' | 'primary';
  /** Optional badge/label rendered top-right (e.g. month name) */
  badge?: ReactNode;
  /** Optional left-side icon */
  icon?: ReactNode;
  /** Optional explainer text for HOW the value is computed. When set,
   *  a small "i" icon appears next to the label; click opens a modal
   *  with the full multi-line explanation (paragraphs split on blank
   *  lines, line breaks on `\n`). Use for any metric whose calculation
   *  isn't obvious. */
  info?: string;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<TileProps['tone']>, string> = {
  neutral: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  accent: 'text-accent',
  primary: 'text-primary',
};

// Phase 2 brand-book: round tonal icon-badge. The icon prop is wrapped in a
// 28px circle filled with the tone-soft color, with the icon itself inheriting
// the tone foreground via currentColor. Each tile gets a small chromatic
// anchor on its label row, replacing the bare inline icon used previously.
const TONE_BADGE_CLASS: Record<NonNullable<TileProps['tone']>, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  accent: 'bg-accent-soft text-accent',
  primary: 'bg-primary-soft text-primary',
};

export function Tile({ label, value, caption, tone = 'neutral', badge, icon, info, className }: TileProps) {
  return (
    <div className={cn('tile', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon && (
            <span
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
                TONE_BADGE_CLASS[tone],
              )}
            >
              {icon}
            </span>
          )}
          <span>{label}</span>
          {info && <InfoModalButton title={label} body={info} />}
        </div>
        {badge && <span className="pill bg-muted text-muted-foreground">{badge}</span>}
      </div>
      <div className={cn('tile-value', TONE_CLASS[tone])}>{value}</div>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
