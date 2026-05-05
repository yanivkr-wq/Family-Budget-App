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

import { useEffect, useRef, useState } from 'react';
import {
  Info,
  X,
  AlertOctagon,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  CreditCard,
  PartyPopper,
  Wallet,
  Sparkles,
  Repeat,
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
  {
    id: 'recurring-share',
    icon: Repeat,
    severity: 'warning',
    title: 'הוצאות קבועות צורכות חלק גדול מההכנסות',
    trigger:
      'נדלק כשסך ההוצאות הקבועות החודשיות (משכנתא, ארנונה, מנויים וכד׳) עוברות 50% מההכנסות. הופך לקריטי מעל 70%.',
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
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="הצג את כל סוגי התובנות שהמערכת בודקת"
        title="אילו סוגי תובנות המערכת בודקת?"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="size-4" />
      </button>

      {open && (
        // Modal overlay — same pattern used elsewhere in the app
        // (installment-modal.tsx, savings/client.tsx, etc.).
        <div
          ref={backdropRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="insights-catalog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h2 id="insights-catalog-title" className="text-base font-semibold">
                  תובנות שהמערכת בודקת אוטומטית
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  כל אחת מהתובנות הבאות מחושבת בכל טעינה של הדשבורד. תובנה תופיע בווידג׳ט רק כאשר תנאי ההפעלה שלה מתקיים.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent/40"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Catalog list (scrollable) */}
            <ul className="flex-1 divide-y overflow-y-auto">
              {INSIGHT_CATALOG.map((entry) => {
                const Icon = entry.icon;
                const badge = SEVERITY_BADGE[entry.severity];
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-5 py-3 text-xs">
                    <Icon className={cn('size-4 shrink-0 mt-0.5', SEVERITY_ICON_COLOR[entry.severity])} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{entry.title}</span>
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.className)}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 leading-relaxed text-muted-foreground">{entry.trigger}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
