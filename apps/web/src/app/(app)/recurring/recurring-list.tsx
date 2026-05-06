'use client';

/**
 * Interactive recurring-patterns table. Server-component page.tsx loads the
 * data and hands it to this client island, which owns:
 *   • The "Add new" button + add modal
 *   • Per-row edit / delete / pause-resume buttons + edit modal
 *
 * Display logic stays close to the original server-side render so the table
 * looks identical — just with extra action buttons on each row.
 */

import { useState, useTransition } from 'react';
import { Pencil, Plus, Trash2, PauseCircle, PlayCircle } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { RecurringModal, type RecurringPatternRow } from './recurring-modal';
import { deleteRecurringPattern, setRecurringStatus } from './actions';

interface Cat { id: string; nameHe: string; color: string | null }

const FREQ_LABEL: Record<string, string> = {
  monthly:   'חודשי',
  bimonthly: 'דו-חודשי',
  quarterly: 'רבעוני',
  yearly:    'שנתי',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  ended:  'הסתיים',
};

export function RecurringList({
  patterns,
  categories,
}: {
  patterns: Array<RecurringPatternRow & { lastSeenMonth: string; occurrenceCount: number }>;
  categories: Cat[];
}) {
  const [modalPattern, setModalPattern] = useState<RecurringPatternRow | null | undefined>(undefined);
  // undefined = closed; null = create mode; object = edit mode
  const [isPending, startTransition] = useTransition();

  const catMap = new Map(categories.map((c) => [c.id, c]));

  function onDelete(id: string) {
    if (!confirm('למחוק את התבנית?')) return;
    startTransition(async () => {
      await deleteRecurringPattern(id);
    });
  }

  function onToggleStatus(id: string, current: string) {
    const next = current === 'active' ? 'paused' : 'active';
    startTransition(async () => {
      await setRecurringStatus(id, next);
    });
  }

  return (
    <>
      {/* Add button + count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {patterns.length === 0 ? 'אין תבניות' : `${patterns.length} תבניות סך הכל`}
        </div>
        <button
          type="button"
          onClick={() => setModalPattern(null)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          הוסף הוצאה קבועה
        </button>
      </div>

      {patterns.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          לחץ על &ldquo;הוסף הוצאה קבועה&rdquo; כדי להתחיל. דוגמאות: ארנונה, פלאפון, נטפליקס, משכנתא.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-3 py-2 font-medium">בית עסק</th>
                <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
                <th className="border-b px-3 py-2 font-medium">סכום צפוי</th>
                <th className="border-b px-3 py-2 font-medium">תדירות</th>
                <th className="border-b px-3 py-2 font-medium">חודש אחרון</th>
                <th className="border-b px-3 py-2 font-medium">הופעות</th>
                <th className="border-b px-3 py-2 font-medium">סטטוס</th>
                <th className="border-b px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => {
                const cat = p.categoryId ? catMap.get(p.categoryId) : null;
                const amt = Number(p.expectedAmountIls);
                const isIncome = amt >= 0;
                const isPaused = p.status === 'paused';
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.merchantNormalized}</div>
                      {p.description && (
                        <div className="text-[11px] text-muted-foreground" title={p.description}>
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {cat ? (
                        <span
                          className="pill text-xs"
                          style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}
                        >
                          {cat.nameHe}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${isIncome ? 'text-success font-medium' : ''}`}>
                      {p.amountMode === 'dynamic' ? (
                        <span className="text-muted-foreground italic">דינמי</span>
                      ) : p.amountMode === 'range' && p.minAmountIls != null && p.maxAmountIls != null ? (
                        <div className="flex flex-col leading-tight">
                          <span>
                            {isIncome ? '+' : '−'}{formatIls(Math.abs(Number(p.minAmountIls)), { decimals: false })}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            עד {formatIls(Math.abs(Number(p.maxAmountIls)), { decimals: false })}
                          </span>
                        </div>
                      ) : (
                        <>{isIncome ? '+' : '−'}{formatIls(Math.abs(amt), { decimals: false })}</>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {FREQ_LABEL[p.frequency] ?? p.frequency}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.lastSeenMonth}</td>
                    <td className="px-3 py-2 tabular-nums">{p.occurrenceCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === 'active'
                            ? 'bg-success/10 text-success'
                            : p.status === 'ended'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-warning/10 text-warning'
                        }`}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onToggleStatus(p.id, p.status)}
                          disabled={isPending || p.status === 'ended'}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40 disabled:opacity-30"
                          title={isPaused ? 'הפעל מחדש' : 'השהה'}
                          aria-label={isPaused ? 'הפעל מחדש' : 'השהה'}
                        >
                          {isPaused
                            ? <PlayCircle className="size-3.5" />
                            : <PauseCircle className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalPattern(p)}
                          className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                          title="ערוך"
                          aria-label="ערוך"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(p.id)}
                          disabled={isPending}
                          className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                          title="מחק"
                          aria-label="מחק"
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

      {modalPattern !== undefined && (
        <RecurringModal
          pattern={modalPattern}
          categories={categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          onClose={() => setModalPattern(undefined)}
        />
      )}
    </>
  );
}
