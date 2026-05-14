'use client';

/**
 * Sticky right-side navigation rail (RTL) for /insights.
 *
 * Renders one pill per section with a count badge. The pill highlights
 * automatically while the matching section is in view — uses an
 * IntersectionObserver on the `<section id="section-<id>">` elements that
 * InsightSection emits. Clicking a pill smooth-scrolls to that section.
 *
 * Visibility rules:
 *   • Shown only at lg+ (desktop) — on mobile the SectionTabs at the top
 *     of the page is the primary navigator.
 *   • Hidden when a specific section tab is active (single-section view) —
 *     a rail with one item is just noise.
 *
 * The rail does NOT decide what's rendered; it only navigates. The page is
 * the source of truth for which sections are present.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { SECTIONS, sectionAnchorId, type SectionId } from '@/app/(app)/insights/sections';

interface Props {
  /** Findings count per section. Mirrors the counts passed to SectionTabs. */
  counts: Record<SectionId, number>;
}

export function SectionRail({ counts }: Props) {
  const [active, setActive] = useState<SectionId | null>(null);

  // Watch each section's visibility. We use threshold 0 + a top margin so
  // a section becomes "active" as soon as its header crosses ~30% from the
  // top of the viewport — feels natural while scrolling.
  useEffect(() => {
    const targets = SECTIONS
      .map((s) => document.getElementById(sectionAnchorId(s.id)))
      .filter((el): el is HTMLElement => !!el);

    if (targets.length === 0) return;

    // Track the most-visible section. Map id → intersectionRatio.
    const visibility = new Map<SectionId, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^section-/, '') as SectionId;
          visibility.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // Pick the section with the highest visibility ratio.
        let bestId: SectionId | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
        }
        if (bestId) setActive(bestId);
      },
      {
        // 0 → fire whenever crossing; top margin pushes the "active line"
        // ~30% down from the top of the viewport.
        rootMargin: '-30% 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      dir="rtl"
      aria-label="ניווט מקטעים"
      className="sticky top-20 hidden h-fit w-44 shrink-0 lg:block"
    >
      <p className="mb-2 px-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        מקטעים
      </p>
      <ul className="space-y-1">
        {SECTIONS.map((s) => {
          const isActive = active === s.id;
          const count = counts[s.id] ?? 0;
          return (
            <li key={s.id}>
              <Link
                href={`#${sectionAnchorId(s.id)}`}
                scroll={true}
                className={cn(
                  'group flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'bg-primary-soft text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-current={isActive ? 'true' : undefined}
              >
                {/* Tiny tone dot — matches the section's accent bar */}
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    s.tone === 'destructive' && 'bg-destructive',
                    s.tone === 'warning' && 'bg-warning',
                    s.tone === 'success' && 'bg-success',
                    s.tone === 'accent' && 'bg-accent',
                    s.tone === 'primary' && 'bg-primary',
                  )}
                  aria-hidden
                />
                <span className="flex-1 truncate">{s.title}</span>
                <span
                  className={cn(
                    'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground/80',
                  )}
                >
                  {count.toLocaleString('he-IL')}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
