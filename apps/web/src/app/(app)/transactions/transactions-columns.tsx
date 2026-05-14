'use client';

/**
 * Customizable columns for the transactions table.
 *
 * Architecture:
 *   • COLUMN_DEFS: per-column metadata + render function.
 *   • DEFAULT_ORDER: fallback order when nothing is in localStorage.
 *   • useColumnPrefs(): hook that loads/saves user prefs (visibility +
 *     order) to localStorage.
 *   • ColumnsCustomizer: modal popup with toggle-checkboxes and drag
 *     handles for reordering. Powered by @dnd-kit/sortable.
 *
 * Out of scope (always-on, not customizable): the leading checkbox column
 * and the trailing actions column. Both are bookends rendered explicitly
 * by the table — only the 8 "data" columns in between are customizable.
 *
 * Storage key: "fba.tx-columns.v1". Bump the suffix if the schema changes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CreditCard, GripVertical, Repeat, Sparkles, Upload, User, X, Zap, Clock, Globe2, ArrowLeftRight, UserCheck } from 'lucide-react';
import { formatIls, formatDateHe } from '@fba/shared';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColumnId =
  | 'date'
  | 'merchant'
  | 'flag'
  | 'account'
  | 'source'
  | 'category'
  | 'expense'
  | 'income'
  | 'notes'
  | 'rule';

interface Cat { id: string; nameHe: string; color?: string | null }
interface Account { id: string; name: string; type?: string }

/** Bag of state passed to every cell renderer. Computed once per row by
 *  the table; each column's renderCell picks what it needs. */
export interface CellContext {
  t: {
    id: string;
    date: string;
    chargeDate?: string | null;
    amount: number;
    merchant: string;
    notes: string | null;
    categorySource?: string | null;
    ruleName?: string | null;
    appliedRuleId?: string | null;
    isManual?: boolean;
    installmentPlanId?: string | null;
    installmentCurrentPaymentNo?: number | null;
    installmentTotalPayments?: number | null;
    installmentEndMonth?: string | null;
    recurringPatternId?: string | null;
    recurringPatternFrequency?: string | null;
    /** Original amount in non-NIS currency (null = NIS purchase). */
    originalAmount?: number | null;
    /** ISO currency code of the original amount (USD, EUR, GBP...). */
    originalCurrency?: string | null;
    /** When set, this transaction is the matched half of a cross-account
     *  transfer pair. Renders a small "↔" badge so the user knows the row
     *  cancels with another in the dataset. */
    transferPairId?: string | null;
    /** Source-import provenance — which file produced this row + when.
     *  Surfaced in the "ייבוא" badge tooltip so the user can trace any
     *  imported transaction back to its upload. Both null for manual
     *  entries (which already show the "ידני" badge). */
    importFilename?:  string | null;
    importCreatedAt?: string | null;
    /** Synthesized projected installment payment — no real transaction yet.
     *  Renders a "צפוי" badge so the user knows it's a forecast, not a
     *  recorded charge. */
    isProjected?: boolean;
  };
  cat: Cat | null;
  subCat: Cat | null;
  acc: Account | null;
  isInstallment: boolean;
  isAutoRule: boolean;
  isBankHint: boolean;
  isMerchantKeyword: boolean;
  isTaggedExport: boolean;
  isLlm: boolean;
  txIsManual: boolean;
  chargeDateDiffersFromGroup: boolean;
  isPendingCharge: boolean;
  effectiveChargeDate: string | null;
}

export interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  headClass?: string;
  cellClass?: string;
  renderCell: (ctx: CellContext) => ReactNode;
  /**
   * Returns the value used for sorting this column. Strings are compared
   * via localeCompare (Hebrew-aware), numbers via subtraction, null is
   * always sorted last regardless of direction. Define for every column
   * that should be sortable; columns without a sortAccessor get a non-
   * clickable header.
   */
  sortAccessor?: (ctx: CellContext) => string | number | null;
}

