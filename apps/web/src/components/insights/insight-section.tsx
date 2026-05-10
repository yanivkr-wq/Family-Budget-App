/**
 * Section header + responsive grid for a group of insight cards.
 *
 * Visual revamp: prominent header with a colored accent bar before the title
 * (RTL: visually on the right), tone-matched icon, and clear caption. Gives
 * the page rhythm and clear visual hierarchy — matches modern BI dashboards.
 *
 * Phase F (layout customization) will replace the grid with `react-grid-layout`.
 *
 * Server component — pure layout, no interactivity.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface Props {
  /** Hebrew section heading. */
  title: string;
  /** Optional small caption shown next to the title. */
  caption?: string;
  /** Optional icon shown to the right of the title (RTL "left" visually). */
  icon?: LucideIcon;
  /** Optional accent color for the icon. */
  iconClassName?: string;
  /**
   * Tone for the section accent bar to the right of the title (RTL).
   * Drives both the bar color and the icon background.
   */
  tone?: 'destructive' | 'warning' | 'success' | 'accent' | 'primary';
  /** The cards. */
  children: ReactNode;
  /**
   * Override the responsive grid layout.
   * Defaults to a comfortable info-dense 3-up at xl, 2-up at md, 1-up mobile.
   */
  gridClassName?: string;
}

const TONE_BAR: Record<NonNullable<Props['tone']>, string> = {
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  success: 'bg-success',
  accent: 'bg-accent',
  primary: 'bg-primary',
};

const TONE_BG: Record<NonNullable<Props['tone']>, string> = {
  destructive: 'bg-destructive-soft text-destructive',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  accent: 'bg-accent-soft text-accent',
  primary: 'bg-primary-soft text-primary',
};

export function InsightSection({
  title,
  caption,
  icon: Icon,
  iconClassName,
  tone = 'primary',
  children,
  gridClassName,
}: Props) {
  return (
    <section dir="rtl" className="space-y-4">
      <header className="flex items-center gap-3">
        {/* Vertical accent bar — gives the section a confident anchor point */}
        <span
          className={cn('h-8 w-1 shrink-0 rounded-full', TONE_BAR[tone])}
          aria-hidden
        />
        {/* Icon in a tone-matched soft background — modern BI feel */}
        {Icon && (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              TONE_BG[tone],
              iconClassName,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {caption && (
            <p className="mt-0.5 text-2xs text-muted-foreground">{caption}</p>
          )}
        </div>
      </header>
      <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3', gridClassName)}>
        {children}
      </div>
    </section>
  );
}
