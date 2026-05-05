/**
 * Shared view-tabs component (אישי / עסקי / משולב) used by the dashboard and
 * the transactions page. Plus a tiny <ViewStripe> that renders a 2px colored
 * bar in the active view's color — gives the user a peripheral-vision anchor
 * for "which context am I in" without introducing a heavy color theme.
 *
 * Color choices:
 *   • אישי   → soft blue   (calm / private)
 *   • עסקי   → soft slate  (neutral / serious)
 *   • משולב  → existing teal-primary (no specific identity, "the union")
 *
 * Each page passes an hrefBuilder so the URLs can include page-specific
 * query params (e.g. month).
 */

import Link from 'next/link';
import { User as UserIcon, Briefcase, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type View = 'personal' | 'business' | 'combined';

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

export const VIEW_OPTIONS: ViewOption[] = [
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
    value:    'combined',
    label:    'משולב',
    icon:     Users,
    helpText: 'הכל ביחד, ללא ספירה כפולה של העברות',
    // Rose — warm enough to clearly differ from blue/slate, but more refined
    // than the previous orange. Doesn't conflict with the app's semantic
    // colors (success green / warning amber / destructive red).
    activeClass: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
    stripeClass: 'bg-rose-500 dark:bg-rose-500',
  },
];

/** Lookup helper, used by ViewStripe and any page that needs the metadata. */
export function getViewOption(view: View): ViewOption {
  return VIEW_OPTIONS.find((o) => o.value === view) ?? VIEW_OPTIONS[0]!;
}

export function ViewTabs({
  current,
  hrefBuilder,
}: {
  current: View;
  hrefBuilder: (v: View) => string;
}) {
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
            href={hrefBuilder(opt.value)}
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
