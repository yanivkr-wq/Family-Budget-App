import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { InfoModalButton } from './info-modal-button';

export interface TileProps {
  label: string;
  value: ReactNode;
  /** Small caption shown below the value (e.g. "מתוך 8,000 ₪") */
  caption?: ReactNode;
  /** Tone changes the value color */
  tone?: 'neutral' | 'success' | 'warning' | 'destructive' | 'accent';
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
};

export function Tile({ label, value, caption, tone = 'neutral', badge, icon, info, className }: TileProps) {
  return (
    <div className={cn('tile', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
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
