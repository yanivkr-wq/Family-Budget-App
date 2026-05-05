'use client';

import { useState, useTransition, useMemo } from 'react';
import { formatIls, formatDateHe } from '@fba/shared';
import { Sparkles, Trash2, Pencil, Zap, User, Clock, Upload, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RuleModal } from './rule-modal';
import { EditTransactionModal } from './edit-modal';
import { TransactionsFilter, emptyFilter, isFilterActive, type FilterState } from './transactions-filter';
import { bulkDeleteTransactions, bulkApplyRule, bulkSetCategory } from './rule-actions';
import { deleteTransaction } from './actions';

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
}

function sumExpenses(txns: Transaction[]) {
  return txns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
}
function sumIncome(txns: Transaction[]) {
  return txns.filter((t) => t.amount >= 0).reduce((s, t) => s + t.amount, 0);
}

const COL_COUNT = 10;

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
  const [filter, setFilter]             = useState<FilterState>(emptyFilter);
  const [bulkCatId, setBulkCatId]       = useState('');
  const [bulkRuleId, setBulkRuleId]     = useState('');
  const [isPending, startTransition]    = useTransition();

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
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-2 py-2 w-8">
                  <input type="checkbox" checked={visible.length > 0 && visible.every((t) => selected.has(t.id))} onChange={(e) => toggleAll(e.target.checked)} aria-label="בחר הכל" />
                </th>
                <th className="border-b px-3 py-2 font-medium">תאריך</th>
                <th className="border-b px-3 py-2 font-medium">בית עסק</th>
                <th className="border-b px-3 py-2 font-medium">חשבון</th>
                <th className="border-b px-3 py-2 font-medium">מקור</th>
                <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
                <th className="border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-foreground/80">הוצאה</th>
                <th className="border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-success">הכנסה</th>
                <th className="border-b px-3 py-2 font-medium">הערות</th>
                <th className="border-b px-3 py-2 font-medium"></th>
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

                  const isAutoRule   = t.categorySource === 'rule';
                  const isLlm        = t.categorySource === 'llm';
                  const txIsManual   = t.isManual !== false;

                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        'border-b last:border-0 transition-colors hover:bg-accent/30',
                        isSelected && 'bg-primary-soft/40',
                      )}
                    >
                      <td className="px-2 py-2 align-top">
                        <input type="checkbox" checked={isSelected} onChange={(e) => toggleOne(t.id, e.target.checked)} />
                      </td>

                      {/* Date + charge-type badge */}
                      <td className="px-3 py-2 align-top tabular-nums">
                        <div>{formatDateHe(t.date)}</div>
                        {isImmediateRow ? (
                          /* Bank direct — money left on transaction date */
                          <div
                            className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
                            title="חויב מיידית — כסף יצא ביום העסקה"
                          >
                            <Zap className="size-2.5 shrink-0" />
                            מיידי
                          </div>
                        ) : isPendingCharge ? (
                          /* CC — future charge date */
                          <div
                            className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            title={`עדיין לא חויב — תאריך חיוב: ${effectiveChargeDate}`}
                          >
                            <Clock className="size-2.5 shrink-0" />
                            יחויב {formatDateHe(effectiveChargeDate!)}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-3 py-2 align-top">{t.merchant}</td>
                      <td className="px-3 py-2 align-top text-muted-foreground">{acc?.name ?? '—'}</td>

                      {/* Source badge */}
                      <td className="px-3 py-2 align-top">
                        {txIsManual ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300" title="הוזן ידנית">
                            <User className="size-2.5" />ידני
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="יובא מקובץ / אוטומטי">
                            <Upload className="size-2.5" />ייבוא
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2 align-top">
                        {cat ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="pill text-xs" style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}>{cat.nameHe}</span>
                              {isAutoRule && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" title={`כלל: ${t.ruleName ?? 'ללא שם'}`}>
                                  <Zap className="size-2.5" />כלל
                                </span>
                              )}
                              {isLlm && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" title="הוצע על ידי AI">
                                  <Sparkles className="size-2.5" />AI
                                </span>
                              )}
                            </div>
                            {subCat && <span className="text-[11px] text-muted-foreground">↳ {subCat.nameHe}</span>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* הוצאה — right-aligned, shows minus sign */}
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {t.amount < 0 ? formatIls(t.amount) : ''}
                      </td>

                      {/* הכנסה — right-aligned, green */}
                      <td className="px-3 py-2 text-right align-top tabular-nums text-success">
                        {t.amount >= 0 ? formatIls(t.amount) : ''}
                      </td>

                      <td className="max-w-xs truncate px-3 py-2 align-top text-muted-foreground" title={t.notes ?? ''}>{t.notes}</td>

                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setEditTxnId(t.id)} className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40" title="ערוך תנועה" aria-label="ערוך תנועה">
                            <Pencil className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => setRuleModalForId(t.id)} className="rounded-md p-1.5 text-accent hover:bg-accent-soft" title="כללים לתנועה זו" aria-label="פתח כללים">
                            <Sparkles className="size-3.5" />
                          </button>
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
                  icon, label, count, expenses, income,
                  colorClass, bgClass,
                }: {
                  icon: React.ReactNode;
                  label: string;
                  count: number;
                  expenses: number;
                  income: number;
                  colorClass: string;
                  bgClass: string;
                }) => (
                  <tr>
                    <td colSpan={COL_COUNT} className={`border-b px-3 py-2 ${bgClass}`}>
                      <div className={`flex items-center gap-2 text-xs font-semibold ${colorClass}`}>
                        {icon}
                        <span>{label}</span>
                        <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[11px] font-medium opacity-80">{count}</span>
                        <span className="ms-auto flex gap-4 tabular-nums font-normal">
                          {expenses > 0 && <span>הוצאות: <strong className="font-semibold">{formatIls(expenses, { decimals: false })}</strong></span>}
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
                            ? `מחודש קודם — חויב ב-${cycleDateLabel}`
                            : `מחודש קודם — אותו חיוב (${cycleDateLabel})`}
                          count={carryOver.length}
                          expenses={sumExpenses(carryOver)}
                          income={sumIncome(carryOver)}
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
                            ? `חויב ב-${cycleDateLabel} · ימים 1–10`
                            : `יחויב ב-${cycleDateLabel} · ימים 1–10`}
                          count={currentCycle.length}
                          expenses={sumExpenses(currentCycle)}
                          income={sumIncome(currentCycle)}
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
                          label={`חיוב הבא — ${nextCycleDateLabel} · ימים 11+`}
                          count={nextCycle.length}
                          expenses={sumExpenses(nextCycle)}
                          income={sumIncome(nextCycle)}
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
    </>
  );
}
