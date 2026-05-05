'use client';

/**
 * Add / edit modal for a recurring expense pattern. Shared overlay style
 * with the rest of the app's modals (installment-modal, savings/client,
 * transactions/edit-modal, etc.).
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { createRecurringPattern, updateRecurringPattern } from './actions';

interface Cat { id: string; nameHe: string }
export interface RecurringPatternRow {
  id:                 string;
  merchantNormalized: string;
  description:        string | null;
  categoryId:         string | null;
  expectedAmountIls:  string | number;
  frequency:          'monthly' | 'bimonthly' | 'quarterly' | 'yearly' | string;
  status:             'active' | 'paused' | 'ended' | string;
  notes:              string | null;
}

const FREQ_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'monthly',   label: 'חודשי' },
  { value: 'bimonthly', label: 'דו-חודשי' },
  { value: 'quarterly', label: 'רבעוני' },
  { value: 'yearly',    label: 'שנתי' },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'פעיל' },
  { value: 'paused', label: 'מושהה' },
  { value: 'ended',  label: 'הסתיים' },
];

export function RecurringModal({
  pattern,
  categories,
  onClose,
}: {
  pattern: RecurringPatternRow | null; // null = create mode
  categories: Cat[];
  onClose: () => void;
}) {
  const isEdit = !!pattern;
  const initialAmount = pattern ? Math.abs(Number(pattern.expectedAmountIls)) : 0;
  const initialSign: 'expense' | 'income' = pattern && Number(pattern.expectedAmountIls) > 0 ? 'income' : 'expense';

  const [merchant, setMerchant] = useState(pattern?.merchantNormalized ?? '');
  const [description, setDescription] = useState(pattern?.description ?? '');
  const [categoryId, setCategoryId] = useState(pattern?.categoryId ?? '');
  const [amountStr, setAmountStr] = useState(initialAmount > 0 ? String(initialAmount) : '');
  const [sign, setSign] = useState<'expense' | 'income'>(initialSign);
  const [frequency, setFrequency] = useState(pattern?.frequency ?? 'monthly');
  const [status, setStatus] = useState(pattern?.status ?? 'active');
  const [notes, setNotes] = useState(pattern?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const backdropRef = useRef<HTMLDivElement>(null);

  // ESC closes; lock body scroll
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
    if (isEdit) fd.set('id', pattern!.id);
    fd.set('merchant',    merchant);
    fd.set('description', description);
    fd.set('categoryId',  categoryId);
    fd.set('amount',      amountStr);
    fd.set('sign',        sign);
    fd.set('frequency',   frequency);
    fd.set('status',      status);
    fd.set('notes',       notes);

    startTransition(async () => {
      const res = isEdit ? await updateRecurringPattern(fd) : await createRecurringPattern(fd);
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
            {isEdit ? 'עריכת הוצאה קבועה' : 'הוספת הוצאה קבועה'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Merchant + description side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                שם בית עסק <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="למשל: פלאפון, פייבוקס, הראל"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                המזהה לעדכון אוטומטי של תג &quot;קבוע&quot; בייבואים עתידיים.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                תיאור / שם התשלום
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="למשל: השכרת דירה, מנוי משפחה"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground">
                מה נרכש בפועל — מוצג ליד שם בית העסק לזיהוי מהיר.
              </p>
            </div>
          </div>

          {/* Sign + amount */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">סוג</label>
              <select
                value={sign}
                onChange={(e) => setSign(e.target.value as 'expense' | 'income')}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                <option value="expense">הוצאה</option>
                <option value="income">הכנסה</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                סכום צפוי <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="1500"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
          </div>

          {/* Category + frequency */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">קטגוריה</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                <option value="">— ללא קטגוריה —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.nameHe}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">תדירות</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">הערות</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

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
