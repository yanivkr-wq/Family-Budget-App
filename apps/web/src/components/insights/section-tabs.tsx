'use client';

/**
 * Top segmented control for /insights — filters which section is rendered.
 *
 *   הכל · דחוף · מגמות · דפוסים · מעקב · אמינות
 *
 * Writes `?section=X` to the URL via router.replace. The page (Server
 * Component) re-renders only the chosen section (or all of them when "הכל"
 * is active).
 *
 * Pill counts come from the page (it already has the data) and are shown
 * inline next to each label — `דחוף · 3`, `אמינות · 6` — so the user knows
 * at a glance how many findings each section holds without clicking through.
 *
 * Mirrors the styling pattern of TimeWindowSelector for visual consistency.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';
import { SECTIONS, SECTION_ALL, readActiveSection, type SectionId } from '@/app/(app)/insights/sections';

export interface SectionTabsProps {
  /** Findings count per section. Sections with 0 still render (so the user
   *  can still see "we checked and found nothing"). */
  counts: Record<SectionId, number>;
}

export function SectionTabs({ counts }: SectionTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const active = readActiveSection(sp.get('section'));
  const totalAll = SECTIONS.reduce((s, sec) => s + (counts[sec.id] ?? 0), 0);

  function setSection(next: typeof SECTION_ALL | SectionId) {
    const params = new URLSearchParams(sp.toString());
    if (next === SECTION_ALL) params.delete('section');
    else params.set('section', next);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  const TABS: Array<{ id: typeof SECTION_ALL | SectionId; title: string; count: number }> = [
    { id: SECTION_ALL, title: 'הכל', count: totalAll },
    ...SECTIONS.map((s) => ({ id: s.id, title: s.title, count: counts[s.id] ?? 0 })),
  ];

  return (
    <div
      dir="rtl"
      className="-mx-1 flex flex-nowrap items-center gap-1 overflow-x-auto rounded-full border bg-card p-1 shadow-sm sm:flex-wrap sm:overflow-visible"
      role="tablist"
      aria-label="סינון מקטעים"
    >
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setSection(t.id)}
            disabled={pending}
            className={cn(
              'group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              pending && 'opacity-60',
            )}
          >
            <span>{t.title}</span>
            <span
              className={cn(
                'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
                isActive
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground group-hover:bg-background',
              )}
            >
              {t.count.toLocaleString('he-IL')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
