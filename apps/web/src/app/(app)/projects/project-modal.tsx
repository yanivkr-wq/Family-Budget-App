'use client';

/**
 * Add / edit modal for a project. Same overlay style as the rest of the
 * app (recurring-modal, installment-modal).
 *
 * Color palette: pre-selected swatches make it easy for the user to pick
 * a project color without picking a hex code by hand. The chosen color
 * is used for the dot in the projects table + the chart accents on the
 * per-project dashboard.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { createProject, updateProject, type ProjectRow } from './actions';

const STATUS_OPTIONS: Array<{ value: ProjectRow['status']; label: string }> = [
  { value: 'active',    label: 'פעיל' },
  { value: 'paused',    label: 'מושהה' },
  { value: 'completed', label: 'הושלם' },
  { value: 'cancelled', label: 'בוטל' },
];

const COLOR_SWATCHES = [
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#84cc16', // lime
  '#f97316', // orange
];

export function ProjectModal({
  project,
  onClose,
}: {
  project: ProjectRow | null; // null = create mode
  onClose: () => void;
}) {
  const isEdit = !!project;

  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? COLOR_SWATCHES[0]!);
  const [totalBudgetIls, setTotalBudgetIls] = useState(
    project?.totalBudgetIls ? String(Number(project.totalBudgetIls)) : '',
  );
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [endDate, setEndDate] = useState(project?.endDate ?? '');
  const [status, setStatus] = useState<ProjectRow['status']>(project?.status ?? 'active');
  const [excludeFromMonthlyTotals, setExcludeFromMonthlyTotals] = useState(
    project?.excludeFromMonthlyTotals ?? true,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const backdropRef = useRef<HTMLDivElement>(null);

  // ESC closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    if (isEdit) fd.set('id', project!.id);
    fd.set('name',                     name);
    fd.set('description',              description);
    fd.set('color',                    color);
    fd.set('totalBudgetIls',           totalBudgetIls);
    fd.set('startDate',                startDate);
    fd.set('endDate',                  endDate);
    fd.set('status',                   status);
    fd.set('excludeFromMonthlyTotals', excludeFromMonthlyTotals ? 'true' : 'false');

    startTransition(async () => {
      const res = isEdit ? await updateProject(fd) : await createProject(fd);
      if (!res.ok) { setError(res.error ?? 'שגיאה'); return; }
      onClose();
    });
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            {isEdit ? 'עריכת פרויקט' : 'הוספת פרויקט'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              שם הפרויקט <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל: בניית בית, חתונה, חופשה גדולה"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              תיאור
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="פירוט קצר על הפרויקט"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Color swatches */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">צבע מזהה</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-7 rounded-full transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`צבע ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              תקציב כולל (₪)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={totalBudgetIls}
              onChange={(e) => setTotalBudgetIls(e.target.value)}
              placeholder="ריק = ללא תקציב מוגדר"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">
              לא חובה — אם תוגדר תקציב, יוצג סרגל התקדמות והתראה כאשר תתקרב לחריגה.
            </p>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">תאריך התחלה</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">תאריך סיום צפוי</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectRow['status'])}
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Exclude-from-monthly toggle */}
          <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={excludeFromMonthlyTotals}
              onChange={(e) => setExcludeFromMonthlyTotals(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="font-medium text-foreground">הסתר מהתצוגות החודשיות</p>
              <p className="mt-0.5 text-muted-foreground">
                כאשר מסומן (ברירת המחדל), תנועות שמתויגות לפרויקט הזה לא יופיעו בלוח המחוונים
                ובדף התנועות (אישי / עסקי / משולב), וניתן לראות אותן רק בדף הפרויקט.
                שימושי לפרויקטים גדולים שלא רוצים שיציפו את המבט החודשי.
              </p>
            </div>
          </label>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/40"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? 'שומר…' : isEdit ? 'עדכן' : 'הוסף'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
