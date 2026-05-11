'use client';

import { useMemo, useState, useTransition } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { updateTransaction } from './actions';
import { autoComputeChargeDate } from '@/lib/charge-date';

interface Cat {
  id: string;
  nameHe: string;
  color?: string | null;
}
interface SubCat extends Cat {
  parentId: string;
}
interface Account {
  id: string;
  name: string;
}
interface Transaction {
  id: string;
  date: string;
  chargeDate?: string | null;
  amount: number;
  merchant: string;
  categoryId: string | null;
  subCategoryId: string | null;
  accountId: string;
  notes: string | null;
  /** Cross-account transfer flag. When true, the row is excluded from
   *  combined-view income/expense totals (no double counting). */
  isTransfer?: boolean;
  /** Per-row override that brings a project-tagged row back into the
   *  monthly cash flow (capex/opex split). Only meaningful when
   *  projectId is set. */
  includeInMonthlyOverride?: boolean;
  /** Project this row belongs to (passed in just so the modal can decide
   *  whether to surface the override checkbox). null = no project. */
  projectId?: string | null;
  /** "Accounting noise" — show the row but never count it in any sum. */
  excludedFromTotals?: boolean;
}

export function EditTransactionModal(props: {
  transaction: Transaction;
  categories: Cat[];
  subCategories: SubCat[];
  accounts: Account[];
  onClose: () => void;
}) {
  const t = props.transaction;

  // Derive the sign + absolute amount for the form
  const initialIsIncome = t.amount >= 0;
  const [date, setDate] = useState(t.date.slice(0, 10));
  // If existing transaction has a chargeDate use it; otherwise auto-compute from date.
  const [chargeDate, setChargeDate] = useState(
    t.chargeDate?.slice(0, 10) ?? autoComputeChargeDate(t.date.slice(0, 10)) ?? '',
  );
  const [merchant, setMerchant] = useState(t.merchant);
  const [absAmount, setAbsAmount] = useState(String(Math.abs(t.amount)));
  const [sign, setSign] = useState<'expense' | 'income'>(initialIsIncome ? 'income' : 'expense');
  const [accountId, setAccountId] = useState(t.accountId);
  const [categoryId, setCategoryId] = useState<string | ''>(t.categoryId ?? '');
  const [subCategoryId, setSubCategoryId] = useState<string | ''>(t.subCategoryId ?? '');
  const [notes, setNotes] = useState(t.notes ?? '');
  const [isTransfer, setIsTransfer] = useState(!!t.isTransfer);
  const [includeInMonthlyOverride, setIncludeInMonthlyOverride] = useState(!!t.includeInMonthlyOverride);
  const [excludedFromTotals, setExcludedFromTotals] = useState(!!t.excludedFromTotals);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const subForCategory = useMemo(
    () => props.subCategories.filter((s) => s.parentId === categoryId),
    [props.subCategories, categoryId],
  );

  function handleSave() {
    setError(null);
    const num = Number(absAmount);
    if (!Number.isFinite(num) || num === 0) {
      setError('סכום לא תקין');
      return;
    }
    const signed = sign === 'income' ? Math.abs(num) : -Math.abs(num);

    startTransition(async () => {
      const result = await updateTransaction({
        id: t.id,
        transactionDate: date,
        chargeDate: /^\d{4}-\d{2}-\d{2}$/.test(chargeDate) ? chargeDate : null,
        merchantRaw: merchant,
        amountIls: signed,
        accountId,
        categoryId: categoryId || null,
        subCategoryId: subCategoryId || null,
        notes: notes.trim() || null,
        isTransfer,
        includeInMonthlyOverride,
        excludedFromTotals,
      });
      if (!result.ok) {
        setError(result.error ?? 'שגיאה לא ידועה');
        return;
      }
      props.onClose();
    });
  }

  return (
    <div
      // Backdrop: center vertically on tall viewports, top-align on short ones
      // (so the header is always visible). Full-height-friendly with safe-area
      // padding so footer doesn't sit under iPhone home-bar.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={props.onClose}
    >
      <div
        // Card: full viewport width up to max-w-lg; max-height keeps it on
        // screen with internal scroll. flex-col so header/footer can stay
        // pinned and the body scrolls.
        className="my-4 flex w-full max-w-lg flex-col rounded-lg border bg-card shadow-xl sm:my-0 sm:max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">עריכת תנועה</h2>
          <button
            onClick={props.onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent/50"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Scrollable body — only this part scrolls on overflow */}
        <div className="flex-1 overflow-y-auto px-4 py-3">

        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Single column on phones, two columns on sm+ — keeps date pickers
            and selects from being squished under ~360px */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="תאריך עסקה" required>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                const newDate = e.target.value;
                setDate(newDate);
                // Keep chargeDate in sync unless user already customised it to
                // something other than the auto-computed value for the old date.
                setChargeDate(autoComputeChargeDate(newDate) ?? '');
              }}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="תאריך חיוב">
            <input
              type="date"
              value={chargeDate}
              onChange={(e) => setChargeDate(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              title="מחושב אוטומטית (כלל העשירי). ניתן לשנות ידנית."
            />
          </Field>
          <Field label="סוג">
            <select
              value={sign}
              onChange={(e) => setSign(e.target.value as 'expense' | 'income')}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="expense">הוצאה</option>
              <option value="income">הכנסה</option>
            </select>
          </Field>

          <Field label="בית עסק" required className="col-span-1 sm:col-span-2">
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={200}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="סכום (₪)" required>
            <input
              type="number"
              value={absAmount}
              onChange={(e) => setAbsAmount(e.target.value)}
              step="0.01"
              min="0"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </Field>
          <Field label="חשבון" required>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {props.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="קטגוריה">
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setSubCategoryId('');
              }}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— ללא —</option>
              {props.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameHe}
                </option>
              ))}
            </select>
          </Field>
          <Field label="תת-קטגוריה">
            <select
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
              disabled={!categoryId || subForCategory.length === 0}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">— ללא —</option>
              {subForCategory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameHe}
                </option>
              ))}
            </select>
          </Field>

          <Field label="הערות" className="col-span-1 sm:col-span-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>

          {/* Transfer toggle — full width below the standard fields. When
              checked, the row is excluded from combined-view income/expense
              totals so cross-account moves between the user's own accounts
              don't get double-counted (e.g. salary deposit from business
              → personal would otherwise show as income in BOTH sides). */}
          <label className="col-span-1 sm:col-span-2 flex items-start gap-2 rounded-md border bg-muted/20 p-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isTransfer}
              onChange={(e) => setIsTransfer(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="font-medium text-foreground">זוהי העברה בין חשבונות</p>
              <p className="mt-0.5 text-muted-foreground">
                סמן כשהתנועה מייצגת תזוזת כסף בין שני חשבונות שלך (למשל הפקדה
                מבנק עסקי לבנק פרטי, משיכה מחיסכון). תנועות מסומנות יוסטרו
                מסכומי הכנסה/הוצאה בתצוגת &ldquo;משולב&rdquo; כדי למנוע ספירה כפולה.
              </p>
            </div>
          </label>

          {/* Per-row "include in monthly" override — only shown when the
              row is tagged to a project. Lets the user split capex (full
              project transfers; stay hidden from monthly) from opex (small
              project-related purchases that should also affect this
              month's discretionary budget). */}
          {t.projectId && (
            <label className="col-span-1 sm:col-span-2 flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50/40 p-2.5 text-xs cursor-pointer dark:border-amber-700/40 dark:bg-amber-900/10">
              <input
                type="checkbox"
                checked={includeInMonthlyOverride}
                onChange={(e) => setIncludeInMonthlyOverride(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  📦 כלול גם בסיכומים החודשיים
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  התנועה מתויגת לפרויקט שמוסתר מהתצוגות החודשיות. סמן כדי
                  שהתנועה <strong>תופיע גם בלוח המחוונים, בדף התנועות ובסיכומים החודשיים</strong> —
                  בנוסף לדף הפרויקט. שימושי לרכישות שהן גם חלק מהפרויקט וגם
                  הוצאה שוטפת רגילה (לדוגמה — מנורה לבית בבנייה: ₪400 שצריך
                  לראות גם בתקציב החודשי, להבדיל מהעברה של ₪200,000 לקבלן
                  שזה רק capex של הפרויקט).
                </p>
              </div>
            </label>
          )}

          {/* "Accounting noise" toggle — show but never count.
              Used for: loan refinancing where one loan was opened just to
              be closed by another (real bookkeeping line, zero cash impact);
              CC settlement lines (auto-set during import); internal
              corrections / reversals.
              When checked, the row is excluded from EVERY sum:
                • monthly dashboard/transactions totals
                • project total expenses + income + net out-of-pocket
                • insights spending math
                • category summaries / charts
              The row is still visible in lists for audit purposes. */}
          <label className="col-span-1 sm:col-span-2 flex items-start gap-2 rounded-md border border-slate-300/40 bg-slate-50/40 p-2.5 text-xs cursor-pointer dark:border-slate-700/40 dark:bg-slate-900/10">
            <input
              type="checkbox"
              checked={excludedFromTotals}
              onChange={(e) => setExcludedFromTotals(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="font-medium text-foreground">
                אל תספור בסיכומים (תנועה חשבונאית בלבד)
              </p>
              <p className="mt-0.5 text-muted-foreground">
                התנועה <strong>תוצג ברשימה</strong> אבל <strong>לא תיכלל בשום סיכום</strong> —
                לא בסיכומים החודשיים, לא בסיכומי הפרויקט, ולא בתובנות.
                שימושי לתנועות שהן רק תיעוד חשבונאי ולא תזוזת כסף אמיתית —
                למשל פתיחת הלוואה ישנה כדי לסגור אותה במשכנתא חדשה, או שורות
                התאמה פנימיות.
              </p>
            </div>
          </label>
        </div>

        </div>
        {/* Pinned footer — outside the scrollable body so action buttons
            are always visible even when the form content overflows. */}
        <footer className="flex items-center justify-end gap-2 border-t bg-card px-4 py-3">
          <button
            onClick={props.onClose}
            disabled={isPending}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent/40"
          >
            ביטול
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            שמור שינויים
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
  required,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${className ?? ''}`}>
      <span>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}
