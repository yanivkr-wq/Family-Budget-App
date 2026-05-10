'use client';

/**
 * Shared view-tabs component (משולב / אישי / עסקי) used by the dashboard and
 * the transactions page. Plus a tiny <ViewStripe> that renders a colored
 * bar in the active view's color — gives the user a peripheral-vision anchor
 * for "which context am I in" without introducing a heavy color theme.
 *
 * Cross-page persistence: clicking a tab writes the active view to a long-
 * lived cookie (`fba_view`). Server pages read that cookie via
 * `readActiveView()` and use it as the default when the URL doesn't carry
 * an explicit `?view=` param. So toggling to "עסקי" on the dashboard and
 * then clicking "תנועות" in the sidebar lands you on /transactions ALSO
 * filtered to business — the active view follows you across pages.
 *
 * Each page passes an hrefBuilder so the URLs can include page-specific
 * query params (e.g. month).
 */

import Link from 'next/link';
import { User as UserIcon, Briefcase, Users, Home, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const VIEW_COOKIE = 'fba_view';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year

export type View = 'personal' | 'business' | 'combined' | 'household';

interface ViewOption {
  value:    View;
  label:    string;
  icon:     LucideIcon;
  helpText: string;
  /** Tailwind classes applied when this tab is the ACTIVE one. The colors
   *  here are intentionally subtle — they're a context anchor, not a theme. */
  activeClass: string;
  /** A 2px colored bar shown under the page header for the active view.
   *  Same color family as the active tab so the two cues reinforce each
   *  other. Tailwind bg- only. */
  stripeClass: string;
}

// Order: combined first (the default "everything together" view), then
// personal, then business, then household at the end as the broadest
// "everything-including-projects" lens. The first three are the everyday
// spending views; household is the auditing / cash-flow validation view.
export const VIEW_OPTIONS: ViewOption[] = [
  {
    value:    'combined',
    label:    'משולב',
    icon:     Users,
    helpText: 'הכל ביחד, ללא ספירה כפולה של העברות',
    // Calm violet — distinct from blue (personal) and slate (business),
    // doesn't compete with the app's semantic colors. Cooler / quieter
    // than the previous rose; reads as a neutral "everything together".
    activeClass: 'bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
    stripeClass: 'bg-violet-400 dark:bg-violet-500',
  },
  {
    value:    'personal',
    label:    'אישי',
    icon:     UserIcon,
    helpText: 'חשבונות פרטיים בלבד',
    activeClass: 'bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100',
    stripeClass: 'bg-blue-400 dark:bg-blue-600',
  },
  {
    value:    'business',
    label:    'עסקי',
    icon:     Briefcase,
    helpText: 'חשבונות עסקיים בלבד',
    activeClass: 'bg-slate-300 text-slate-900 dark:bg-slate-600 dark:text-slate-100',
    stripeClass: 'bg-slate-500 dark:bg-slate-400',
  },
  {
    // Household view = comprehensive validation lens. UNLIKE combined, it
    // INCLUDES project transactions (construction, big remodels, etc.) so
    // the user can see the true total cash flow of the household — every
    // shekel in, every shekel out. Use case: "did we cover all our
    // expenses this month including the project draws?"
    value:    'household',
    label:    'משק בית',
    icon:     Home,
    helpText: 'תזרים מלא של משק הבית כולל פרויקטים — לאימות תקציב כולל',
    // Emerald — communicates "comprehensive / healthy overview", distinct
    // from the other three colors.
    activeClass: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
    stripeClass: 'bg-emerald-500 dark:bg-emerald-600',
  },
];

/** Lookup helper, used by ViewStripe and any page that needs the metadata. */
export function getViewOption(view: View): ViewOption {
  return VIEW_OPTIONS.find((o) => o.value === view) ?? VIEW_OPTIONS[0]!;
}

export function ViewTabs({
  current,
  hrefs,
}: {
  current: View;
  /** Pre-computed URL for each tab — passed as plain data (not a builder
   *  function) because functions can't cross the Server → Client boundary.
   *  The hosting page knows its own URL pattern; it builds all three hrefs
   *  upfront and we just look them up here. */
  hrefs: Record<View, string>;
}) {
  // On click, write the chosen view to a cookie so subsequent server-rendered
  // pages can read it as the default. We do this BEFORE the navigation so the
  // next page's RSC has the cookie already present.
  function rememberView(v: View) {
    if (typeof document === 'undefined') return;
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=${COOKIE_MAX_AGE_S}; SameSite=Lax`;
  }

  return (
    <div
      role="tablist"
      aria-label="תצוגת חשבונות"
      className="inline-flex items-center rounded-md border bg-card p-0.5 shadow-sm"
    >
      {VIEW_OPTIONS.map((opt) => {
        const isActive = current === opt.value;
        const Icon = opt.icon;
        return (
          <Link
            key={opt.value}
            href={hrefs[opt.value]}
            onClick={() => rememberView(opt.value)}
            role="tab"
            aria-selected={isActive}
            title={opt.helpText}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              isActive ? opt.activeClass : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Colored strip rendered at the top of a page's content area to reinforce
 *  which view is active. Color matches the active tab. Uses negative margins
 *  to extend to the edges of the content area (full-bleed) and pull up
 *  flush with the global header — otherwise it's buried under the page's
 *  vertical padding and easy to miss. */
export function ViewStripe({ view }: { view: View }) {
  const opt = getViewOption(view);
  return (
    <div
      aria-hidden="true"
      className={cn(
        // Full-bleed: cancel the layout's px-4 / md:px-6 / lg:px-8.
        '-mx-4 md:-mx-6 lg:-mx-8',
        // Pull flush with the global header by cancelling the layout's top
        // padding. Parent's space-y-6 will handle the gap to the next sibling.
        '-mt-5 md:-mt-8',
        // Visible: 4px tall.
        'h-1 w-full',
        opt.stripeClass,
      )}
    />
  );
}
