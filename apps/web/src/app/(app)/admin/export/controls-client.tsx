'use client';

/**
 * Client island for the export page. Owns the date range + the per-sheet
 * download links. Each "Download" button is a plain <a download href> that
 * builds a URL like:
 *   /api/export?sheets=transactions&from=2026-01-01&to=2026-12-31
 * The browser handles the actual file save — no custom fetch logic.
 *
 * Why client-side: we need React state for the date inputs so the user can
 * type a range without a page reload, and we want to recompute the href
 * on every keystroke.
 */

import { useState, useMemo } from 'react';
import { Download, FileSpreadsheet, Calendar, CalendarDays } from 'lucide-react';
import { DownloadButton } from '@/components/ui/download-button';

interface SheetDef {
  key:    string;
  title:  string;
  desc:   string;
  /** Whether this sheet honors the date filter. */
  dated:  boolean;
}

const SHEETS: SheetDef[] = [
  {
    key:   'transactions',
    title: 'תנועות',
    desc:  'כל התנועות עם פרטים מלאים — תאריך, בית עסק, סכום, קטגוריה, חשבון, פרויקט, הערות.',
    dated: true,
  },
  {
    key:   'category-summary',
    title: 'סיכום קטגוריות לפי חודש',
    desc:  'הוצאות והכנסות לפי קטגוריה × מחזור חיוב. ללא תנועות פרויקטים, ללא העברות.',
    dated: true,
  },
  {
    key:   'recurring',
    title: 'הוצאות קבועות',
    desc:  'כל המנויים והוצאות קבועות — סכום צפוי, תדירות, תאריך סיום, סטטוס.',
    dated: false,
  },
  {
    key:   'installments',
    title: 'תוכניות תשלומים',
    desc:  'תוכניות תשלומים פעילות והיסטוריות — סכום, מספר תשלומים, חודש סיום צפוי.',
    dated: false,
  },
  {
    key:   'notifications',
    title: 'התראות',
    desc:  'משימות התראה + תזכורות + נמענים. שימושי לסקירה תקופתית.',
    dated: false,
  },
  {
    key:   'accounts',
    title: 'חשבונות',
    desc:  'רשימת חשבונות בנק וכרטיסי אשראי + סטטוס סנכרון אחרון.',
    dated: false,
  },
];

const ALL_KEYS = SHEETS.map((s) => s.key).join(',');

// Date presets — single source of truth so the buttons can both APPLY the
// range AND derive their own active state from the current dateFrom/dateTo.
type PresetKey = 'last-month' | 'last-3-months' | 'last-year' | 'all-time';

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (key === 'all-time') return { from: '', to: '' };
  const d = new Date();
  if (key === 'last-month')    d.setMonth(d.getMonth() - 1);
  if (key === 'last-3-months') d.setMonth(d.getMonth() - 3);
  if (key === 'last-year')     d.setFullYear(d.getFullYear() - 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}

export function ExportControls() {
  // Default: last 12 months for date-bound exports
  const [dateFrom, setDateFrom] = useState<string>(() => presetRange('last-year').from);
  const [dateTo, setDateTo]     = useState<string>(() => presetRange('last-year').to);

  // Determine which preset (if any) the current state matches. Used to
  // highlight the active preset button so the user knows their selection
  // stuck. Custom dates → no preset highlighted.
  function isPresetActive(key: PresetKey): boolean {
    const r = presetRange(key);
    return dateFrom === r.from && dateTo === r.to;
  }
  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setDateFrom(r.from);
    setDateTo(r.to);
  }

  // Build href for a specific sheet (or 'all')
  function buildHref(sheetKey: string | null) {
    const params = new URLSearchParams();
    if (sheetKey) params.set('sheets', sheetKey);
    // Always include the date range — the API ignores it for sheets that
    // don't honor it, so this is harmless and saves UI complexity.
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo)   params.set('to',   dateTo);
    return `/api/export?${params.toString()}`;
  }

  const allHref = useMemo(() => buildHref(ALL_KEYS), [dateFrom, dateTo]);

  return (
    <div className="space-y-5">
      {/* Date range */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Calendar className="size-4 text-muted-foreground" aria-hidden />
          טווח תאריכים <span className="text-2xs font-normal text-muted-foreground">(לתנועות וסיכומים)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">מ-</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">עד</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <div className="ms-auto flex items-center gap-1.5">
            <PresetButton onClick={() => applyPreset('last-month')}    active={isPresetActive('last-month')}    label="חודש אחרון" />
            <PresetButton onClick={() => applyPreset('last-3-months')} active={isPresetActive('last-3-months')} label="3 חודשים" />
            <PresetButton onClick={() => applyPreset('last-year')}     active={isPresetActive('last-year')}     label="שנה" />
            <PresetButton onClick={() => applyPreset('all-time')}      active={isPresetActive('all-time')}      label="הכל" />
          </div>
        </div>
      </section>

      {/* The big "all-in-one" button — the most common use case */}
      <section className="rounded-lg border-2 border-accent/40 bg-accent/5 p-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">קובץ מלא</h2>
          <p className="text-2xs text-muted-foreground mt-0.5">
            כל הגליונות במסמך אחד — תנועות, קטגוריות, קבועות, תשלומים, התראות, חשבונות.
          </p>
        </div>
        <DownloadButton
          href={allHref}
          defaultFilename="family-budget.xlsx"
          loadingSize="md"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait shrink-0"
          title="הורד קובץ Excel עם כל הגליונות"
          aria-label="הורד את כל הגליונות"
        >
          <span className="inline-flex items-center gap-1.5">
            <Download className="size-4" />
            הורד הכל
          </span>
        </DownloadButton>
      </section>

      {/* Per-sheet downloads */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">או הורד גליון בודד</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SHEETS.map((s) => (
            <li key={s.key} className="rounded-md border bg-card p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <FileSpreadsheet className="size-3.5 text-muted-foreground" />
                  {s.title}
                  {s.dated && (
                    <CalendarDays
                      className="size-3 text-accent"
                      aria-label="כובל לטווח התאריכים"
                    />
                  )}
                </p>
                <p className="text-2xs text-muted-foreground mt-1 line-clamp-3">{s.desc}</p>
              </div>
              <DownloadButton
                href={buildHref(s.key)}
                defaultFilename={`family-budget_${s.key}.xlsx`}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-wait shrink-0"
                title={`הורד גליון ${s.title}`}
                aria-label={`הורד גליון ${s.title}`}
              >
                <span className="inline-flex items-center gap-1">
                  <Download className="size-3.5" />
                  הורד
                </span>
              </DownloadButton>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PresetButton({ onClick, label, active }: { onClick: () => void; label: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          // Active: filled accent so the user can clearly see which preset
          // their current date range matches.
          ? 'rounded-full border border-accent bg-accent/15 px-2 py-0.5 text-2xs font-medium text-accent'
          : 'rounded-full border bg-card px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/40'
      }
    >
      {label}
    </button>
  );
}
