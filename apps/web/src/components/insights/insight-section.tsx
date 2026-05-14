'use client';

/**
 * Section header + responsive grid for a group of insight cards.
 *
 * Visual revamp: prominent header with a colored accent bar before the title
 * (RTL: visually on the right), tone-matched icon, and clear caption. Gives
 * the page rhythm and clear visual hierarchy — matches modern BI dashboards.
 *
 * Phase B (collapse): each section is collapsible. State persists per-id in
 * localStorage under `insights:section:<id>:open`. The page passes smart
 * defaults via `defaultOpen` — busy sections start collapsed so the initial
 * scroll is short, but the choice is sticky once the user toggles.
 *
 * Server-rendered shell: the layout itself is a Client Component (useState
 * needed for collapse), but the *cards* inside are still Server Components
 * passed via `children`. Next.js streams the SC tree into the CC just fine.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTIONS, sectionOpenStorageKey, type SectionId } from '@/app/(app)/insights/sections';

interface Props {
  /** Stable section id — matches SectionId in sections.ts. Used for the
   *  anchor target (`id="section-<id>"`), the localStorage key, AND to look
   *  up the icon component (icons can't cross the RSC boundary as props —
   *  they're forwardRef functions, not plain values — so we look them up
   *  inside this Client Component instead). */
  id: SectionId;
  /** Hebrew section heading. */
  title: string;
  /** Optional small caption shown next to the title. */
  caption?: string;
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
  /** Initial open/closed state (used until the user toggles or localStorage
   *  rehydrates). Pass `false` for default-collapsed sections. */
  defaultOpen?: boolean;
  /** Count badge shown in the header (small pill next to title). */
  count?: number;
  /** When true (single-section view), the section never collapses — there's
   *  no point in hiding the only thing on screen. */
  forceOpen?: boolean;
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
  id,
  title,
  caption,
  iconClassName,
  tone = 'primary',
  children,
  gridClassName,
  defaultOpen = true,
  count,
  forceOpen = false,
}: Props) {
  // Look up the icon by id from the central registry. Avoids the RSC issue
  // where forwardRef functions (Lucide icons) can't be passed as props from
  // a Server Component to a Client Component.
  const SectionIcon = SECTIONS.find((s) => s.id === id)?.icon;
  const [open, setOpen] = useState(defaultOpen);

  // Rehydrate from localStorage on mount. We deliberately avoid reading on
  // the SSR pass so initial paint matches the server-rendered defaultOpen —
  // any flicker happens only on the first toggle after hydration.
  useEffect(() => {
    if (forceOpen) return;
    try {
      const stored = window.localStorage.getItem(sectionOpenStorageKey(id));
      if (stored === 'true' || stored === 'false') setOpen(stored === 'true');
    } catch {
      // ignore (private mode / disabled storage)
    }
  }, [id, forceOpen]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(sectionOpenStorageKey(id), String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const isOpen = forceOpen || open;

  return (
    <section dir="rtl" id={`section-${id}`} className="scroll-mt-24 space-y-4">
      <header className="flex items-center gap-3">
        {/* Vertical accent bar — gives the section a confident anchor point */}
        <span
          className={cn('h-8 w-1 shrink-0 rounded-full', TONE_BAR[tone])}
          aria-hidden
        />
        {/* Icon in a tone-matched soft background — modern BI feel. Looked
            up by id from SECTIONS (sections.ts) inside this Client Component
            to avoid the SC→CC serialization issue. */}
        {SectionIcon && (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              TONE_BG[tone],
              iconClassName,
            )}
          >
            <SectionIcon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {typeof count === 'number' && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                {count.toLocaleString('he-IL')}
              </span>
            )}
          </div>
          {caption && (
            <p className="mt-0.5 text-2xs text-muted-foreground">{caption}</p>
          )}
        </div>
        {/* Collapse toggle — hidden when forceOpen (single-section view). */}
        {!forceOpen && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-controls={`section-body-${id}`}
            className="group inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isOpen ? 'מזער' : 'הרחב'}
          >
            <ChevronDown
              className={cn(
                'size-4 transition-transform',
                isOpen ? 'rotate-0' : '-rotate-90',
              )}
              aria-hidden
            />
          </button>
        )}
      </header>
      {/* Body — mounted only when open. We use hidden+aria rather than
          conditional render so the children (server components) don't have
          to refetch when the user toggles. */}
      <div
        id={`section-body-${id}`}
        hidden={!isOpen}
        className={cn('grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3', gridClassName)}
      >
        {children}
      </div>
    </section>
  );
}
