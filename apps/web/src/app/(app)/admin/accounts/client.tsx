'use client';

import { useState, useTransition } from 'react';
import { formatIls } from '@fba/shared';
import {
  CreditCard,
  Landmark,
  Pencil,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createAccount,
  updateAccount,
  deleteAccount,
  bulkToggleAccountsActive,
  toggleAccountActive,
} from './actions';

// ─── types ────────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  name: string;
  type: 'bank' | 'credit_card';
  purpose: 'personal' | 'business' | 'shared';
  institution: string;
  accountNumberMasked: string | null;
  externalKey: string | null;
  paymentSchedule: 'immediate' | 'monthly_billing';
  cutoffDay: number;
  chargeDay: number;
  isActive: boolean;
  currency: string;
  /** Anchor for cumulative balance — the known balance at openingBalanceAsOf */
  openingBalanceIls: number;
  /** ISO date (YYYY-MM-DD) the openingBalanceIls was true; null = "before all txns" */
  openingBalanceAsOf: string | null;
  txnCount: number;
  txnTotal: number;
  /**
   * Sum of amounts for transactions where chargeDate >= openingBalanceAsOf
   * (or all transactions, if openingBalanceAsOf is null). Used together with
   * openingBalanceIls to display the "current cumulative balance" per account.
   */
  txnSumSinceOpening: number;
  /** true = auto-created by the system, not deletable */
  isSystem: boolean;
}

// ─── billing cycle presets ────────────────────────────────────────────────────

const BILLING_PRESETS = [
  { label: 'מיידי (בנק / חיוב ישיר)', schedule: 'immediate', cutoff: 0, charge: 0 },
  { label: 'כרטיס אשראי – יום 10 (Cal, Max, לאומי קארד)', schedule: 'monthly_billing', cutoff: 10, charge: 10 },
  { label: 'כרטיס אשראי – יום 5 (דיסקונט)', schedule: 'monthly_billing', cutoff: 5, charge: 5 },
  { label: 'כרטיס אשראי – יום 15', schedule: 'monthly_billing', cutoff: 15, charge: 15 },
  { label: 'מותאם אישית', schedule: 'monthly_billing', cutoff: -1, charge: -1 }, // -1 = show fields
] as const;

const INSTITUTIONS = [
  'בנק הפועלים',
  'בנק לאומי',
  'בנק דיסקונט',
  'בנק מזרחי-טפחות',
  'בנק ירושלים',
  'בנק אוצר החייל',
  'Cal (כאל)',
  'Visa (לאומי קארד)',
  'Isracard (ישראכרט)',
  'Max (מקס)',
  'ביט',
  'פייבוקס',
  'מזומן',
  'אחר',
];

// ─── helper labels ────────────────────────────────────────────────────────────

const PURPOSE_LABEL = {
  personal: 'אישי',
  business: 'עסקי',
  shared: 'משותף',
};
const PURPOSE_COLOR = {
  personal: 'bg-blue-100 text-blue-700',
  business: 'bg-amber-100 text-amber-700',
  shared: 'bg-green-100 text-green-700',
};

function billingLabel(a: AccountRow): string {
  if (a.paymentSchedule === 'immediate') return 'מיידי';
  if (a.cutoffDay > 0) return `יום ${a.cutoffDay}`;
  return 'חיוב חודשי';
}

// ─── account form ─────────────────────────────────────────────────────────────

