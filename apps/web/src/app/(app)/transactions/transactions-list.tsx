'use client';

import { useEffect, useState, useTransition, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatIls } from '@fba/shared';
import { Sparkles, Trash2, Pencil, Zap, Clock, CalendarClock, CreditCard, Settings2, Repeat, Briefcase, Bell, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RuleModal } from './rule-modal';
import { EditTransactionModal } from './edit-modal';
import { RecurringModal, type RecurringPrefill } from '../recurring/recurring-modal';
import { InstallmentModal, type InstallmentPrefill } from '../installments/installment-modal';
import { NotificationModal, type NotificationModalSeed, type NotificationContactLite } from '../notifications/notification-modal';
import { TransactionsFilter, emptyFilter, isFilterActive, type FilterState } from './transactions-filter';
import { bulkDeleteTransactions, bulkApplyRule, bulkSetCategory } from './rule-actions';
import { deleteTransaction } from './actions';
import { AssignToProjectMenu, type ProjectOption } from './assign-to-project-menu';
import {
  ColumnsCustomizer,
  ColumnResizeHandle,
  buildComparator,
  useColumnPrefs,
  type CellContext,
  type ColumnId,
  type SortState,
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
  /** 'user' = manually created, 'llm_confirmed' = AI-created at import,
   *  'pending' = AI suggestion not yet confirmed. Drives the badge color. */
  ruleSource?: string | null;
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
  /** Forex original amount + currency (when set, the row was a non-NIS
   *  purchase that the bank converted to ILS). Surfaces a "$ 20.00" pill
   *  next to the merchant name. */
  originalAmount?:   number | null;
  originalCurrency?: string | null;
  /** Cross-account transfer pair link — when set, this row matches another
   *  row in a different account; both are excluded from cash-flow totals. */
  transferPairId?: string | null;
  /** Provenance for the source-column tooltip. */
  importFilename?:  string | null;
  importCreatedAt?: string | null;
  /** True when this row is a SYNTHESIZED projected installment payment
   *  (no real transaction yet, generated from the active plan's schedule).
   *  Renders with reduced opacity + a "צפוי" badge so the user can tell
   *  it apart from real charges. */
  isProjected?: boolean;
  /** Project this transaction belongs to (e.g., "construction"). When
   *  set, the per-row briefcase button shows the active project name and
   *  offers a "remove tag" action. Rows with project tags are usually
   *  hidden from this view via the server-side excludeFromMonthlyTotals
   *  filter, but they may still appear if the project opted into monthly
   *  totals. */
  projectId?: string | null;
  /** Cross-account transfer flag — when true, excluded from combined-view
   *  income/expense totals. Surfaced to the edit modal so the toggle
   *  reflects the saved state. */
  isTransfer?: boolean;
  /** Per-row override that brings a project-tagged row back into monthly
   *  totals (capex/opex split). Surfaced to the edit modal so the toggle
   *  reflects the saved state and so we can show a "📅 גם חודשי" badge. */
  includeInMonthlyOverride?: boolean;
  /** Accounting-noise flag — row is visible but excluded from EVERY sum
   *  (monthly totals, project totals, insights). Used by settlement-basis
   *  CC accounting + manual flagging via the project-menu toggle. */
  excludedFromTotals?: boolean;
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
  /** Active + paused projects for the per-row "assign to project" button +
   *  the bulk-action assign menu. Empty array hides the project UI. */
  projects: ProjectOption[];
  billingMonth: string;        // calendar month, e.g. "2026-05"
  cycleChargeDate: string;     // current cycle charge date, e.g. "2026-05-10"
  nextCycleChargeDate: string; // next cycle charge date, e.g. "2026-06-10"
  nextMonth: string;           // next calendar month, e.g. "2026-06"
  /**
   * Transaction IDs that already have at least one (non-completed,
   * non-cancelled) notification task attached. Drives the colored bell
   * icon on each row so the user can see at a glance which txns already
   * have a reminder set up. Comes through as an array (server → client
   * payloads can't be Sets) and gets converted to a Set client-side.
   */
  txnIdsWithNotifications: string[];
  /** Household notification contacts for the per-row "set reminder" modal. */
  notificationContacts: NotificationContactLite[];
  /** Page-level toggles slot — rendered at the end of the filter row. Keeps
   *  the page header clean and groups all list-affecting controls together. */
  filterExtraControls?: React.ReactNode;
}) {
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [ruleModalForId, setRuleModalForId] = useState<string | null>(null);
  const [editTxnId, setEditTxnId]       = useState<string | null>(null);
  // Project assignment popover state. `targetIds` = which transactions
  // the menu acts on (single row or current bulk selection).
  // `triggerRect` is the bounding rect of the button that opened it —
  // the menu uses this to position itself with viewport-edge clamping.
  const [projectMenu, setProjectMenu] = useState<{
    targetIds:   string[];
    triggerRect: DOMRect;
  } | null>(null);

  // Deep-link support: ?highlight=<txnId> (used by the global command
  // palette) scrolls the matched row into view + flashes it amber so the
  // user can spot it. Clears after 3 seconds.
  const searchParams = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const hl = searchParams.get('highlight');
    if (!hl) return;
    setHighlightId(hl);
    // Wait one frame so the row has actually rendered before scrolling.
    requestAnimationFrame(() => {
      const el = document.getElementById(`txn-row-${hl}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [searchParams]);
  // Per-row "mark as ..." quick actions: open a pre-filled create modal
  // for either /recurring or /installments using the transaction's data
  // (merchant name, amount, account). Saves the user from navigating
  // away to those pages just to add one entry.
  const [markRecurringPrefill, setMarkRecurringPrefill] = useState<RecurringPrefill | null>(null);
  // Per-row "set reminder" — pre-fills the create-notification modal with
  // this txn's merchant + date + amount so the user can attach a reminder
  // (e.g. "remind me 3 days before this bill recurs").
  const [notifySeed, setNotifySeed] = useState<NotificationModalSeed | null>(null);
  // Which row triggered the notify modal — captured so we can mark that
  // txn as "now has a notification" the moment the modal closes
  // successfully (optimistic UI, no full page reload required).
  const [notifyTxnId, setNotifyTxnId] = useState<string | null>(null);
  // Live set of txn IDs that have at least one notification attached.
  // Initialized from the server-supplied prop on first render; we mutate
  // it when the user creates a new notification from the txn bell so the
  // icon turns colored immediately.
  const [txnsWithNotifications, setTxnsWithNotifications] = useState<Set<string>>(
    () => new Set(props.txnIdsWithNotifications),
  );
  // Re-sync whenever the server prop changes (e.g. after a router refresh
  // or a navigation back to /transactions). useState's initializer only
  // runs on first mount, so we mirror to local state via effect.
  useEffect(() => {
    setTxnsWithNotifications(new Set(props.txnIdsWithNotifications));
  }, [props.txnIdsWithNotifications]);
  const [markInstallmentPrefill, setMarkInstallmentPrefill] = useState<InstallmentPrefill | null>(null);
  // Initialize the filter from URL params so deep-links from /insights
  // cards land on a pre-filtered list.
  // Supported deep-link params:
  //   ?text=foo            → merchant search box
  //   ?categoryId=<uuid>   → category dropdown
  //   ?accountId=<uuid>    → account dropdown
  //   ?dateFrom=YYYY-MM-DD → date range start
  //   ?dateTo=YYYY-MM-DD   → date range end
  // After mount, the filter is purely client-state — URL changes from the
  // user typing in the search box or picking a dropdown DON'T re-sync.
  // (We could keep them in sync but it adds noise to the URL.)
  const [filter, setFilter] = useState<FilterState>(() => {
    if (typeof window === 'undefined') return emptyFilter;
    const sp = new URLSearchParams(window.location.search);
    return {
      text:       sp.get('text')       ?? emptyFilter.text,
      categoryId: sp.get('categoryId') ?? emptyFilter.categoryId,
      accountId:  sp.get('accountId')  ?? emptyFilter.accountId,
      sign:       (sp.get('sign')       as FilterState['sign']) ?? emptyFilter.sign,
      flag:       (sp.get('flag')       as FilterState['flag']) ?? emptyFilter.flag,
      dateFrom:   sp.get('dateFrom')   ?? emptyFilter.dateFrom,
      dateTo:     sp.get('dateTo')     ?? emptyFilter.dateTo,
    };
  });
  // Re-sync filter from URL when searchParams change WITHOUT a remount —
  // happens when the user clicks an /insights drill-down from another
  // /transactions tab/window or uses browser back/forward. The useState
  // initializer only fires on first mount so without this, the filter
  // would stick at the original deep-link values.
  useEffect(() => {
    // Only resync when there's at least one filter-shaped param in the URL,
    // otherwise we'd wipe the filter every time the user opens a row's
    // edit modal (which mutates other URL state).
    const hasFilterParam = ['text','categoryId','accountId','sign','flag','dateFrom','dateTo']
      .some((k) => searchParams.get(k) !== null);
    if (!hasFilterParam) return;
    setFilter({
      text:       searchParams.get('text')       ?? emptyFilter.text,
      categoryId: searchParams.get('categoryId') ?? emptyFilter.categoryId,
      accountId:  searchParams.get('accountId')  ?? emptyFilter.accountId,
      sign:       (searchParams.get('sign')       as FilterState['sign']) ?? emptyFilter.sign,
      flag:       (searchParams.get('flag')       as FilterState['flag']) ?? emptyFilter.flag,
      dateFrom:   searchParams.get('dateFrom')   ?? emptyFilter.dateFrom,
      dateTo:     searchParams.get('dateTo')     ?? emptyFilter.dateTo,
    });
  }, [searchParams]);
  const [bulkCatId, setBulkCatId]       = useState('');
  const [bulkRuleId, setBulkRuleId]     = useState('');
  const [isPending, startTransition]    = useTransition();
  const [columnsOpen, setColumnsOpen]   = useState(false);

  // Customizable columns — user can show/hide and reorder via the
  // "Columns" button. Persisted to localStorage. The leading checkbox
  // and trailing actions cells are NOT customizable; they're always-on
  // bookends rendered explicitly below.
  const { prefs: colPrefs, visibleColumns, setOrder: setColOrder, setVisible: setColVisible, setWidth: setColWidth, reset: resetCols } = useColumnPrefs();

  // Sort state for the table headers. Tri-state per column:
  //   1st click on a fresh column → asc
  //   2nd click (same column)     → desc
  //   3rd click (same column)     → off (back to natural date-desc order)
  // Sort applies WITHIN each section (immediate / current cycle / etc.)
  // — sections themselves stay grouped, which preserves the dashboard's
  // mental model of "this row is in this billing cycle".
  const [sort, setSort] = useState<SortState>({ columnId: null, dir: 'desc' });
  function onHeaderClick(id: ColumnId) {
    setSort((prev) => {
      if (prev.columnId !== id)         return { columnId: id, dir: 'asc' };
      if (prev.dir === 'asc')           return { columnId: id, dir: 'desc' };
      return { columnId: null, dir: 'desc' }; // off
    });
  }

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
      if (filter.categoryId === 'none') {
        if (t.categoryId != null) return false;
      } else if (filter.categoryId && t.categoryId !== filter.categoryId) {
        return false;
      }
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
        extraControls={props.filterExtraControls}
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
          {/* Bulk assign-to-project — opens the project menu anchored to
              the trigger button, acts on every selected row. The menu's
              "remove tag" footer appears whenever ≥1 of the selected
              rows currently has a project tag. */}
          {props.projects.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                setProjectMenu({
                  targetIds:   Array.from(selected),
                  triggerRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                });
              }}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md bg-accent/30 px-2 py-1 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40"
              title="תייג את הנבחרים לפרויקט"
            >
              <Briefcase className="size-3.5" />תייג לפרויקט
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="ms-auto text-xs text-muted-foreground hover:underline">ביטול בחירה</button>
        </div>
      )}

      {props.transactions.length > 0 && (
        // The section is a TWO-AXIS scroll container:
        //   • overflow-x-auto → horizontal scroll for wide tables (gives the
        //     sticky END actions column something to anchor against)
        //   • overflow-y-auto + max-height → vertical scroll INSIDE the
        //     table area (gives the sticky top thead something to engage
        //     against). max-h is calc'd from viewport so the table grows
        //     to fill remaining space below the toolbar but never spills
        //     past the bottom of the screen.
        // Net effect: headers stay pinned at top while you scroll rows;
        // actions column stays pinned at leading edge while you scroll wide
        // tables. Same UX as Excel/Google Sheets.
        <section className="rounded-lg border bg-card overflow-auto max-h-[calc(100vh-15rem)]">
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
                  const sortable  = !!col.sortAccessor;
                  const isSorted  = sort.columnId === col.id;
                  // Pick the right indicator icon:
                  //   active asc  → ▲
                  //   active desc → ▼
                  //   sortable    → ⇅ (faint, visible on hover)
                  //   not sortable→ no icon
                  const SortIcon = !sortable ? null
                    : isSorted ? (sort.dir === 'asc' ? ChevronUp : ChevronDown)
                    : ChevronsUpDown;
                  return (
                    <th
                      key={col.id}
                      className={cn(col.headClass, 'relative', sortable && 'group cursor-pointer select-none hover:bg-muted/60 transition-colors')}
                      style={userWidth ? { width: `${userWidth}px`, minWidth: `${userWidth}px`, maxWidth: `${userWidth}px` } : undefined}
                      onClick={sortable ? () => onHeaderClick(col.id) : undefined}
                      title={sortable ? `מיון לפי ${col.label} (לחץ שוב לשינוי כיוון)` : undefined}
                      aria-sort={isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {SortIcon && (
                          <SortIcon
                            className={cn(
                              'size-3',
                              isSorted ? 'text-accent' : 'text-muted-foreground/40 group-hover:text-muted-foreground/80',
                            )}
                            aria-hidden
                          />
                        )}
                      </span>
                      <ColumnResizeHandle
                        onWidthChange={(next) => setColWidth(col.id, next)}
                        onReset={() => setColWidth(col.id, null)}
                      />
                    </th>
                  );
                })}
                {/* Action column header — also hosts the "עמודות" button so
                    the customizer is always reachable from the table chrome
                    itself, not from a separate toolbar above.
                    STICKY in the END direction (= visual-left in RTL) so
                    horizontal-scrolling content slides UNDER it instead of
                    overlapping. z-30 puts it above the sticky thead row's
                    z-20. Solid bg-card + a leading shadow visually pin it. */}
                <th className="sticky end-0 z-30 border-b border-s bg-muted/95 backdrop-blur px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
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

                // ── Split: immediate vs credit-card billing cycle ─────────
                // A row counts as IMMEDIATE when:
                //   • the account is a bank (every txn is debited the day
                //     it happens), OR
                //   • the row is a forex purchase on a CC (Israeli CC
                //     issuers settle non-NIS charges to the linked bank
                //     account immediately, NOT in the monthly cycle).
                // Both cases get grouped into the "חיובים מיידיים" header
                // so the user sees them on the day money actually moves.
                const isImmediateTx = (t: Transaction) => {
                  if (accMap.get(t.accountId)?.type === 'bank') return true;
                  if (!!t.originalCurrency && t.originalCurrency !== 'ILS') return true;
                  return false;
                };

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

                // ── Build the CellContext for sorting / rendering ─────────
                // Same derivation as inside renderRow below, extracted so the
                // sort comparator can use it without re-implementing the
                // categorization-source logic.
                const buildCellCtx = (t: Transaction, groupChargeDate: string): CellContext => {
                  const cat    = t.categoryId    ? catMap.get(t.categoryId)    : null;
                  const subCat = t.subCategoryId ? catMap.get(t.subCategoryId) : null;
                  const acc    = accMap.get(t.accountId);
                  const isImmediateRow = acc?.type === 'bank';
                  const effectiveChargeDate = isImmediateRow ? null : (t.chargeDate ?? groupChargeDate);
                  const isPendingCharge     = !isImmediateRow && !!effectiveChargeDate && effectiveChargeDate > todayStr;
                  const chargeDateDiffersFromGroup =
                    !isImmediateRow && !!t.chargeDate && t.chargeDate !== groupChargeDate;
                  const isAutoRule        = t.categorySource === 'rule' && t.ruleSource === 'user';
                  const isBankHint        = t.categorySource === 'bank_hint';
                  const isMerchantKeyword = t.categorySource === 'merchant_keyword';
                  const isTaggedExport    = t.categorySource === 'tagged_export';
                  const isLlm             = t.categorySource === 'llm'
                                          || (t.categorySource === 'rule' && t.ruleSource === 'llm_confirmed');
                  const txIsManual        = t.isManual !== false;
                  const isInstallment     = !!t.installmentPlanId;
                  return {
                    t,
                    cat:    cat    ?? null,
                    subCat: subCat ?? null,
                    acc:    acc    ?? null,
                    isInstallment, isAutoRule, isBankHint, isMerchantKeyword,
                    isTaggedExport, isLlm, txIsManual,
                    chargeDateDiffersFromGroup, isPendingCharge, effectiveChargeDate,
                  };
                };

                // Apply the active sort to a single group's rows. Sort acts
                // WITHIN each group — the immediate / current-cycle / etc.
                // grouping itself is preserved. Returns the original array
                // unchanged when no sort is active.
                const comparator = buildComparator(sort);
                const sortedSlice = (rows: Transaction[], groupChargeDate: string): Transaction[] => {
                  if (!comparator) return rows;
                  // Decorate-sort-undecorate: build CellContext once per row
                  // for the comparator, sort the decorated array, then map
                  // back to bare transactions.
                  return rows
                    .map((t) => ({ t, ctx: buildCellCtx(t, groupChargeDate) }))
                    .sort((a, b) => comparator(a.ctx, b.ctx))
                    .map((d) => d.t);
                };

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

                  // Source-of-categorization derivation:
                  //   • isAutoRule       — a USER-created rule fired (blue "כלל" badge)
                  //   • isLlm            — AI involvement, either via direct
                  //                        Pass-7 categorization (categorySource='llm')
                  //                        OR via an AI-created rule firing on a
                  //                        later import (rule.source='llm_confirmed').
                  //                        Both show purple "AI" badge.
                  // This way the user sees blue ONLY for rules they wrote
                  // themselves, and purple for everything AI touched.
                  const isAutoRule        = t.categorySource === 'rule' && t.ruleSource === 'user';
                  const isBankHint        = t.categorySource === 'bank_hint';
                  const isMerchantKeyword = t.categorySource === 'merchant_keyword';
                  const isTaggedExport    = t.categorySource === 'tagged_export';
                  const isLlm             = t.categorySource === 'llm'
                                          || (t.categorySource === 'rule' && t.ruleSource === 'llm_confirmed');
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
                      id={`txn-row-${t.id}`}
                      className={cn(
                        'border-b last:border-0 transition-colors hover:bg-accent/30',
                        isSelected && 'bg-primary-soft/40',
                        // Right-border accent (= visual start in RTL) marks
                        // installment-linked rows so they stand out at a glance
                        // without changing the row layout.
                        isInstallment && 'border-r-2 border-r-primary/60',
                        // Projected installment payments (no actual transaction
                        // imported yet) — render with reduced opacity + diagonal
                        // dashed background so they're clearly distinguishable
                        // from real charges.
                        t.isProjected && 'opacity-60 italic bg-muted/20',
                        // Warning-tone flash when arriving via ?highlight=<id>
                        // from the global command palette. Clears after 3
                        // seconds. Tokenized (brand book §1).
                        highlightId === t.id && '!bg-warning-soft ring-2 ring-warning',
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

                      {/* Action buttons (always-on bookend) — STICKY in
                          end direction so horizontal scroll slides table
                          cells UNDER instead of overlapping the controls.
                          Solid bg + leading shadow matches the sticky
                          header's visual treatment. */}
                      <td className="sticky end-0 z-10 border-s bg-card align-middle px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
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
                          {/* Assign to project — anchors a floating menu
                              listing all active/paused projects + a
                              "remove tag" footer when the row already
                              has a tag. Tinted active when the row is
                              currently tagged so the user can spot
                              project-tagged rows at a glance. */}
                          {props.projects.length > 0 && !t.isProjected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                setProjectMenu({
                                  targetIds:   [t.id],
                                  triggerRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                });
                              }}
                              className={cn(
                                'rounded-md p-1.5 hover:bg-accent/40',
                                t.projectId
                                  ? 'text-primary bg-primary-soft'
                                  : 'text-foreground/60 hover:text-foreground',
                              )}
                              title={t.projectId ? 'משויך לפרויקט — לחץ לשינוי' : 'תייג לפרויקט'}
                              aria-label="תייג לפרויקט"
                            >
                              <Briefcase className="size-3.5" />
                            </button>
                          )}
                          {/* Quick "set reminder" — opens the notification
                              modal pre-filled with merchant/amount/date so
                              the user can attach a reminder for this txn or
                              its next occurrence. The bell turns SOLID
                              accent-colored once the txn has at least one
                              non-completed notification attached, so the
                              user can see at a glance which rows are
                              already covered. */}
                          {(() => {
                            const hasNotif = txnsWithNotifications.has(t.id);
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setNotifyTxnId(t.id);
                                  setNotifySeed({
                                    title:              `${t.merchant} · ${formatIls(Math.abs(t.amount), { decimals: false })}`,
                                    description:        t.notes ?? null,
                                    dueDate:            t.date,
                                    status:             'active',
                                    recurrence:         'none',
                                    categoryId:         t.categoryId,
                                    transactionId:      t.id,
                                    recurringPatternId: null,
                                    reminders: [
                                      { offsetDays: 7, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, enabled: true },
                                      { offsetDays: 1, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, enabled: true },
                                    ],
                                  });
                                }}
                                className={cn(
                                  'rounded-md p-1.5',
                                  hasNotif
                                    // Active: filled accent background +
                                    // accent foreground so it pops against
                                    // the row.
                                    ? 'bg-accent/15 text-accent hover:bg-accent/25'
                                    // Inactive: faded foreground until hover.
                                    : 'text-foreground/60 hover:text-accent hover:bg-accent/10',
                                )}
                                title={hasNotif
                                  ? 'תזכורת קיימת — לחץ לעריכה / הוספה'
                                  : 'הגדר תזכורת לתנועה זו'}
                                aria-label="הגדר תזכורת"
                                aria-pressed={hasNotif}
                              >
                                <Bell
                                  className={cn(
                                    'size-3.5',
                                    // Filled style for the active state —
                                    // the lucide Bell uses currentColor for
                                    // both stroke and fill, so applying
                                    // fill-current makes the icon look
                                    // solid rather than outlined.
                                    hasNotif && 'fill-current',
                                  )}
                                />
                              </button>
                            );
                          })()}
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
                    {/* ══ GROUP 0: Immediate — bank direct + forex CC charges ══
                         Bank rows always belong here. Forex CC charges
                         (originalCurrency != ILS) also belong because
                         Israeli CC issuers settle them immediately to
                         the linked bank account, NOT in the monthly
                         cycle. */}
                    {immediateTxns.length > 0 && (
                      <>
                        <SectionHeader
                          icon={<Zap className="size-3.5 shrink-0" />}
                          label="חיובים מיידיים — בנק / מט״ח / הוראות קבע"
                          count={immediateTxns.length}
                          expenses={sumExpenses(immediateTxns)}
                          income={sumIncome(immediateTxns)}
                          installments={sumInstallments(immediateTxns)}
                          recurring={sumRecurring(immediateTxns)}
                          colorClass="text-success"
                          bgClass="bg-success/5 border-success/20"
                        />
                        {/* Pass each row's own date as group date for immediate rows
                            since they're not part of a CC cycle. */}
                        {sortedSlice(immediateTxns, props.cycleChargeDate).map((t) => renderRow(t, t.date))}
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
                          colorClass="text-warning"
                          bgClass="bg-warning-soft border-warning/20"
                        />
                        {sortedSlice(carryOver, props.cycleChargeDate).map((t) => renderRow(t, props.cycleChargeDate))}
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
                          colorClass={isCycleCharged ? 'text-success' : 'text-warning'}
                          bgClass={isCycleCharged ? 'bg-success-soft border-success/20' : 'bg-warning-soft border-warning/20'}
                        />
                        {sortedSlice(currentCycle, props.cycleChargeDate).map((t) => renderRow(t, props.cycleChargeDate))}
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
                          colorClass="text-accent"
                          bgClass="bg-accent-soft border-accent/20"
                        />
                        {sortedSlice(nextCycle, props.nextCycleChargeDate).map((t) => renderRow(t, props.nextCycleChargeDate))}
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

      {/* Per-row "set reminder" — opens the notification create modal seeded
          with the txn's data and linked back to the txn id. The full
          /notifications page lists everything created here. */}
      {notifySeed && (
        <NotificationModal
          seed={notifySeed}
          categories={props.categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          contacts={props.notificationContacts}
          // The modal expects a recent-transactions list for its dropdown.
          // Hand it the txn we're attaching to so the dropdown isn't empty
          // when launched from this surface.
          recentTransactions={props.transactions
            .slice(0, 100)
            .map((t) => ({ id: t.id, merchant: t.merchant, amount: t.amount, date: t.date }))}
          onSaved={() => {
            // Optimistic UI: mark the row's bell as "active" the moment
            // the save returns OK, so the user sees the colored bell on
            // the same row they just acted on. The next page revalidate
            // (revalidatePath('/notifications') was called server-side)
            // confirms it on next nav.
            if (notifyTxnId) {
              setTxnsWithNotifications((prev) => {
                const next = new Set(prev);
                next.add(notifyTxnId);
                return next;
              });
            }
          }}
          onClose={() => {
            setNotifySeed(null);
            setNotifyTxnId(null);
          }}
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

      {/* Floating project-assignment menu — opened by per-row briefcase
          button or the bulk-action "תייג לפרויקט" button. The menu owns
          its own outside-click + Esc close behaviour. After a successful
          assignment it clears bulk selection if it was a bulk action. */}
      {projectMenu && (() => {
        // Single-row case: read the row's current flag state so the toggles
        // start in the right position. Bulk case: leave undefined → toggles
        // start unchecked, user click applies the same value to every selected
        // row.
        const singleRow = projectMenu.targetIds.length === 1
          ? props.transactions.find((t) => t.id === projectMenu.targetIds[0])
          : undefined;
        return (
          <AssignToProjectMenu
            projects={props.projects}
            transactionIds={projectMenu.targetIds}
            showRemove={projectMenu.targetIds.some(
              (id) => !!props.transactions.find((t) => t.id === id)?.projectId,
            )}
            triggerRect={projectMenu.triggerRect}
            initialFlags={singleRow ? {
              isTransfer:               singleRow.isTransfer,
              excludedFromTotals:       singleRow.excludedFromTotals,
              includeInMonthlyOverride: singleRow.includeInMonthlyOverride,
            } : undefined}
            rowHasProject={singleRow ? !!singleRow.projectId : projectMenu.targetIds.some(
              (id) => !!props.transactions.find((t) => t.id === id)?.projectId,
            )}
            onClose={() => setProjectMenu(null)}
            onDone={() => {
              // If this was a bulk action, clear the selection so the user
              // gets visual confirmation that the action consumed it.
              if (projectMenu.targetIds.length > 1) setSelected(new Set());
            }}
          />
        );
      })()}
    </>
  );
}