// ─── Column definitions ──────────────────────────────────────────────────────
// These are what the table renders. Add a new column → add an entry here AND
// to DEFAULT_ORDER below. The 8 must stay in sync.

export const COLUMN_DEFS: Record<ColumnId, ColumnDef> = {
  date: {
    id: 'date',
    label: 'תאריך',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top tabular-nums',
    // ISO YYYY-MM-DD strings sort lexicographically = chronologically.
    sortAccessor: ({ t }) => t.date,
    renderCell: ({ t, chargeDateDiffersFromGroup, isPendingCharge, effectiveChargeDate }) => (
      <>
        <div>{formatDateHe(t.date)}</div>
        {chargeDateDiffersFromGroup && isPendingCharge && (
          <div
            className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning"
            title={`חיוב יחיד בתאריך אחר מהקבוצה: ${effectiveChargeDate}`}
          >
            <Clock className="size-2.5 shrink-0" />
            יחויב {formatDateHe(effectiveChargeDate!)}
          </div>
        )}
      </>
    ),
  },

  merchant: {
    id: 'merchant',
    label: 'בית עסק',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    sortAccessor: ({ t }) => t.merchant,
    // Merchant text + small inline badges for cross-cutting concerns:
    //   • forex (original currency + amount)
    //   • cross-account transfer (paired with another row)
    // Both render as compact pills so they don't disrupt skim-ability.
    renderCell: ({ t }) => {
      const isForex = !!t.originalCurrency && t.originalCurrency !== 'ILS';
      const isTransfer = !!t.transferPairId;
      const isProjected = !!t.isProjected;
      if (!isForex && !isTransfer && !isProjected) return <>{t.merchant}</>;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{t.merchant}</span>
          {isProjected && (
            <span
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning"
              title={
                'תחזית של האפליקציה — לא חיוב אמיתי. ' +
                'נוצר אוטומטית מתוך תוכנית התשלומים שמופיעה בעמוד תשלומים. ' +
                'כשתעלה את חיובי החודש הבא, השורה הזו תוחלף בתנועה האמיתית. ' +
                'מטרת התחזית: שתראה את כל ההוצאות הצפויות בקופה החודשית מראש.'
              }
            >
              <Clock className="size-2.5 shrink-0" />
              צפוי
              <span aria-hidden className="ms-0.5 inline-flex size-3 items-center justify-center rounded-full bg-warning/30 text-[8px] font-bold text-warning">i</span>
            </span>
          )}
          {isForex && (
            <span
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title={`עסקה בחו"ל — מקור: ${t.originalAmount?.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.originalCurrency}, חיוב מיידי`}
            >
              <Globe2 className="size-2.5 shrink-0" />
              {t.originalCurrency} {t.originalAmount?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          )}
          {isTransfer && (
            <span
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="העברה בין חשבונות — שורה זו זוּוגה לחיוב נגדי בחשבון אחר"
            >
              <ArrowLeftRight className="size-2.5 shrink-0" />
              העברה
            </span>
          )}
        </div>
      );
    },
  },

  flag: {
    id: 'flag',
    label: 'דגל',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    // Sort priority: installments first (most specific), then recurring,
    // then unmarked. Numeric ordering keeps the categories grouped when
    // sorted asc.
    sortAccessor: ({ t, isInstallment }) =>
      isInstallment ? 0 :
      t.recurringPatternId ? 1 :
      2,
    renderCell: ({ t, isInstallment }) => {
      // Installment + recurring are mutually exclusive — installments take
      // precedence as the more specific signal (they end after N payments).
      const isRecurring = !isInstallment && !!t.recurringPatternId;
      if (isInstallment) {
        // Compact one-line label: "תשלום N/Y · MM/YY". whitespace-nowrap keeps
        // the pill on a single row regardless of the column width.
        const label = t.installmentTotalPayments
          ? `תשלום ${t.installmentCurrentPaymentNo}/${t.installmentTotalPayments}`
          : `תשלום ${t.installmentCurrentPaymentNo}`;
        const endLabel = t.installmentEndMonth
          ? ` · ${t.installmentEndMonth.slice(5, 7)}/${t.installmentEndMonth.slice(2, 4)}`
          : '';
        return (
          <Link
            href="/installments"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15"
            title={t.installmentEndMonth ? `חלק מתוכנית תשלומים — מסתיים ${t.installmentEndMonth}` : 'חלק מתוכנית תשלומים'}
          >
            <CreditCard className="size-2.5 shrink-0" />
            <span>{label}{endLabel}</span>
          </Link>
        );
      }
      if (isRecurring) {
        return (
          <Link
            href="/recurring"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/25"
            title="תואם להוצאה קבועה — פתח את הניהול"
          >
            <Repeat className="size-2.5 shrink-0" />
            <span>קבוע</span>
          </Link>
        );
      }
      return <span className="text-muted-foreground">—</span>;
    },
  },

  account: {
    id: 'account',
    label: 'חשבון',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top text-muted-foreground',
    sortAccessor: ({ acc }) => acc?.name ?? null,
    renderCell: ({ acc }) => <>{acc?.name ?? '—'}</>,
  },

  source: {
    id: 'source',
    label: 'מקור',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-middle',
    // 0 = manual, 1 = imported. Manual usually means user-curated
    // (intentional edits) so it's "more important" — comes first when
    // sorted ascending.
    sortAccessor: ({ txIsManual }) => (txIsManual ? 0 : 1),
    // Imported rows show the import session's filename + date in the
    // hover tooltip so the user can trace each row back to its upload.
    renderCell: ({ txIsManual, t }) => {
      if (txIsManual) {
        return (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="הוזן ידנית">
            <User className="size-2.5" />ידני
          </span>
        );
      }
      // Build a multi-line tooltip with file + date when available.
      let tooltip = 'יובא מקובץ / אוטומטי';
      if (t.importFilename) {
        const dateStr = t.importCreatedAt
          ? new Date(t.importCreatedAt).toLocaleDateString('he-IL', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })
          : '';
        tooltip = `קובץ: ${t.importFilename}${dateStr ? `\nיובא: ${dateStr}` : ''}`;
      }
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent" title={tooltip}>
          <Upload className="size-2.5" />ייבוא
        </span>
      );
    },
  },

  category: {
    id: 'category',
    label: 'קטגוריה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    // Sort by category Hebrew name; uncategorized rows go last
    // (sortAccessor returning null pushes to end regardless of dir).
    sortAccessor: ({ cat }) => cat?.nameHe ?? null,
    // The rule / source badges that used to live here moved to their own
    // 'rule' column at the end of the table. Category column is now just
    // the colored pill + optional sub-category subtitle.
    renderCell: ({ cat, subCat, isAutoRule, isBankHint, isMerchantKeyword, isTaggedExport, isLlm }) => {
      void isAutoRule; void isBankHint; void isMerchantKeyword; void isTaggedExport; void isLlm;
      return cat ? (
        <div className="flex flex-col gap-0.5">
          <span className="pill text-xs whitespace-nowrap" style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}>{cat.nameHe}</span>
          {subCat && <span className="text-[11px] text-muted-foreground">↳ {subCat.nameHe}</span>}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },

  expense: {
    id: 'expense',
    label: 'הוצאה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-foreground/80',
    cellClass: 'px-3 py-2 text-right align-top tabular-nums',
    // Expense column shows abs(amount) when amount < 0. For sorting we
    // want "biggest expense first" when desc, so sort by abs(amount) for
    // expense rows; income rows sort to the end (null).
    sortAccessor: ({ t }) => (t.amount < 0 ? Math.abs(t.amount) : null),
    renderCell: ({ t }) => <>{t.amount < 0 ? formatIls(t.amount) : ''}</>,
  },

  income: {
    id: 'income',
    label: 'הכנסה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-success',
    cellClass: 'px-3 py-2 text-right align-top tabular-nums text-success',
    // Mirror of expense: only positive amounts contribute; expense rows
    // sort to the end via null.
    sortAccessor: ({ t }) => (t.amount >= 0 ? t.amount : null),
    renderCell: ({ t }) => <>{t.amount >= 0 ? formatIls(t.amount) : ''}</>,
  },

  notes: {
    id: 'notes',
    label: 'הערות',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'max-w-xs truncate px-3 py-2 align-top text-muted-foreground',
    sortAccessor: ({ t }) => t.notes ?? null,
    renderCell: ({ t }) => <span title={t.notes ?? ''}>{t.notes}</span>,
  },

  rule: {
    id: 'rule',
    label: 'כלל',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-middle',
    // Sort priority: user rule (most "owned"), tagged export, AI, none.
    sortAccessor: ({ isAutoRule, isTaggedExport, isLlm }) =>
      isAutoRule     ? 0 :
      isTaggedExport ? 1 :
      isLlm          ? 2 :
                       3,
    // Compact source-of-categorization indicator:
    //   • User rule       → clickable "כלל" pill, hover shows rule name,
    //                       click navigates to /admin/rules?edit=<id>
    //   • tagged_export   → "תיוג ידני" pill (file-supplied)
    //   • llm             → "AI" pill
    //   • bank_hint /     → no badge (the categorization happened, the
    //     merchant_keyword   user doesn't need a per-row noise indicator)
    renderCell: ({ t, isAutoRule, isTaggedExport, isLlm, isBankHint, isMerchantKeyword }) => {
      void isBankHint; void isMerchantKeyword; // intentionally not rendered
      if (isAutoRule && t.appliedRuleId) {
        return (
          <Link
            href={`/admin/rules?edit=${t.appliedRuleId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary-soft/80"
            title={t.ruleName ? `כלל: ${t.ruleName} (לחץ לעריכה)` : 'לחץ לעריכת הכלל'}
          >
            <Zap className="size-2.5" />כלל
          </Link>
        );
      }
      if (isTaggedExport) {
        return (
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success" title="קטגוריה הגיעה מהקובץ עצמו (תיוג ידני בקובץ המקור)">
            <UserCheck className="size-2.5" />תיוג
          </span>
        );
      }
      if (isLlm) {
        // If an AI-created rule fired (or AI categorized directly + saved
        // a rule), link the badge to /admin/rules so the user can review
        // and convert it to a "real" user rule, broaden it, or delete it.
        const tooltip = t.ruleName
          ? `תוייג על ידי AI · כלל אוטומטי: ${t.ruleName} (לחץ לעריכה)`
          : 'תוייג על ידי AI במהלך הייבוא — נוצר כלל אוטומטי לעתיד';
        if (t.appliedRuleId) {
          return (
            <Link
              href={`/admin/rules?edit=${t.appliedRuleId}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent-soft/80"
              title={tooltip}
            >
              <Sparkles className="size-2.5" />AI
            </Link>
          );
        }
        return (
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent" title={tooltip}>
            <Sparkles className="size-2.5" />AI
          </span>
        );
      }
      return <span className="text-muted-foreground/50 text-xs">—</span>;
    },
  },
};