function AccountForm({
  initial,
  onClose,
  onSuccess,
}: {
  initial?: AccountRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!initial;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  // Derive initial preset index
  const initPreset = initial
    ? initial.paymentSchedule === 'immediate'
      ? 0
      : BILLING_PRESETS.findIndex(
          (p) => p.schedule === 'monthly_billing' && p.cutoff === initial.cutoffDay,
        ) || 4
    : 1; // default: Cal 10th

  const [presetIdx, setPresetIdx] = useState<number>(initPreset < 0 ? 4 : initPreset);
  const [customCutoff, setCustomCutoff] = useState(String(initial?.cutoffDay ?? 10));
  const [customCharge, setCustomCharge] = useState(String(initial?.chargeDay ?? 10));
  const [schedule, setSchedule] = useState<'immediate' | 'monthly_billing'>(
    initial?.paymentSchedule ?? 'monthly_billing',
  );

  const preset = BILLING_PRESETS[presetIdx];
  const isCustom = presetIdx === 4;
  const isImmediate = preset?.schedule === 'immediate';

  function applyPreset(idx: number) {
    setPresetIdx(idx);
    const p = BILLING_PRESETS[idx];
    if (!p) return;
    setSchedule(p.schedule === 'immediate' ? 'immediate' : 'monthly_billing');
    if (p.cutoff > 0) {
      setCustomCutoff(String(p.cutoff));
      setCustomCharge(String(p.charge));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    // Inject computed billing values
    fd.set('paymentSchedule', schedule);
    if (!isImmediate) {
      fd.set('cutoffDay', isCustom ? customCutoff : String(preset?.cutoff ?? 10));
      fd.set('chargeDay', isCustom ? customCharge : String(preset?.charge ?? 10));
    } else {
      fd.set('cutoffDay', '0');
      fd.set('chargeDay', '0');
    }

    startTransition(async () => {
      const res = isEdit ? await updateAccount(fd) : await createAccount(fd);
      if (!res.ok) {
        setError(res.error ?? 'שגיאה לא ידועה');
        return;
      }
      onSuccess();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">
            {isEdit ? `עריכת חשבון — ${initial.name}` : 'חשבון חדש'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {isEdit && <input type="hidden" name="id" value={initial.id} />}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Name */}
            <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              שם חשבון *
              <input
                name="name"
                required
                defaultValue={initial?.name}
                placeholder="לדוגמה: כאל אישי, בנק הפועלים עסקי"
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>

            {/* Institution */}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              מוסד / בנק *
              <input
                name="institution"
                required
                defaultValue={initial?.institution}
                list="institution-list"
                placeholder="בחר או הקלד"
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <datalist id="institution-list">
                {INSTITUTIONS.map((i) => <option key={i} value={i} />)}
              </datalist>
            </label>

            {/* Account number */}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              4 ספרות אחרונות
              <input
                name="accountNumberMasked"
                maxLength={4}
                defaultValue={initial?.accountNumberMasked ?? ''}
                placeholder="****1234"
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>

            {/* External key — used by /import auto-routing */}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
              מזהה חיצוני (לזיהוי קבצי ייבוא אוטומטי)
              <input
                name="externalKey"
                defaultValue={initial?.externalKey ?? ''}
                placeholder='לדוגמה: 7627 (4 ספרות של כרטיס) או 669-4703428 (מספר חשבון בנק)'
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <span className="text-[10px] font-normal text-muted-foreground/80">
                כשתעלה קובץ ב-/ייבוא ללא בחירת חשבון, נחפש את הערך הזה בתוך הקובץ ונחבר אוטומטית.
                לכרטיסי אשראי — 4 ספרות אחרונות. לחשבונות בנק — מספר החשבון מהפורטל.
              </span>
            </label>

            {/* Type */}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              סוג
              <select
                name="type"
                defaultValue={initial?.type ?? 'bank'}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="bank">חשבון בנק</option>
                <option value="credit_card">כרטיס אשראי</option>
              </select>
            </label>

            {/* Purpose */}
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              ייעוד
              <select
                name="purpose"
                defaultValue={initial?.purpose ?? 'personal'}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="personal">אישי</option>
                <option value="business">עסקי</option>
                <option value="shared">משותף</option>
              </select>
            </label>
          </div>

          {/* ── Billing cycle ── */}
          <fieldset className="space-y-3 rounded-lg border border-dashed border-primary/30 bg-primary-soft/30 p-3">
            <legend className="px-1 text-xs font-semibold text-primary">מחזור חיוב</legend>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              תבנית
              <select
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                value={presetIdx}
                onChange={(e) => applyPreset(Number(e.target.value))}
              >
                {BILLING_PRESETS.map((p, i) => (
                  <option key={i} value={i}>{p.label}</option>
                ))}
              </select>
            </label>

            {!isImmediate && isCustom && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  יום גזירה
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={customCutoff}
                    onChange={(e) => setCustomCutoff(e.target.value)}
                    className="rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground/70">עסקאות עד יום זה = חיוב החודש</span>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  יום חיוב
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={customCharge}
                    onChange={(e) => setCustomCharge(e.target.value)}
                    className="rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="text-[10px] text-muted-foreground/70">היום שהבנק מחייב את חשבונך</span>
                </label>
              </div>
            )}

            {!isImmediate && !isCustom && (
              <p className="text-[11px] text-muted-foreground">
                עסקאות עד יום <strong>{preset?.cutoff}</strong> בחודש ייכללו בחיוב החודש הנוכחי.
                עסקאות מיום <strong>{(preset?.cutoff ?? 0) + 1}</strong> ואילך — בחיוב החודש הבא.
                החיוב יתבצע ב-<strong>{preset?.charge}</strong> לחודש.
              </p>
            )}

            {isImmediate && (
              <p className="text-[11px] text-muted-foreground">
                כל עסקה מחויבת ביום שבוצעה — אין תאריך חיוב נפרד.
              </p>
            )}
          </fieldset>

          {/* Opening balance — anchor for cumulative balance KPI */}
          <fieldset className="space-y-3 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
            <legend className="px-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              יתרת פתיחה (לחישוב יתרה מצטברת בפועל)
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                יתרה ב-ILS
                <input
                  type="number"
                  name="openingBalanceIls"
                  step="0.01"
                  defaultValue={initial?.openingBalanceIls ?? 0}
                  placeholder="0.00"
                  className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                />
                <span className="text-[10px] font-normal text-muted-foreground/80">
                  היתרה הידועה בחשבון בתאריך שתבחר. שלילי = משיכת יתר.
                </span>
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                נכון לתאריך
                <input
                  type="date"
                  name="openingBalanceAsOf"
                  defaultValue={initial?.openingBalanceAsOf ?? ''}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                />
                <span className="text-[10px] font-normal text-muted-foreground/80">
                  ריק = לפני כל התנועות במערכת. מומלץ: תאריך היום + יתרה נוכחית מהבנק.
                </span>
              </label>
            </div>

            <p className="rounded-md bg-emerald-100/60 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
              💡 <strong>הדרך הקלה ביותר:</strong> פתח את אתר הבנק עכשיו, העתק את היתרה הנוכחית
              בעו&quot;ש, הדבק כאן + סמן בתאריך &quot;היום&quot;. שמור. מעכשיו, היתרה לכל חודש בעבר
              ובעתיד תחושב אוטומטית מהתנועות במערכת — כולל תוספת/עדכון/מחיקה. אין צורך לדעת
              את היתרה ההיסטורית.
            </p>
          </fieldset>

          {/* Active */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              value="true"
              defaultChecked={initial?.isActive !== false}
            />
            חשבון פעיל
          </label>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
            >
              {isPending ? 'שומר...' : isEdit ? 'עדכן' : 'הוסף חשבון'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── delete confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({
  account,
  txnCount,
  onClose,
  onDeleted,
}: {
  account: AccountRow;
  txnCount?: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function doDelete(force: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', account.id);
      fd.set('force', String(force));
      const res = await deleteAccount(fd);
      if (res.ok) {
        onDeleted();
        onClose();
      }
    });
  }

  const hasTransactions = (txnCount ?? account.txnCount) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl" dir="rtl">
        <h2 className="mb-2 text-base font-semibold text-destructive">מחיקת חשבון</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          האם למחוק את <strong>{account.name}</strong>?
        </p>
        {hasTransactions && (
          <div className="mb-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
            <strong>שים לב:</strong> לחשבון זה יש{' '}
            <strong>{txnCount ?? account.txnCount}</strong> תנועות.
            מחיקת החשבון לא תמחק את התנועות, אך הן יאבדו את הקישור לחשבון.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            ביטול
          </button>
          <button
            onClick={() => doDelete(true)}
            disabled={isPending}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-destructive/90"
          >
            {isPending ? 'מוחק...' : 'מחק'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function AccountsClient({ initialAccounts }: { initialAccounts: AccountRow[] }) {
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ account: AccountRow; txnCount?: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reload by navigating (Next.js will revalidate server data)
  function refresh() {
    window.location.reload();
  }

  function toggleAll(checked: boolean) {
    setSelected(
      checked
        ? new Set(accounts.filter((a) => !a.isSystem).map((a) => a.id))
        : new Set(),
    );
  }
  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  function bulkToggle(active: boolean) {
    if (selected.size === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      Array.from(selected).forEach((id) => fd.append('ids', id));
      fd.set('isActive', String(active));
      await bulkToggleAccountsActive(fd);
      setSelected(new Set());
      refresh();
    });
  }

  function handleDeleteClick(a: AccountRow) {
    if (a.txnCount > 0) {
      setDeleteTarget({ account: a, txnCount: a.txnCount });
    } else {
      setDeleteTarget({ account: a, txnCount: 0 });
    }
  }

  function handleToggleActive(a: AccountRow) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', a.id);
      fd.set('isActive', String(!a.isActive));
      await toggleAccountActive(fd);
      refresh();
    });
  }

  const selectableAccounts = accounts.filter((a) => !a.isSystem);

  return (
    <>
      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-sm font-semibold text-primary">נבחרו {selected.size}</span>
              <button
                onClick={() => bulkToggle(true)}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <ToggleRight className="size-3.5 text-success" />
                הפעל
              </button>
              <button
                onClick={() => bulkToggle(false)}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <ToggleLeft className="size-3.5 text-muted-foreground" />
                השבת
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:underline"
              >
                בטל בחירה
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          הוסף חשבון
        </button>
      </div>

      {/* ── table ── */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-right">
            <tr>
              <th className="border-b px-2 py-2 w-8">
                <input
                  type="checkbox"
                  checked={
                    selectableAccounts.length > 0 &&
                    selectableAccounts.every((a) => selected.has(a.id))
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <th className="border-b px-3 py-2 font-medium">שם</th>
              <th className="border-b px-3 py-2 font-medium">מוסד</th>
              <th className="border-b px-3 py-2 font-medium">ייעוד</th>
              <th className="border-b px-3 py-2 font-medium">מחזור חיוב</th>
              <th className="border-b px-3 py-2 text-left font-medium">תנועות</th>
              <th className="border-b px-3 py-2 text-left font-medium">נטו</th>
              <th
                className="border-b px-3 py-2 text-left font-medium"
                title="יתרה מצטברת בפועל = יתרת פתיחה + סכום תנועות מאז התאריך הנכון"
              >
                יתרה מצטברת
              </th>
              <th className="border-b px-3 py-2 font-medium">סטטוס</th>
              <th className="border-b px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                  אין חשבונות. לחץ על &quot;הוסף חשבון&quot; כדי להתחיל.
                </td>
              </tr>
            )}
            {accounts.map((a) => {
              const Icon = a.type === 'credit_card' ? CreditCard : Landmark;
              return (
                <tr
                  key={a.id}
                  className={cn(
                    'border-b last:border-0 transition-colors hover:bg-accent/20',
                    !a.isActive && 'opacity-50',
                    selected.has(a.id) && 'bg-primary-soft/30',
                  )}
                >
                  <td className="px-2 py-2.5">
                    {!a.isSystem && (
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={(e) => toggleOne(a.id, e.target.checked)}
                      />
                    )}
                  </td>

                  {/* Name + type icon */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{a.name}</span>
                      {a.accountNumberMasked && (
                        <span className="text-xs text-muted-foreground">···{a.accountNumberMasked}</span>
                      )}
                      {a.isSystem && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          מערכת
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Institution */}
                  <td className="px-3 py-2.5 text-muted-foreground">{a.institution}</td>

                  {/* Purpose */}
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        PURPOSE_COLOR[a.purpose],
                      )}
                    >
                      {PURPOSE_LABEL[a.purpose]}
                    </span>
                  </td>

                  {/* Billing cycle */}
                  <td className="px-3 py-2.5">
                    {a.paymentSchedule === 'immediate' ? (
                      <span className="text-xs text-muted-foreground">מיידי</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Zap className="size-3 text-sky-500" />
                        <span>גזירה {a.cutoffDay} · חיוב {a.chargeDay}</span>
                      </span>
                    )}
                  </td>

                  {/* Txn count */}
                  <td className="px-3 py-2.5 text-left tabular-nums text-muted-foreground">
                    {a.txnCount}
                  </td>

                  {/* Net total */}
                  <td
                    className={cn(
                      'px-3 py-2.5 text-left tabular-nums',
                      a.txnTotal < 0 ? 'text-destructive' : a.txnTotal > 0 ? 'text-success' : 'text-muted-foreground',
                    )}
                  >
                    {a.txnCount > 0 ? formatIls(a.txnTotal, { decimals: false }) : '—'}
                  </td>

                  {/* Cumulative balance — opening + sum-since-opening (Phase B) */}
                  <td
                    className={cn(
                      'px-3 py-2.5 text-left tabular-nums',
                      (() => {
                        const cum = a.openingBalanceIls + a.txnSumSinceOpening;
                        return cum < 0
                          ? 'text-destructive font-medium'
                          : cum > 0
                            ? 'text-emerald-600 font-medium'
                            : 'text-muted-foreground';
                      })(),
                    )}
                    title={
                      `יתרת פתיחה: ${formatIls(a.openingBalanceIls, { decimals: false })}\n` +
                      `+ סכום תנועות מאז ${a.openingBalanceAsOf ?? 'תחילת המערכת'}: ${formatIls(a.txnSumSinceOpening, { decimals: false })}\n` +
                      `= ${formatIls(a.openingBalanceIls + a.txnSumSinceOpening, { decimals: false })}`
                    }
                  >
                    {formatIls(a.openingBalanceIls + a.txnSumSinceOpening, { decimals: false })}
                  </td>

                  {/* Active badge */}
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        a.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {a.isActive ? 'פעיל' : 'לא פעיל'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {!a.isSystem && (
                        <>
                          <button
                            title={a.isActive ? 'השבת' : 'הפעל'}
                            onClick={() => handleToggleActive(a)}
                            disabled={isPending}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
                          >
                            {a.isActive ? (
                              <ToggleRight className="size-3.5 text-success" />
                            ) : (
                              <ToggleLeft className="size-3.5" />
                            )}
                          </button>
                          <button
                            title="ערוך"
                            onClick={() => setEditAccount(a)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            title="מחק"
                            onClick={() => handleDeleteClick(a)}
                            className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── modals ── */}
      {showCreate && (
        <AccountForm onClose={() => setShowCreate(false)} onSuccess={refresh} />
      )}
      {editAccount && (
        <AccountForm
          initial={editAccount}
          onClose={() => setEditAccount(null)}
          onSuccess={refresh}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          account={deleteTarget.account}
          txnCount={deleteTarget.txnCount}
          onClose={() => setDeleteTarget(null)}
          onDeleted={refresh}
        />
      )}
    </>
  );
}
