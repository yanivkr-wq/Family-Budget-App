'use client';

/**
 * Generic shell for every insight card on /insights.
 *
 * Responsibilities:
 *   • Title + sub-header (window label) + drill breadcrumb in the header.
 *   • Hosts the body content as a slot (children).
 *   • Holds drill-stack state for chart-based cards via render-prop pattern:
 *     pass `renderBody={(stack, push, pop, reset) => ...}` and the card
 *     decides what to render at each level.
 *
 * Phase A scope: in-card drill IN works (push/pop/reset). Drill OUT to
 * /transactions arrives in Phase B (will be a new prop on the leaf-level
 * chart component).
 */

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { InsightCardBreadcrumb } from './insight-card-breadcrumb';
import { InfoModalButton } from '@/components/ui/info-modal-button';
import type { DrillCrumb } from '@/app/(app)/insights/types';

export interface InsightCardProps {
  /** Stable insight ID — used by Phase F for layout / hide / publish state. */
  id: string;
  /** Hebrew title shown in the header. */
  title: string;
  /** Small sub-header — usually the active window label. */
  subtitle?: string;
  /**
   * Optional icon shown next to the title. Must be a JSX ELEMENT (e.g.
   * `<Tag className="..." />`) — NOT a component constructor — because this
   * card is a Client Component and React Server Components can't serialize
   * function references across the RSC boundary.
   */
  icon?: ReactNode;
  /** Optional tone for the icon — uses the design-token semantic colors. */
  tone?: 'neutral' | 'destructive' | 'warning' | 'success' | 'accent';
  /**
   * Multiline explanation shown when the user clicks the "i" icon next to the
   * title. Should answer: what does this card show, how is it computed, when
   * does it populate vs stay empty, what should the user do about it.
   * Required for every Phase-A card so users always have context.
   */
  info?: string;
  /** Static body — used for cards that don't drill (lists, single numbers). */
  children?: ReactNode;
  /**
   * Render-prop body — used for cards that drill. Receives the current drill
   * stack and the navigation helpers. Whenever the stack changes, the body
   * gets a new render with a `slide-fade` animation key for the transition.
   */
  renderBody?: (api: {
    stack: DrillCrumb[];
    push: (crumb: DrillCrumb) => void;
    pop: () => void;
    reset: () => void;
  }) => ReactNode;
  className?: string;
}

const TONE_CLASS = {
  neutral: 'text-muted-foreground',
  destructive: 'text-destructive',
  warning: 'text-warning',
  success: 'text-success',
  accent: 'text-accent',
} as const;

export function InsightCard({
  id,
  title,
  subtitle,
  icon,
  tone = 'neutral',
  info,
  children,
  renderBody,
  className,
}: InsightCardProps) {
  const [stack, setStack] = useState<DrillCrumb[]>([]);

  const push = (crumb: DrillCrumb) => setStack((s) => [...s, crumb]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const reset = () => setStack([]);
  const goTo = (idx: number) => setStack((s) => s.slice(0, idx));

  const drilled = stack.length > 0;

  return (
    <article
      data-insight-id={id}
      className={cn(
        // Refined card surface: subtle shadow that lifts on hover, rounded-xl
        // matching .tile, slightly stronger border than default for definition.
        // min-h ensures cards in a row align consistently.
        'group relative flex h-full min-h-[260px] flex-col gap-3 overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-border',
        className,
      )}
      dir="rtl"
    >
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-2 pb-1 border-b border-border/40">
        <div className={cn('flex items-center gap-1.5 min-w-0', TONE_CLASS[tone])}>
          {icon}
          <h3 className="text-sm font-semibold truncate text-foreground">{title}</h3>
          {info && <InfoModalButton title={title} body={info} />}
        </div>
        {subtitle && (
          <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">{subtitle}</span>
        )}
      </header>

      {/* ─── Breadcrumb + back/reset (only when drilled) ─────────────── */}
      {drilled && renderBody && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <InsightCardBreadcrumb stack={stack} onCrumbClick={goTo} />
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={pop}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="חזור רמה אחת"
            >
              <ChevronLeft className="size-3 rtl-flip" aria-hidden />
              חזור
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="אפס"
            >
              <RotateCcw className="size-3" aria-hidden />
              אפס
            </button>
          </div>
        </div>
      )}

      {/* ─── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {renderBody ? (
          // key forces remount on stack-change → triggers slide-fade animation
          <div key={stack.map((s) => s.filterValue).join('/') || 'root'} className="h-full animate-slide-fade">
            {renderBody({ stack, push, pop, reset })}
          </div>
        ) : (
          children
        )}
      </div>
    </article>
  );
}