export const DEFAULT_ORDER: ColumnId[] = ['date', 'merchant', 'flag', 'account', 'source', 'category', 'expense', 'income', 'notes', 'rule'];

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** Tri-state sort: column id + direction. `null` column = no sort applied
 *  (rows fall back to the natural date-desc order from the server). */
export type SortDir = 'asc' | 'desc';
export interface SortState {
  columnId: ColumnId | null;
  dir:      SortDir;
}

/** Build a comparator function for the active sort state. Pass it to
 *  Array.sort to order an array of CellContext values. Stable across
 *  equal keys: callers should pre-sort by date desc to preserve a
 *  meaningful tiebreaker.
 *
 *  Null accessor values always sort LAST regardless of direction —
 *  matches the convention that "missing data" shouldn't crowd the top
 *  of the user's view in either direction.
 */
export function buildComparator(sort: SortState): ((a: CellContext, b: CellContext) => number) | null {
  if (!sort.columnId) return null;
  const col = COLUMN_DEFS[sort.columnId];
  const accessor = col.sortAccessor;
  if (!accessor) return null;

  const sign = sort.dir === 'asc' ? 1 : -1;

  return (a, b) => {
    const va = accessor(a);
    const vb = accessor(b);
    // Null handling: always last
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * sign;
    }
    // String comparison — Hebrew-aware
    return String(va).localeCompare(String(vb), 'he') * sign;
  };
}

