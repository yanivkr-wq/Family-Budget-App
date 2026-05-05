'use client';

import { useState, useTransition } from 'react';
import {
  Pencil, Trash2, Plus, CheckCircle2, XCircle, Clock,
  ChevronRight, ChevronsUpDown, ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIls } from '@fba/shared';
import {
  deleteInstallmentPlan,
  bulkDeleteInstallmentPlans,
  bulkUpdateStatus,
  advancePayment,
} from './actions';
import { InstallmentModal, type InstallmentPlanRow } from './installment-modal';

// ─────────────────────────────────────────────────────────────────────────────

interface Account { id: string; name: string }

interface PlanWithMeta extends InstallmentPlanRow {
  accountName:   string | null;
  txCount:       number;
}

interface Props {
  plans:    PlanWithMeta[];
  accounts: Account[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active:    'פעיל',
  complete:  'הושלם',
  cancelled: 'בוטל',
};

function StatusBadge({ status }: { status: string }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';
  if (status === 'active')    return <span className={cn(base, 'bg-primary/10 text-primary')}><Clock className="size-3" />{STATUS_LABEL.active}</span>;
  if (status === 'complete')  return <span className={cn(base, 'bg-success/10 text-success')}><CheckCircle2 className="size-3" />{STATUS_LABEL.complete}</span>;
  return <span className={cn(base, 'bg-muted text-muted-foreground')}><XCircle className="size-3" />{STATUS_LABEL.cancelled}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress bar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.min(100, Math.round(((current - 1) / total) * 100));
  return (
    <div className="flex items-center gap-2 min-w-[6rem]">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {current}/{total}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Month formatter (YYYY-MM → Hebrew)
// ─────────────────────────────────────────────────────────────────────────────

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function fmtMonth(ym: string | null) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return `${HE_MONTHS[(m ?? 1) - 1]} ${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort types
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = 'merchant' | 'amount' | 'remaining' | 'endMonth' | 'status';

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function InstallmentsList({ plans: initialPlans, accounts }: Props) {
  const [plans]                          = useState(initialPlans);
  const [selected, setSelected]          = useState<Set<string>>(new Set());
  const [editPlan, setEditPlan]          = useState<PlanWithMeta | null>(null);
  const [showAdd,  setShowAdd]           = useState(false);
  const [bulkStatus, setBulkStatus]      = useState('');
  const [filterStatus, setFilterStatus]  = useState<string>('all');
  const [sortKey,  setSortKey]           = useState<SortKey>('status');
  const [sortAsc,  setSortAsc]           = useState(true);
  const [isPending, startTransition]     = useTransition();

  // ── Derived ────────────────────────────────────────────────────────────────
  const visible = plans
    .filter((p) => filterStatus === 'all' || p.status === filterStatus)
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'merchant') cmp = (a.description ?? a.merchantNormalized).localeCompare(b.description ?? b.merchantNormalized);
      else if (sortKey === 'amount')    cmp = Number(a.paymentAmountIls) - Number(b.paymentAmountIls);
      else if (sortKey === 'status')    cmp = (a.status ?? '').localeCompare(b.status ?? '');
      else if (sortKey === 'endMonth')  cmp = (a.projectedEndMonth ?? '9999').localeCompare(b.projectedEndMonth ?? '9999');
      else if (sortKey === 'remaining') {
        const remA = a.totalPayments ? a.totalPayments - a.currentPaymentNo + 1 : 999;
        const remB = b.totalPayments ? b.totalPayments - b.currentPaymentNo + 1 : 999;
        cmp = remA - remB;
      }
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="size-3 text-muted-foreground/50" />;
    return <ChevronsUpDown className={cn('size-3 text-primary', !sortAsc && 'rotate-180')} />;
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visible.map((p) => p.id)) : new Set());
  }
  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  }

  // ── Delete one ────────────────────────────────────────────────────────────
  function handleDelete(id: string, name: string) {
    if (!confirm(`למחוק את תוכנית "${name}"? התנועות המשויכות לא יימחקו.`)) return;
    startTransition(async () => { await deleteInstallmentPlan(id); });
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────
  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`למחוק ${selected.size} תוכניות? התנועות המשויכות לא יימחקו.`)) return;
    const fd = new FormData();
    Array.from(selected).forEach((id) => fd.append('ids', id));
    startTransition(async () => { await bulkDeleteInstallmentPlans(fd); setSelected(new Set()); });
  }

  // ── Bulk status ───────────────────────────────────────────────────────────
  function handleBulkStatus() {
    if (!bulkStatus || selected.size === 0) return;
    const fd = new FormData();
    Array.from(selected).forEach((id) => fd.append('ids', id));
    fd.set('status', bulkStatus);
    startTransition(async () => { await bulkUpdateStatus(fd); setSelected(new Set()); setBulkStatus(''); });
  }

  // ── Advance payment ───────────────────────────────────────────────────────
  function handleAdvance(id: string, current: number, total: number | null) {
    if (total && current >= total) return;
    if (!confirm(`לסמן תשלום ${current + 1} כבוצע?`)) return;
    startTransition(async () => { await advancePayment(id); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm">
          {(['all', 'active', 'complete', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); setSelected(new Set()); }}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                filterStatus === s
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {s === 'all' ? 'הכל' : STATUS_LABEL[s]}
              {s !== 'all' && (
                <span className="ms-1.5 tabular-nums opacity-60">
                  ({plans.filter((p) => p.status === s).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Add button */}
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          תוכנית חדשה
        </button>
      </div>

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm shadow-sm">
          <span className="font-semibold text-primary min-w-fit">נבחרו {selected.size} תוכניות</span>
          <div className="flex items-center gap-1">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="">שנה סטטוס...</option>
              <option value="active">פעיל</option>
              <option value="complete">הושלם</option>
              <option value="cancelled">בוטל</option>
            </select>
            <button
              onClick={handleBulkStatus}
              disabled={!bulkStatus || isPending}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
            >
              החל
            </button>
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            מחק נבחרים
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ms-auto text-xs text-muted-foreground hover:underline"
          >
            ביטול בחירה
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {visible.length === 0 && (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {filterStatus === 'all' ? 'אין תוכניות תשלום עדיין' : `אין תוכניות ${STATUS_LABEL[filterStatus]}`}
          </p>
          {filterStatus === 'all' && (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-3.5" />
              הוסף תוכנית ראשונה
            </button>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {visible.length > 0 && (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((p) => selected.has(p.id))}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="בחר הכל"
                  />
                </th>
                <th className="border-b px-3 py-2">
                  <button className="flex items-center gap-1 font-medium hover:text-primary" onClick={() => toggleSort('merchant')}>
                    בית עסק <SortIcon col="merchant" />
                  </button>
                </th>
                <th className="border-b px-3 py-2">
                  <button className="flex items-center gap-1 font-medium hover:text-primary" onClick={() => toggleSort('amount')}>
                    סכום חודשי <SortIcon col="amount" />
                  </button>
                </th>
                <th className="border-b px-3 py-2 font-medium">התקדמות</th>
                <th className="border-b px-3 py-2">
                  <button className="flex items-center gap-1 font-medium hover:text-primary" onClick={() => toggleSort('remaining')}>
                    נותר <SortIcon col="remaining" />
                  </button>
                </th>
                <th className="border-b px-3 py-2">
                  <button className="flex items-center gap-1 font-medium hover:text-primary" onClick={() => toggleSort('endMonth')}>
                    צפי סיום <SortIcon col="endMonth" />
                  </button>
                </th>
                <th className="border-b px-3 py-2 font-medium">חשבון</th>
                <th className="border-b px-3 py-2">
                  <button className="flex items-center gap-1 font-medium hover:text-primary" onClick={() => toggleSort('status')}>
                    סטטוס <SortIcon col="status" />
                  </button>
                </th>
                <th className="border-b px-3 py-2 font-medium w-8" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const remaining = p.totalPayments
                  ? Math.max(0, p.totalPayments - p.currentPaymentNo + 1)
                  : null;
                const totalLeft = remaining !== null
                  ? remaining * Math.abs(Number(p.paymentAmountIls))
                  : null;
                const isComplete = p.status !== 'active';
                const isSelected = selected.has(p.id);
                const displayName = p.description ?? p.merchantNormalized;

                return (
                  <tr
                    key={p.id}
                    className={cn(
                      'border-b last:border-0 transition-colors hover:bg-accent/30',
                      isSelected && 'bg-primary/5',
                      isComplete && 'opacity-70',
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-2 py-3 align-middle">
                      <input type="checkbox" checked={isSelected} onChange={(e) => toggleOne(p.id, e.target.checked)} />
                    </td>

                    {/* Merchant */}
                    <td className="px-3 py-3 align-middle">
                      <div className="font-medium">{displayName}</div>
                      {p.notes && <div className="text-[11px] text-muted-foreground mt-0.5">{p.notes}</div>}
                      {p.txCount > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {p.txCount} תנועה{p.txCount !== 1 ? 'ות' : ''} משויכת
                        </div>
                      )}
                    </td>

                    {/* Monthly amount */}
                    <td className="px-3 py-3 align-middle tabular-nums font-semibold">
                      {formatIls(Math.abs(Number(p.paymentAmountIls)), { decimals: false })}
                    </td>

                    {/* Progress */}
                    <td className="px-3 py-3 align-middle min-w-[8rem]">
                      {p.totalPayments ? (
                        <ProgressBar current={p.currentPaymentNo} total={p.totalPayments} />
                      ) : (
                        <span className="tabular-nums text-muted-foreground text-xs">
                          תשלום {p.currentPaymentNo}
                        </span>
                      )}
                    </td>

                    {/* Remaining */}
                    <td className="px-3 py-3 align-middle">
                      {totalLeft !== null ? (
                        <div>
                          <div className="tabular-nums font-medium text-xs">
                            {formatIls(totalLeft, { decimals: false })}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {remaining} תשלומים
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* Projected end */}
                    <td className="px-3 py-3 align-middle text-xs text-muted-foreground">
                      {fmtMonth(p.projectedEndMonth ?? p.actualEndMonth ?? null)}
                    </td>

                    {/* Account */}
                    <td className="px-3 py-3 align-middle text-xs text-muted-foreground">
                      {p.accountName ?? '—'}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3 align-middle">
                      <StatusBadge status={p.status} />
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-0.5">
                        {/* Advance payment button — only for active with known total */}
                        {p.status === 'active' && p.totalPayments && p.currentPaymentNo < p.totalPayments && (
                          <button
                            onClick={() => handleAdvance(p.id, p.currentPaymentNo, p.totalPayments)}
                            disabled={isPending}
                            className="rounded-md p-1.5 text-success hover:bg-success/10 disabled:opacity-40"
                            title={`סמן תשלום ${p.currentPaymentNo + 1} כבוצע`}
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditPlan(p)}
                          className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                          title="ערוך"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id, displayName)}
                          disabled={isPending}
                          className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          title="מחק"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ── */}
      {showAdd && (
        <InstallmentModal accounts={accounts} onClose={() => setShowAdd(false)} />
      )}
      {editPlan && (
        <InstallmentModal plan={editPlan} accounts={accounts} onClose={() => setEditPlan(null)} />
      )}
    </>
  );
}
