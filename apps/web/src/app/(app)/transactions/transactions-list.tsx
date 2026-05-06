'use client';

import { useState, useTransition, useMemo } from 'react';
import { formatIls } from '@fba/shared';
import { Sparkles, Trash2, Pencil, Zap, Clock, CalendarClock, CreditCard, Settings2, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RuleModal } from './rule-modal';
import { EditTransactionModal } from './edit-modal';
import { RecurringModal, type RecurringPrefill } from '../recurring/recurring-modal';
import { InstallmentModal, type InstallmentPrefill } from '../installments/installment-modal';
import { TransactionsFilter, emptyFilter, isFilterActive, type FilterState } from './transactions-filter';
import { bulkDeleteTransactions, bulkApplyRule, bulkSetCategory } from './rule-actions';
import { deleteTransaction } from './actions';
import {
  ColumnsCustomizer,
  ColumnResizeHandle,
  useColumnPrefs,
  type CellContext,
} from './transactions-columns';

interface Cat { id: string; nameHe: string; color?: string | null }
interface SubCat extends Cat { parentId: string }
interface Account { id: string; name: string; type?: string }
interface Rule { id: string; label: string; categoryId: string | null }
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
  appliedRuleId?: string | null;
  categorySource?: string | null;
  ruleName?: string | null;
  isManual?: boolean;
  // Installment-plan link. When installmentPlanId is non-null, this row is
  // one monthly payment of a multi-payment plan — render with a primary
  // accent + a "תשלום N/Y · עד MM/YY" pill.
  installmentPlanId?: string | null;
  installmentCurrentPaymentNo?: number | null;
  installmentTotalPayments?: number | null;
  installmentEndMonth?: string | null;  // 'YYYY-MM'
  // Recurring-pattern link. When recurringPatternId is non-null, this row's
  // merchant matches one of the user's active recurring patterns
  // (subscriptions / monthly bills) — render a "🔄 קבוע" pill, contributes
  // to the section-header recurring subtotal.
  recurringPatternId?:        string | null;
  recurringPatternFrequency?: string | null; // 'monthly' | 'bimonthly' etc.
}

function sumExpenses(txns: Transaction[]) {
  return txns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
}
function sumIncome(txns: Transaction[]) {
  return txns.filter((t) => t.amount >= 0).reduce((s, t) => s + t.amount, 0);
}
/** Sum of installment-linked expenses in a slice. Used in section headers
 *  ("מהן ₪750 בתשלומים") so the user knows how much of the cycle is locked
 *  into existing payment plans. */