// ─── Hook: load/save user prefs from localStorage ────────────────────────────

// v2 = added per-column widths. Old v1 keys are auto-migrated by sanitizing.
const STORAGE_KEY = 'fba.tx-columns.v2';
const LEGACY_STORAGE_KEY = 'fba.tx-columns.v1';

interface ColumnPrefs {
  order:   ColumnId[];                          // user's preferred order
  visible: Record<ColumnId, boolean>;           // user's show/hide state
  widths:  Record<ColumnId, number | null>;     // px width per column; null = auto
}

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 800;

function loadPrefs(): ColumnPrefs {
  if (typeof window === 'undefined') {
    return defaultPrefs();
  }
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY); // migrate seamlessly
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
    // Sanitize: drop unknown ids, fill in missing ones with defaults.
    const known = new Set(DEFAULT_ORDER);
    const order = (parsed.order ?? []).filter((id): id is ColumnId => known.has(id as ColumnId));
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    const visible = { ...defaultPrefs().visible, ...(parsed.visible ?? {}) } as Record<ColumnId, boolean>;
    const widths  = { ...defaultPrefs().widths,  ...(parsed.widths  ?? {}) } as Record<ColumnId, number | null>;
    // Clamp any out-of-range widths
    for (const id of DEFAULT_ORDER) {
      const w = widths[id];
      if (w !== null && (w < MIN_COL_WIDTH || w > MAX_COL_WIDTH)) widths[id] = null;
    }
    return { order, visible, widths };
  } catch {
    return defaultPrefs();
  }
}

