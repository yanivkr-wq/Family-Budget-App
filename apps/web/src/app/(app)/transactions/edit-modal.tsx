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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="mt-12 w-full max-w-lg rounded-lg border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">עריכת תנועה</h2>
          <button
            onClick={props.onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent/50"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
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

          <Field label="בית עסק" required className="col-span-2">
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

          <Field label="הערות" className="col-span-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <footer className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
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
