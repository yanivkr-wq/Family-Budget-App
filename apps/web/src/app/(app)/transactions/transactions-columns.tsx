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
import { CreditCard, GripVertical, Repeat, Sparkles, Upload, User, X, Zap, Clock } from 'lucide-react';
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
  | 'notes';

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
    isManual?: boolean;
    installmentPlanId?: string | null;
    installmentCurrentPaymentNo?: number | null;
    installmentTotalPayments?: number | null;
    installmentEndMonth?: string | null;
    recurringPatternId?: string | null;
    recurringPatternFrequency?: string | null;
  };
  cat: Cat | null;
  subCat: Cat | null;
  acc: Account | null;
  isInstallment: boolean;
  isAutoRule: boolean;
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
    renderCell: ({ t, chargeDateDiffersFromGroup, isPendingCharge, effectiveChargeDate }) => (
      <>
        <div>{formatDateHe(t.date)}</div>
        {chargeDateDiffersFromGroup && isPendingCharge && (
          <div
            className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
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
    // Pure merchant text now — installment / recurring pills moved to the
    // dedicated "תג" column so the merchant column stays clean and skim-able.
    renderCell: ({ t }) => <>{t.merchant}</>,
  },

  flag: {
    id: 'flag',
    label: 'דגל',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    renderCell: ({ t, isInstallment }) => {
      // Installment + recurring are mutually exclusive — installments take
      // precedence as the more specific signal (they end after N payments).
      const isRecurring = !isInstallment && !!t.recurringPatternId;
      if (isInstallment) {
        return (
          <Link
            href="/installments"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15"
            title="חלק מתוכנית תשלומים — פתח את הניהול"
          >
            <CreditCard className="size-2.5 shrink-0" />
            <span>
              {t.installmentTotalPayments
                ? `תשלום ${t.installmentCurrentPaymentNo}/${t.installmentTotalPayments}`
                : `תשלום ${t.installmentCurrentPaymentNo}`}
            </span>
            {t.installmentEndMonth && (
              <span className="opacity-70">
                · עד {t.installmentEndMonth.slice(5, 7)}/{t.installmentEndMonth.slice(2, 4)}
              </span>
            )}
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
    renderCell: ({ acc }) => <>{acc?.name ?? '—'}</>,
  },

  source: {
    id: 'source',
    label: 'מקור',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    renderCell: ({ txIsManual }) =>
      txIsManual ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300" title="הוזן ידנית">
          <User className="size-2.5" />ידני
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="יובא מקובץ / אוטומטי">
          <Upload className="size-2.5" />ייבוא
        </span>
      ),
  },

  category: {
    id: 'category',
    label: 'קטגוריה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'px-3 py-2 align-top',
    renderCell: ({ t, cat, subCat, isAutoRule, isLlm }) =>
      cat ? (
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
      ),
  },

  expense: {
    id: 'expense',
    label: 'הוצאה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-foreground/80',
    cellClass: 'px-3 py-2 text-right align-top tabular-nums',
    renderCell: ({ t }) => <>{t.amount < 0 ? formatIls(t.amount) : ''}</>,
  },

  income: {
    id: 'income',
    label: 'הכנסה',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 text-right font-medium tabular-nums w-28 text-success',
    cellClass: 'px-3 py-2 text-right align-top tabular-nums text-success',
    renderCell: ({ t }) => <>{t.amount >= 0 ? formatIls(t.amount) : ''}</>,
  },

  notes: {
    id: 'notes',
    label: 'הערות',
    defaultVisible: true,
    headClass: 'border-b px-3 py-2 font-medium',
    cellClass: 'max-w-xs truncate px-3 py-2 align-top text-muted-foreground',
    renderCell: ({ t }) => <span title={t.notes ?? ''}>{t.notes}</span>,
  },
};

export const DEFAULT_ORDER: ColumnId[] = ['date', 'merchant', 'flag', 'account', 'source', 'category', 'expense', 'income', 'notes'];

// ─── Hook: load/save user prefs from localStorage ────────────────────────────

const STORAGE_KEY = 'fba.tx-columns.v1';

interface ColumnPrefs {
  order:   ColumnId[];                    // user's preferred order
  visible: Record<ColumnId, boolean>;     // user's show/hide state
}

function loadPrefs(): ColumnPrefs {
  if (typeof window === 'undefined') {
    return defaultPrefs();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
    // Sanitize: drop unknown ids, fill in missing ones with defaults.
    const known = new Set(DEFAULT_ORDER);
    const order = (parsed.order ?? []).filter((id): id is ColumnId => known.has(id as ColumnId));
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    const visible = { ...defaultPrefs().visible, ...(parsed.visible ?? {}) } as Record<ColumnId, boolean>;
    return { order, visible };
  } catch {
    return defaultPrefs();
  }
}

function defaultPrefs(): ColumnPrefs {
  const visible = {} as Record<ColumnId, boolean>;
  for (const id of DEFAULT_ORDER) visible[id] = COLUMN_DEFS[id].defaultVisible;
  return { order: [...DEFAULT_ORDER], visible };
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
    reset:      () => setPrefs(defaultPrefs()),
  };
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
