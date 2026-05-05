'use client';

/**
 * "What insights does the dashboard watch for?" disclosure.
 *
 * Renders an Eye button in the AI Insights widget header. When clicked, opens
 * an inline panel listing all 8 configured insight types with their icon,
 * severity, title pattern, and trigger condition in Hebrew. Helps the user
 * understand what the system is monitoring even when no insights are firing.
 *
 * The catalog data is declared in this file as a static array. If you add or
 * change a real insight in computeInsights() (apps/web/src/app/(app)/page.tsx),
 * also update INSIGHT_CATALOG below so the catalog stays accurate. There's no
 * runtime check for drift — these are docs.
 */

import { useState } from 'react';
import {
  Eye,
  X,
  AlertOctagon,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  CreditCard,
  PartyPopper,
  Wallet,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Severity = 'critical' | 'warning' | 'info' | 'positive';

interface CatalogEntry {
  id: string;
  icon: LucideIcon;
  severity: Severity;
  title: string;        // Title pattern shown in the catalog
  trigger: string;      // Plain-Hebrew trigger condition
}

const INSIGHT_CATALOG: CatalogEntry[] = [
  {
    id: 'over-budget',
    icon: AlertOctagon,
    severity: 'critical',
    title: 'חרגת מהתקציב בקטגוריה',
    trigger: 'נדלק כשההוצאה החודשית בקטגוריה עברה את התקציב שהגדרת לה.',
  },
  {
    id: 'projected-negative',
    icon: TrendingDown,
    severity: 'critical',
    title: 'תחזית סוף חודש שלילית',
    trigger:
      'נדלק כשתחזית הסוף-חודש (הכנסות מינוס הוצאות עד עכשיו ועד סוף החודש לפי הקצב היומי) שלילית. דורש לפחות 5 ימי נתונים ו-3 תנועות.',
  },
  {
    id: 'near-budget',
    icon: AlertTriangle,
    severity: 'warning',
    title: 'קטגוריה מתקרבת למיצוי תקציב',
    trigger: 'נדלק כשבקטגוריה ניצלת בין 80% ל-99% מהתקציב החודשי.',
  },
  {
    id: 'mom-spike',
    icon: TrendingUp,
    severity: 'warning',
    title: 'עלייה משמעותית לעומת חודש קודם',
    trigger:
      'נדלק כשהוצאה בקטגוריה עלתה ביותר מ-40% לעומת החודש הקודם, ובחודש הקודם הייתה לפחות ₪200 (כדי לסנן רעש בקטגוריות קטנות).',
  },
  {
    id: 'installment-missing',
    icon: CreditCard,
    severity: 'warning',
    title: 'תוכנית תשלומים פעילה ללא חיוב החודש',
    trigger:
      'נדלק לאחר ה-15 בחודש כשתוכנית תשלומים פעילה לא קיבלה אף עסקה מקושרת בחודש הנוכחי — סימן שהחיוב פוספס או לא הוזן.',
  },
  {
    id: 'ending-soon',
    icon: PartyPopper,
    severity: 'info',
    title: 'תוכנית תשלומים מסתיימת',
    trigger: 'נדלק כשתוכנית תשלומים פעילה צפויה להסתיים החודש או בחודש הבא.',
  },
  {
    id: 'no-income',
    icon: Wallet,
    severity: 'warning',
    title: 'לא נרשמו הכנסות החודש',
    trigger:
      'נדלק לאחר ה-10 בחודש כשסך ההכנסות שנרשמו עדיין 0 — סימן שמשכורת או הכנסה אחרת לא הוזנה / לא יובאה.',
  },
  {
    id: 'under-budget',
    icon: Sparkles,
    severity: 'positive',
    title: 'תקציב בשליטה מצוינת',
    trigger:
      'נדלק לאחר ה-15 בחודש כששיעור השימוש הכולל בתקציב מתחת ל-60%. מציין שאתה במסלול טוב לחיסכון.',
  },
];

const SEVERITY_BADGE: Record<Severity, { className: string; label: string }> = {
  critical: { className: 'bg-destructive text-primary-foreground', label: 'קריטי' },
  warning:  { className: 'bg-warning text-primary-foreground',     label: 'שים לב' },
  info:     { className: 'bg-primary-soft text-primary',           label: 'מידע' },
  positive: { className: 'bg-success-soft text-success',           label: 'חיובי' },
};

const SEVERITY_ICON_COLOR: Record<Severity, string> = {
  critical: 'text-destructive',
  warning:  'text-warning',
  info:     'text-primary',
  positive: 'text-success',
};

export function InsightsCatalogToggle() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'סגור תצוגת תובנות אפשריות' : 'הצג את כל סוגי התובנות שהמערכת בודקת'}
        title="אילו סוגי תובנות המערכת בודקת?"
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
        )}
      >
        {open ? <X className="size-4" /> : <Eye className="size-4" />}
      </button>

      {open && (
        // Inline catalog panel inserted below the widget header. dir="rtl" so
        // Hebrew copy reads naturally; we render via a Portal-less stacking
        // approach (just normal flow) because the widget container clips
        // overflow already, and we want this to push other content down rather
        // than float over it.
        <div
          className="col-span-full mt-3 w-full overflow-hidden rounded-md border bg-background"
          dir="rtl"
        >
          <div className="border-b bg-muted/30 px-3 py-2">
            <p className="text-xs font-semibold">תובנות שהמערכת בודקת אוטומטית</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              כל אחת מהתובנות הבאות מחושבת בכל טעינה של הדשבורד. תובנה תופיע למעלה רק כאשר תנאי ההפעלה שלה מתקיים.
            </p>
          </div>
          <ul className="divide-y">
            {INSIGHT_CATALOG.map((entry) => {
              const Icon = entry.icon;
              const badge = SEVERITY_BADGE[entry.severity];
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5 text-xs">
                  <Icon className={cn('size-4 shrink-0 mt-0.5', SEVERITY_ICON_COLOR[entry.severity])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{entry.title}</span>
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-0.5 leading-relaxed text-muted-foreground">{entry.trigger}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