function sumInstallments(txns: Transaction[]) {
  return txns
    .filter((t) => t.installmentPlanId && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
}
/** Sum of recurring-pattern expenses in a slice (excluding installments
 *  to avoid double-counting — installments have their own subtotal). */
function sumRecurring(txns: Transaction[]) {
  return txns
    .filter((t) => t.recurringPatternId && !t.installmentPlanId && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
}

export function TransactionsList(props: {
  transactions: Transaction[];
  categories: Cat[];
  subCategories: SubCat[];
  accounts: Account[];
  rules: Rule[];
  billingMonth: string;        // calendar month, e.g. "2026-05"
  cycleChargeDate: string;     // current cycle charge date, e.g. "2026-05-10"
  nextCycleChargeDate: string; // next cycle charge date, e.g. "2026-06-10"
  nextMonth: string;           // next calendar month, e.g. "2026-06"
}) {
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [ruleModalForId, setRuleModalForId] = useState<string | null>(null);
  const [editTxnId, setEditTxnId]       = useState<string | null>(null);
  // Per-row "mark as ..." quick actions: open a pre-filled create modal
  // for either /recurring or /installments using the transaction's data
  // (merchant name, amount, account). Saves the user from navigating
  // away to those pages just to add one entry.
  const [markRecurringPrefill, setMarkRecurringPrefill] = useState<RecurringPrefill | null>(null);
  const [markInstallmentPrefill, setMarkInstallmentPrefill] = useState<InstallmentPrefill | null>(null);
  const [filter, setFilter]             = useState<FilterState>(emptyFilter);
  const [bulkCatId, setBulkCatId]       = useState('');
  const [bulkRuleId, setBulkRuleId]     = useState('');
  const [isPending, startTransition]    = useTransition();
  const [columnsOpen, setColumnsOpen]   = useState(false);

  // Customizable columns — user can show/hide and reorder via the
  // "Columns" button. Persisted to localStorage. The leading checkbox
  // and trailing actions cells are NOT customizable; they're always-on
  // bookends rendered explicitly below.
  const { prefs: colPrefs, visibleColumns, setOrder: setColOrder, setVisible: setColVisible, setWidth: setColWidth, reset: resetCols } = useColumnPrefs();

  // colSpan for full-width rows (section headers, "no transactions" message).
  // = visible data columns + 2 bookends (checkbox + actions).
  const COL_COUNT = visibleColumns.length + 2;

  const catMap = useMemo(
    () => new Map<string, Cat>([...props.categories, ...props.subCategories].map((c) => [c.id, c])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.categories, props.subCategories],
  );
  const accMap = useMemo(
    () => new Map(props.accounts.map((a) => [a.id, a])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.accounts],
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  // ── client-side filtering ──────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (!isFilterActive(filter)) return props.transactions;
    const textLower = filter.text.toLowerCase();
    return props.transactions.filter((t) => {
      if (filter.text && !t.merchant.toLowerCase().includes(textLower)) return false;
      if (filter.categoryId && t.categoryId !== filter.categoryId) return false;
      if (filter.accountId && t.accountId !== filter.accountId) return false;
      if (filter.sign === 'expense' && t.amount >= 0) return false;
      if (filter.sign === 'income' && t.amount < 0) return false;
      if (filter.flag === 'recurring'   && !t.recurringPatternId) return false;
      if (filter.flag === 'installment' && !t.installmentPlanId)  return false;
      if (filter.flag === 'one-off'     && (t.recurringPatternId || t.installmentPlanId)) return false;
      if (filter.dateFrom && t.date < filter.dateFrom) return false;
      if (filter.dateTo && t.date > filter.dateTo) return false;
      return true;
    });
  }, [props.transactions, filter]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visible.map((t) => t.id)) : new Set());
  }
  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  }

  function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`למחוק ${selected.size} תנועות? ניתן לשחזר ביומן הביקורת.`)) return;
    const fd = new FormData();
    Array.from(selected).forEach((id) => fd.append('transactionIds', id));
    startTransition(async () => { await bulkDeleteTransactions(fd); setSelected(new Set()); });
  }

  function bulkRecategorize() {
    if (!bulkCatId || selected.size === 0) return;
    const fd = new FormData();
    fd.set('categoryId', bulkCatId);
    Array.from(selected).forEach((id) => fd.append('transactionIds', id));
    startTransition(async () => { await bulkSetCategory(fd); setSelected(new Set()); setBulkCatId(''); });
  }

  function bulkApplyRuleAction() {
    if (!bulkRuleId || selected.size === 0) return;
    const fd = new FormData();
    fd.set('ruleId', bulkRuleId);
    Array.from(selected).forEach((id) => fd.append('transactionIds', id));
    startTransition(async () => { await bulkApplyRule(fd); setSelected(new Set()); setBulkRuleId(''); });
  }

  function deleteOne(id: string) {
    if (!confirm('למחוק את התנועה?')) return;
    startTransition(async () => { await deleteTransaction(id); });
  }

  return (
    <>
      <TransactionsFilter
        filter={filter}
        categories={props.categories}
        accounts={props.accounts}
        totalCount={props.transactions.length}
        filteredCount={visible.length}
        onChange={setFilter}
      />

      {props.transactions.length === 0 && (
        <section className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          אין תנועות לחודש זה. הוסף תנועה מהטופס למעלה.
        </section>
      )}

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary-soft p-2 text-sm shadow-sm">
          <span className="font-semibold text-primary min-w-fit">נבחרו {selected.size} תנועות</span>
          <div className="flex items-center gap-1">
            <select value={bulkCatId} onChange={(e) => setBulkCatId(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-xs">
              <option value="">שנה קטגוריה...</option>
              {props.categories.map((c) => <option key={c.id} value={c.id}>{c.nameHe}</option>)}
            </select>
            <button onClick={bulkRecategorize} disabled={!bulkCatId || isPending} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90">החל</button>
          </div>
          {props.rules.length > 0 && (
            <div className="flex items-center gap-1">
              <select value={bulkRuleId} onChange={(e) => setBulkRuleId(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-xs">
                <option value="">החל כלל...</option>
                {props.rules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button onClick={bulkApplyRuleAction} disabled={!bulkRuleId || isPending} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground disabled:opacity-40 hover:bg-accent/80">
                <Zap className="size-3" />החל
              </button>
            </div>
          )}
          <button onClick={bulkDelete} disabled={isPending} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40">
            <Trash2 className="size-3.5" />מחק
          </button>
          <button onClick={() => setSelected(new Set())} className="ms-auto text-xs text-muted-foreground hover:underline">ביטול בחירה</button>
        </div>
      )}

      {props.transactions.length > 0 && (
        <section className="rounded-lg border bg-card">
          {/* On screens >=lg the cells switch to whitespace-nowrap so wide
              monitors actually USE the horizontal real estate instead of
              wrapping Hebrew text mid-column. notes column still truncates
              by design — it can be very long. */}
          <table className="min-w-full text-sm [&_tbody_td]:lg:whitespace-nowrap">
            {/* Sticky header: stays visible while you scroll long lists.
                top-0 anchors to the scrollport top; z-20 keeps it above
                the section dividers; bg-muted/95 keeps it readable. */}
            <thead className="sticky top-0 z-20 bg-muted/95 text-right shadow-sm backdrop-blur">
              <tr>
                <th className="border-b px-2 py-2 w-8 align-middle">
                  <div className="flex items-center justify-center">
                    <input type="checkbox" checked={visible.length > 0 && visible.every((t) => selected.has(t.id))} onChange={(e) => toggleAll(e.target.checked)} aria-label="בחר הכל" />
                  </div>
                </th>
                {visibleColumns.map((col) => {
                  const userWidth = colPrefs.widths[col.id];
                  return (
                    <th
                      key={col.id}
                      className={cn(col.headClass, 'relative')}
                      style={userWidth ? { width: `${userWidth}px`, minWidth: `${userWidth}px`, maxWidth: `${userWidth}px` } : undefined}
                    >
                      {col.label}
                      <ColumnResizeHandle
                        onWidthChange={(next) => setColWidth(col.id, next)}
                        onReset={() => setColWidth(col.id, null)}
                      />
                    </th>
                  );
                })}
                {/* Action column header — also hosts the "עמודות" button so
                    the customizer is always reachable from the table chrome
                    itself, not from a separate toolbar above. */}
                <th className="border-b px-3 py-2">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setColumnsOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground/80 shadow-sm hover:border-accent/50 hover:bg-accent/10 hover:text-foreground"
                      title="הסתר/הצג עמודות וסדר אותן מחדש"
                    >
                      <Settings2 className="size-3.5" />
                      עמודות
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={COL_COUNT} className="px-3 py-8 text-center text-muted-foreground">
                    אין תנועות התואמות את הסינון.
                  </td>
                </tr>
              )}
              {(() => {
                const monthStart = `${props.billingMonth}-01`;

                // ── Split: immediate (bank) vs credit-card ────────────────
                // Bank transactions are charged the moment they happen — they
                // don't belong in a billing-cycle group. Separate them first.
                const isImmediateTx = (t: Transaction) =>
                  accMap.get(t.accountId)?.type === 'bank';

                const immediateTxns = visible.filter(isImmediateTx);
                const ccTxns        = visible.filter((t) => !isImmediateTx(t));

                // ── Three CC groups by transaction date ───────────────────
                // 1. Carry-over : dated before this month (prev-month, billing here)
                // 2. Current cycle: dated 1st–10th → charges this month's 10th
                // 3. Next cycle   : dated 11th+    → charges NEXT month's 10th
                const carryOver    = ccTxns.filter((t) => t.date <  monthStart);
                const currentCycle = ccTxns.filter((t) => t.date >= monthStart && t.date <= props.cycleChargeDate);
                const nextCycle    = ccTxns.filter((t) => t.date >  props.cycleChargeDate);

                const isCycleCharged     = props.cycleChargeDate <= todayStr;
                const cycleDateLabel     = `${props.cycleChargeDate.slice(8, 10)}/${props.cycleChargeDate.slice(5, 7)}`;
                const nextCycleDateLabel = `${props.nextCycleChargeDate.slice(8, 10)}/${props.nextCycleChargeDate.slice(5, 7)}`;

                // ── Render a single transaction row ───────────────────────
                // groupChargeDate: the charge date that applies to this group
                const renderRow = (t: Transaction, groupChargeDate: string) => {
                  const cat    = t.categoryId    ? catMap.get(t.categoryId)    : null;
                  const subCat = t.subCategoryId ? catMap.get(t.subCategoryId) : null;
                  const acc    = accMap.get(t.accountId);
                  const isSelected    = selected.has(t.id);
                  const isImmediateRow = acc?.type === 'bank';

                  // Per-row pending badge: use explicit chargeDate if set, else group's date
                  // Bank rows are never "pending" — the charge happened immediately
                  const effectiveChargeDate = isImmediateRow ? null : (t.chargeDate ?? groupChargeDate);
                  const isPendingCharge     = !isImmediateRow && !!effectiveChargeDate && effectiveChargeDate > todayStr;
                  // Only surface a per-row charge-date badge when the row's
                  // charge date DIVERGES from the group's default (e.g., a
                  // foreign-currency CC charge with a custom date). When it
                  // matches the group, the section header already tells the
                  // user when the cycle bills — no point repeating it on
                  // every row.
                  const chargeDateDiffersFromGroup =
                    !isImmediateRow && !!t.chargeDate && t.chargeDate !== groupChargeDate;

                  const isAutoRule        = t.categorySource === 'rule';
                  const isBankHint        = t.categorySource === 'bank_hint';
                  const isMerchantKeyword = t.categorySource === 'merchant_keyword';
                  const isTaggedExport    = t.categorySource === 'tagged_export';
                  const isLlm             = t.categorySource === 'llm';
                  const txIsManual        = t.isManual !== false;
                  const isInstallment     = !!t.installmentPlanId;

                  // Build the cell-render context once per row. Each visible
                  // column's renderCell picks what it needs from this bag.
                  const cellCtx: CellContext = {
                    t,
                    cat:    cat    ?? null,
                    subCat: subCat ?? null,
                    acc:    acc    ?? null,
                    isInstallment,
                    isAutoRule,
                    isBankHint,
                    isMerchantKeyword,
                    isTaggedExport,
                    isLlm,
                    txIsManual,
                    chargeDateDiffersFromGroup,
                    isPendingCharge,
                    effectiveChargeDate,
                  };

                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        'border-b last:border-0 transition-colors hover:bg-accent/30',
                        isSelected && 'bg-primary-soft/40',
                        // Right-border accent (= visual start in RTL) marks
                        // installment-linked rows so they stand out at a glance
                        // without changing the row layout.
                        isInstallment && 'border-r-2 border-r-primary/60',
                      )}
                    >
                      {/* Selection checkbox (always-on bookend) — vertically
                          centered with the row content, matching the header. */}
                      <td className="px-2 py-2 align-middle">
                        <div className="flex items-center justify-center">
                          <input type="checkbox" checked={isSelected} onChange={(e) => toggleOne(t.id, e.target.checked)} />
                        </div>
                      </td>

                      {/* Customizable middle columns — render in user's
                          chosen order, hiding ones they unchecked.
                          Width matches the user's drag-resized header. */}
                      {visibleColumns.map((col) => {
                        const userWidth = colPrefs.widths[col.id];
                        return (
                          <td
                            key={col.id}
                            className={col.cellClass}
                            style={userWidth ? { width: `${userWidth}px`, minWidth: `${userWidth}px`, maxWidth: `${userWidth}px` } : undefined}
                          >
                            {col.renderCell(cellCtx)}
                          </td>
                        );
                      })}

                      {/* Action buttons (always-on bookend) */}
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setEditTxnId(t.id)} className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40" title="ערוך תנועה" aria-label="ערוך תנועה">
                            <Pencil className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => setRuleModalForId(t.id)} className="rounded-md p-1.5 text-accent hover:bg-accent-soft" title="כללים לתנועה זו" aria-label="פתח כללים">
                            <Sparkles className="size-3.5" />
                          </button>
                          {/* Quick "mark as recurring" — pre-fills the
                              create modal with this transaction's data,
                              avoiding a navigation to /recurring. Only
                              shown for non-recurring rows. */}
                          {!t.recurringPatternId && (
                            <button
                              type="button"
                              onClick={() => setMarkRecurringPrefill({
                                merchant:   t.merchant,
                                amount:     Math.abs(t.amount),
                                sign:       t.amount < 0 ? 'expense' : 'income',
                                categoryId: t.categoryId ?? null,
                              })}
                              className="rounded-md p-1.5 text-primary hover:bg-primary/10"
                              title="סמן בית עסק זה כהוצאה/הכנסה קבועה"
                              aria-label="סמן כקבוע"
                            >
                              <Repeat className="size-3.5" />
                            </button>
                          )}
                          {/* Quick "mark as installment" — same pattern
                              with the installments modal. Hidden for
                              rows already linked to a plan. */}
                          {!t.installmentPlanId && (
                            <button
                              type="button"
                              onClick={() => setMarkInstallmentPrefill({
                                merchant:  t.merchant,
                                amount:    Math.abs(t.amount),
                                accountId: t.accountId,
                              })}
                              className="rounded-md p-1.5 text-primary hover:bg-primary/10"
                              title="צור תוכנית תשלומים מהתנועה הזו"
                              aria-label="סמן כתשלום"
                            >
                              <CreditCard className="size-3.5" />
                            </button>
                          )}
                          <button type="button" onClick={() => deleteOne(t.id)} disabled={isPending} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" title="מחק">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                };

                // ── Section header helper ─────────────────────────────────
                const SectionHeader = ({
                  icon, label, count, expenses, income, installments, recurring,
                  colorClass, bgClass,
                }: {
                  icon: React.ReactNode;
                  label: string;
                  count: number;
                  expenses: number;
                  income: number;
                  /** Subtotal of installment-linked expenses in this group.
                   *  When > 0, render a "מהן ₪X בתשלומים" hint so the user
                   *  knows how much of the cycle is locked into payment
                   *  plans they've already committed to. */
                  installments: number;
                  /** Subtotal of expenses matching an active recurring
                   *  pattern (subscriptions / monthly bills). Mutually
                   *  exclusive with installments above (sumRecurring
                   *  filters those out). */
                  recurring:    number;
                  colorClass: string;
                  bgClass: string;
                }) => (
                  <tr>
                    <td colSpan={COL_COUNT} className={`border-b px-3 py-2 ${bgClass}`}>
                      <div className={`flex items-center gap-2 text-xs font-semibold ${colorClass}`}>
                        {icon}
                        <span>{label}</span>
                        <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[11px] font-medium opacity-80">{count}</span>
                        <span className="ms-auto flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums font-normal">
                          {expenses > 0 && (
                            <span>
                              הוצאות: <strong className="font-semibold">{formatIls(expenses, { decimals: false })}</strong>
                              {installments > 0 && (
                                <span className="ms-1 inline-flex items-center gap-0.5 text-muted-foreground">
                                  <CreditCard className="size-3 shrink-0" />
                                  <span className="text-[11px]">
                                    מהן <strong className="font-semibold tabular-nums">{formatIls(installments, { decimals: false })}</strong> בתשלומים
                                  </span>
                                </span>
                              )}
                              {recurring > 0 && (
                                <span className="ms-1 inline-flex items-center gap-0.5 text-muted-foreground">
                                  <Repeat className="size-3 shrink-0" />
                                  <span className="text-[11px]">
                                    מהן <strong className="font-semibold tabular-nums">{formatIls(recurring, { decimals: false })}</strong> בקבועות
                                  </span>
                                </span>
                              )}
                            </span>
                          )}
                          {income  > 0 && <span className="text-success">הכנסות: <strong className="font-semibold">{formatIls(income, { decimals: false })}</strong></span>}
                        </span>
                      </div>
                    </td>
                  </tr>
                );

                return (
                  <>
                    {/* ══ GROUP 0: Immediate — bank direct, charged on the day ══ */}
                    {immediateTxns.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<Zap className="size-3.5 shrink-0" />}
                          label="חיובים מיידיים — בנק / הוראות קבע"
                          count={immediateTxns.length}
                          expenses={sumExpenses(immediateTxns)}
                          income={sumIncome(immediateTxns)}
                          installments={sumInstallments(immediateTxns)}
                          recurring={sumRecurring(immediateTxns)}
                          colorClass="text-success"
                          bgClass="bg-success/5 border-success/20"
                        />
                        {immediateTxns.map((t) => renderRow(t, t.date))}
                      </>
                    )}

                    {/* ══ GROUP 1: Carry-over — prev-month, same charge ════ */}
                    {carryOver.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<Clock className="size-3.5 shrink-0" />}
                          label={isCycleCharged
                            ? `מחודש קודם — חויבו ב-${cycleDateLabel}`
                            : `מחודש קודם — יחוייבו ב-${cycleDateLabel}`}
                          count={carryOver.length}
                          expenses={sumExpenses(carryOver)}
                          income={sumIncome(carryOver)}
                          installments={sumInstallments(carryOver)}
                          recurring={sumRecurring(carryOver)}
                          colorClass="text-amber-700 dark:text-amber-400"
                          bgClass="bg-amber-50/40 border-amber-200/50 dark:bg-amber-900/10 dark:border-amber-800/30"
                        />
                        {carryOver.map((t) => renderRow(t, props.cycleChargeDate))}
                      </>
                    )}

                    {/* ══ GROUP 2: Current cycle — days 1–10 ══════════════ */}
                    {currentCycle.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<Clock className="size-3.5 shrink-0" />}
                          label={isCycleCharged
                            ? `חויבו ב-${cycleDateLabel}`
                            : `יחוייבו ב-${cycleDateLabel}`}
                          count={currentCycle.length}
                          expenses={sumExpenses(currentCycle)}
                          income={sumIncome(currentCycle)}
                          installments={sumInstallments(currentCycle)}
                          recurring={sumRecurring(currentCycle)}
                          colorClass={isCycleCharged ? 'text-success' : 'text-amber-700 dark:text-amber-400'}
                          bgClass={isCycleCharged ? 'bg-success/5 border-success/20' : 'bg-amber-50/60 border-amber-200/60 dark:bg-amber-900/10 dark:border-amber-800/40'}
                        />
                        {currentCycle.map((t) => renderRow(t, props.cycleChargeDate))}
                      </>
                    )}

                    {/* ══ GROUP 3: Next cycle — days 11+ ══════════════════ */}
                    {nextCycle.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<CalendarClock className="size-3.5 shrink-0" />}
                          label={`יחוייבו בחודש הבא — ${nextCycleDateLabel}`}
                          count={nextCycle.length}
                          expenses={sumExpenses(nextCycle)}
                          income={sumIncome(nextCycle)}
                          installments={sumInstallments(nextCycle)}
                          recurring={sumRecurring(nextCycle)}
                          colorClass="text-blue-700 dark:text-blue-300"
                          bgClass="bg-blue-50/50 border-blue-200/50 dark:bg-blue-900/10 dark:border-blue-800/40"
                        />
                        {nextCycle.map((t) => renderRow(t, props.nextCycleChargeDate))}
                      </>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </section>
      )}

      {ruleModalForId && (
        <RuleModal
          transactionId={ruleModalForId}
          topCategories={props.categories}
          subCategories={props.subCategories}
          onClose={() => setRuleModalForId(null)}
        />
      )}

      {editTxnId && (() => {
        const txn = props.transactions.find((x) => x.id === editTxnId);
        if (!txn) return null;
        return (
          <EditTransactionModal
            transaction={txn}
            categories={props.categories}
            subCategories={props.subCategories}
            accounts={props.accounts}
            onClose={() => setEditTxnId(null)}
          />
        );
      })()}

      {/* Per-row "mark as recurring" — pre-filled create modal */}
      {markRecurringPrefill && (
        <RecurringModal
          pattern={null}
          prefill={markRecurringPrefill}
          categories={props.categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          onClose={() => setMarkRecurringPrefill(null)}
        />
      )}

      {/* Per-row "mark as installment" — pre-filled create modal */}
      {markInstallmentPrefill && (
        <InstallmentModal
          plan={null}
          prefill={markInstallmentPrefill}
          accounts={props.accounts.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setMarkInstallmentPrefill(null)}
        />
      )}

      {columnsOpen && (
        <ColumnsCustomizer
          prefs={colPrefs}
          onClose={() => setColumnsOpen(false)}
          onSetOrder={setColOrder}
          onSetVisible={setColVisible}
          onReset={resetCols}
        />
      )}
    </>
  );
}
