/**
 * Single source of truth for the insight sections rendered on /insights.
 *
 * Shared by:
 *   • SectionTabs    (top segmented control — filters which section is shown)
 *   • SectionRail    (sticky right-side nav rail — jump-to anchors)
 *   • page.tsx       (renders each <InsightSection> with id matching SECTION_IDS)
 *
 * Section IDs are stable strings — they appear in URLs (`?section=urgent`) and
 * as DOM anchors (`<section id="section-urgent">`), and as localStorage keys
 * for collapsed-state persistence (`insights:section:urgent:open`).
 *
 * Display order = order in this array.
 */

import { AlertTriangle, LineChart, Boxes, Briefcase, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SectionId = 'urgent' | 'trends' | 'patterns' | 'tracking' | 'integrity';

export interface SectionMeta {
  id: SectionId;
  title: string;
  caption: string;
  icon: LucideIcon;
  tone: 'destructive' | 'warning' | 'success' | 'accent' | 'primary';
  /** When ?section=all (default), do we render this section open or collapsed?
   *  Smart defaults: the two sections users read first stay open; the rest
   *  collapse to cut initial scroll. User can toggle and we persist per-id. */
  defaultOpen: boolean;
}

export const SECTIONS: SectionMeta[] = [
  { id: 'urgent',    title: 'דחוף',           caption: 'התראות שדורשות תשומת לב',         icon: AlertTriangle, tone: 'destructive', defaultOpen: true  },
  { id: 'trends',    title: 'מגמות',          caption: 'לאן הכסף נע לאורך זמן',           icon: LineChart,     tone: 'accent',      defaultOpen: true  },
  { id: 'patterns',  title: 'דפוסים',          caption: 'התנהגויות קבועות שכדאי להכיר',   icon: Boxes,         tone: 'primary',     defaultOpen: false },
  { id: 'tracking',  title: 'מעקב',           caption: 'פרויקטים ותוכניות שדורשות מעקב', icon: Briefcase,     tone: 'success',     defaultOpen: false },
  { id: 'integrity', title: 'אמינות הנתונים', caption: 'עזרה למצוא בעיות בנתונים שלך',   icon: ShieldCheck,   tone: 'warning',     defaultOpen: false },
];

/** Sentinel value for the "show everything" tab. */
export const SECTION_ALL = 'all' as const;
export type ActiveSection = SectionId | typeof SECTION_ALL;

const VALID: Set<string> = new Set([SECTION_ALL, ...SECTIONS.map((s) => s.id)]);

export function readActiveSection(value: string | undefined | null): ActiveSection {
  if (!value || !VALID.has(value)) return SECTION_ALL;
  return value as ActiveSection;
}

/** DOM id + anchor target for a section. */
export function sectionAnchorId(id: SectionId): string {
  return `section-${id}`;
}

/** localStorage key for the collapsed-state of a section. */
export function sectionOpenStorageKey(id: SectionId): string {
  return `insights:section:${id}:open`;
}
