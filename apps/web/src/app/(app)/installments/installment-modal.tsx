'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { X, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { createInstallmentPlan, updateInstallmentPlan } from './actions';

// ─────────────────────────────────────────────────────────────────────────────

export interface InstallmentPlanRow {
  id: string;
  merchantNormalized: string;
  description: string | null;
  paymentAmountIls: string | number;
  totalPayments: number | null;
  currentPaymentNo: number;
  startMonth: string;
  projectedEndMonth: string | null;
  actualEndMonth: string | null;
  accountId: string | null;
  status: 'active' | 'complete' | 'cancelled';
  notes: string | null;
}

interface Account { id: string; name: string }

interface Props {
  plan?: InstallmentPlanRow | null;   // null → create mode
  accounts: Account[];
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed preview: projected end month from start + total
// ─────────────────────────────────────────────────────────────────────────────
function computeProjectedEnd(startMonth: string, total: number): string {
  if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth) || total < 1) return '—';
  const [y, m] = startMonth.split('-').map(Number);
  const totalMonths = (y! - 1) * 12 + m! - 1 + (total - 1);
  const ny = Math.floor(totalMonths / 12) + 1;
  const nm = (totalMonths % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function formatMonthHe(ym: string) {
  if (!ym || ym === '—') return ym;
  const [y, m] = ym.split('-').map(Number);
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${months[(m ?? 1) - 1]} ${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

export function InstallmentModal({ plan, accounts, onClose }: Props) {
  const isEdit = !!plan;
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Controlled fields ─────────────────────────────────────────────────────
  // merchant = the bank-extracted name (the join key for transactions);
  // description = a friendly label the user types (e.g., "iPhone 15 Pro").
  // Description is OPTIONAL — when blank we display merchant in the table.
  const nowMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [merchant,    setMerchant]    = useState(plan?.merchantNormalized ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [amount,      setAmount]      = useState(plan ? String(Math.abs(Number(plan.paymentAmountIls))) : '');
  const [total,       setTotal]       = useState(plan?.totalPayments ? String(plan.totalPayments) : '');
  const [currentNo,   setCurrentNo]   = useState(plan ? String(plan.currentPaymentNo) : '1');
  const [startMonth,  setStartMonth]  = useState(plan?.startMonth ?? nowMonth);
  const [accountId,   setAccountId]   = useState(plan?.accountId ?? '');
  const [status,      setStatus]      = useState<'active'|'complete'|'cancelled'>(plan?.status ?? 'active');
  const [notes,       setNotes]       = useState(plan?.notes ?? '');

  // Live preview
  const totalNum = parseInt(total) || 0;
  const projected = totalNum > 0 ? computeProjectedEnd(startMonth, totalNum) : null;

  // Remaining
  const currentNum = parseInt(currentNo) || 1;
  const remaining  = totalNum > 0 ? Math.max(0, totalNum - currentNum + 1) : null;
  const totalLeft  = remaining !== null && amount ? remaining * parseFloat(amount) : null;

  // Close on Escape
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set('merchantNormalized', merchant);
    // Description is optional — empty string lets the list fall back to
    // the merchant name automatically (it does `description ?? merchant`).
    fd.set('description',        description);

    startTransition(async () => {
      const result = isEdit
        ? await updateInstallmentPlan(fd)
        : await createInstallmentPlan(fd);
      if (!result.ok) { setError(result.error ?? 'שגיאה'); return; }
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
            {isEdit ? 'עריכת תוכנית תשלומים' : 'הוספת תוכנית תשלומים'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {isEdit && <input type="hidden" name="id" value={plan!.id} />}
          <input type="hidden" name="merchantNormalized" value={merchant} />
          <input type="hidden" name="description"        value={description} />

          {/* Merchant + description side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                שם בית עסק <span className="text-destructive">*</span>
              </label>
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                required
                maxLength={200}
                placeholder='לדוגמה: KSP ראשל"צ'
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-[10px] text-muted-foreground">המזהה לקישור עתידי של תנועות.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                תיאור / שם התשלום
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                placeholder="לדוגמה: iPhone 15 Pro"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-[10px] text-muted-foreground">מה נרכש בפועל — מוצג בטבלה.</p>
            </div>
          </div>

          {/* Amount + Total payments (side by side) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                סכום תשלום חודשי (₪) <span className="text-destructive">*</span>
              </label>
              <input
                name="paymentAmountIls"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                placeholder="200.00"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                סה&quot;כ תשלומים <span className="text-xs font-normal text-muted-foreground/60">(אופציונלי)</span>
              </label>
              <input
                name="totalPayments"
                type="number"
                min="1"
                max="999"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="12"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Current payment # + Start month */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                תשלום נוכחי מספר <span className="text-destructive">*</span>
              </label>
              <input
                name="currentPaymentNo"
                type="number"
                min="1"
                max={total || undefined}
                value={currentNo}
                onChange={(e) => setCurrentNo(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                חודש התחלה <span className="text-destructive">*</span>
              </label>
              <input
                name="startMonth"
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Live preview pill */}
          {(projected || totalLeft !== null) && (
            <div className="flex flex-wrap gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              {projected && (
                <span>
                  📅 צפי סיום: <strong>{formatMonthHe(projected)}</strong>
                </span>
              )}
              {totalLeft !== null && (
                <span>
                  💰 נותר לתשלום: <strong>{new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(totalLeft)}</strong>
                  {remaining !== null && <span className="text-muted-foreground"> ({remaining} תשלומים)</span>}
                </span>
              )}
            </div>
          )}

          {/* Account + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">חשבון / כרטיס</label>
              <div className="relative">
                <select
                  name="accountId"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">— לא מוגדר —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">סטטוס</label>
              <div className="relative">
                <select
                  name="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="active">פעיל</option>
                  <option value="complete">הושלם</option>
                  <option value="cancelled">בוטל</option>
                </select>
                <ChevronDown className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">הערות</label>
            <input
              name="notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="הערה חופשית..."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent/40">
              ביטול
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              {isEdit ? 'שמור שינויים' : 'הוסף תוכנית'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