function defaultPrefs(): ColumnPrefs {
  const visible = {} as Record<ColumnId, boolean>;
  const widths  = {} as Record<ColumnId, number | null>;
  for (const id of DEFAULT_ORDER) {
    visible[id] = COLUMN_DEFS[id].defaultVisible;
    widths[id]  = null;
  }
  return { order: [...DEFAULT_ORDER], visible, widths };
}

export function useColumnPrefs() {
  // Hydrate from localStorage on mount only (avoid SSR/CSR mismatch).
  const [prefs, setPrefs] = useState<ColumnPrefs>(defaultPrefs);
  const hydrated = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  const visibleColumns: ColumnDef[] = prefs.order
    .filter((id) => prefs.visible[id])
    .map((id) => COLUMN_DEFS[id]);

  return {
    prefs,
    visibleColumns,
    setOrder:   (order:   ColumnId[]) => setPrefs((p) => ({ ...p, order })),
    setVisible: (id: ColumnId, value: boolean) => setPrefs((p) => ({ ...p, visible: { ...p.visible, [id]: value } })),
    setWidth:   (id: ColumnId, value: number | null) => setPrefs((p) => ({
      ...p,
      widths: {
        ...p.widths,
        [id]: value === null ? null : Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(value))),
      },
    })),
    reset:      () => setPrefs(defaultPrefs()),
  };
}

// ─── Resize handle ────────────────────────────────────────────────────────────
//
// A 4-px-wide invisible drag strip on the right edge of every TH. On
// mousedown it captures the pointer, listens to mousemove on the document,
// and reports the new width back via onWidthChange. Double-click resets
// the column to auto width.
//
// Why not a library: this is ~30 LOC with no external deps and works
// perfectly with the existing colgroup/inline-width approach.
//
export function ColumnResizeHandle({
  onWidthChange,
  onReset,
}: {
  onWidthChange: (next: number) => void;
  onReset: () => void;        // double-click → null (auto)
}) {
  const handleRef = useRef<HTMLDivElement>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Measure the parent TH's current rendered width — this is our
    // starting baseline regardless of whether the user previously set a
    // pixel width or it's still auto-sized.
    const th = handleRef.current?.closest('th');
    const startWidth = th ? th.getBoundingClientRect().width : 120;
    const startX = e.clientX;
    const isRtl = document.dir === 'rtl' || document.documentElement.dir === 'rtl';

    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      // In RTL, the resize handle sits on the visible LEFT edge of the
      // header cell. Dragging the mouse LEFT (negative deltaX) makes the
      // column WIDER. So invert the sign in RTL.
      const next = startWidth + (isRtl ? -delta : delta);
      onWidthChange(next);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <div
      ref={handleRef}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      // -end-1 puts the handle on the BOUNDARY between this column and the
      // next one. In RTL the next column is to the LEFT, so the handle
      // visually sits on the column's left edge — which is what the user
      // expects to drag. Tailwind translates -end → -right in LTR, -left
      // in RTL automatically. 3px wide so it's easy to grab.
      className="absolute top-0 bottom-0 -end-[2px] w-[3px] cursor-col-resize select-none touch-none bg-border/50 hover:bg-primary/60 active:bg-primary"
      title="גרור כדי לשנות רוחב, דאבל-קליק לאיפוס"
      aria-label="שנה רוחב עמודה"
    />
  );
}

// ─── Customizer modal ─────────────────────────────────────────────────────────

export function ColumnsCustomizer({
  prefs,
  onClose,
  onSetOrder,
  onSetVisible,
  onReset,
}: {
  prefs: ColumnPrefs;
  onClose: () => void;
  onSetOrder: (order: ColumnId[]) => void;
  onSetVisible: (id: ColumnId, value: boolean) => void;
  onReset: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = prefs.order.indexOf(active.id as ColumnId);
    const newIndex = prefs.order.indexOf(over.id as ColumnId);
    if (oldIndex < 0 || newIndex < 0) return;
    onSetOrder(arrayMove(prefs.order, oldIndex, newIndex));
  }

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="columns-customizer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="columns-customizer-title" className="text-base font-semibold">
              התאמת עמודות
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              סמן/בטל סימון להצגה והסתרה. גרור את הידיות כדי לשנות את הסדר.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent/40"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Sortable list */}
        <div className="flex-1 overflow-y-auto p-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={prefs.order} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {prefs.order.map((id) => (
                  <SortableRow
                    key={id}
                    id={id}
                    label={COLUMN_DEFS[id].label}
                    visible={prefs.visible[id]}
                    onToggle={(v) => onSetVisible(id, v)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            איפוס לברירת מחדל
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            סיים
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({
  id,
  label,
  visible,
  onToggle,
}: {
  id: ColumnId;
  label: string;
  visible: boolean;
  onToggle: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background px-2 py-2 text-sm',
        isDragging && 'shadow-lg ring-1 ring-primary',
        !visible && 'opacity-60',
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={`גרור כדי לשנות את מיקום העמודה "${label}"`}
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Visibility checkbox */}
      <input
        type="checkbox"
        checked={visible}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-4"
        id={`col-vis-${id}`}
      />
      <label htmlFor={`col-vis-${id}`} className="flex-1 cursor-pointer select-none">
        {label}
      </label>
    </li>
  );
}
