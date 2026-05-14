'use client';

/**
 * Editable transactions table for the per-project page.
 *
 * Project-tagged transactions are filtered out of /transactions by design,
 * which means the user can't reach the standard edit modal from there.
 * This wraps the same EditTransactionModal so re-categorization works
 * directly on the project's own page.
 *
 * Also supports a per-row "remove from project" action so a mis-tagged
 * transaction can be sent back to the regular cash flow without leaving
 * the page.
 */

import { useState, useTransition } from 'react';
import { Pencil, FolderMinus, CalendarCheck, CircleSlash } from 'lucide-react';
import { formatIls, formatShortDateHe } from '@fba/shared';
import { EditTransactionModal } from '../../transactions/edit-modal';
import { assignTransactionsToProject } from '../actions';

export interface ProjectTxn {
  id:            string;
  date:          string;
  chargeDate:    string | null;
  billingMonth:  string;
  merchant:      string;
  amount:        number; // signed
  categoryId:    string | null;
  subCategoryId: string | null;
  accountId:     string;
  notes:         string | null;
  isTransfer:    boolean;
  /** Per-row override that brings this transaction back into monthly
   *  totals despite the project's exclusion. true = visible in /, /transactions
   *  AND on this project page; false = project-only. */
  includeInMonthlyOverride: boolean;
  /** "Accounting noise" — row stays visible but never counts in any
   *  aggregation (project totals, monthly, insights). Used for loan
   *  refinancing rows, CC settlement lines, internal corrections. */
  excludedFromTotals: boolean;
}

interface Cat    { id: string; nameHe: string; color: string | null }
interface SubCat extends Cat { parentId: string }
interface Account { id: string; name: string }

export function ProjectTxnsTable({
  txns,
  categories,
  subCategories,
  accounts,
  catMap,
  accNameById,
  projectId,
}: {
  txns:          ProjectTxn[];
  categories:    Cat[];
  subCategories: SubCat[];
  accounts:      Account[];
  catMap:        Map<string, { nameHe: string; color: string | null }>;
  accNameById:   Map<string, string>;
  /** Passed through to the edit modal so it knows whether to surface
   *  the "include in monthly" override checkbox for the row. */
  projectId:     string;
}) {
  const [editTxnId, setEditTxnId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editing = editTxnId ? txns.find((t) => t.id === editTxnId) : null;

  function removeFromProject(id: string) {
    if (!confirm('להסיר תיוג פרויקט מהתנועה? היא תחזור להופיע בתצוגות החודשיות הרגילות.')) return;
    startTransition(async () => {
      await assignTransactionsToProject([id], null);
    });
  }

  return (
    <>
      <section className="rounded-lg border bg-card overflow-hidden" dir="rtl">
        <div className="border-b bg-muted/20 px-4 py-2.5">
          <h2 className="text-sm font-semibold">כל התנועות בפרויקט ({txns.length})</h2>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-right">
            <tr>
              <th className="border-b px-3 py-2 font-medium">תאריך</th>
              <th className="border-b px-3 py-2 font-medium">בית עסק</th>
              <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
              <th className="border-b px-3 py-2 font-medium">חשבון</th>
              <th className="border-b px-3 py-2 font-medium text-end">סכום</th>
              <th className="border-b px-3 py-2 font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => {
              const cat = t.categoryId ? catMap.get(t.categoryId) : null;
              const accName = accNameById.get(t.accountId);
              return (
                <tr
                  key={t.id}
                  id={`project-txn-row-${t.id}`}
                  className={`border-b last:border-0 transition-colors ${
                    // Excluded rows are visually de-emphasized (italic +
                    // reduced opacity) so the eye skips them when scanning
                    // for "real" project spending. They're still hoverable
                    // and editable.
                    t.excludedFromTotals
                      ? 'italic opacity-60 hover:opacity-100 hover:bg-muted/30'
                      : 'hover:bg-muted/30'
                  }`}
                >
                  <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatShortDateHe(t.date)}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{t.merchant}</span>
                      {t.includeInMonthlyOverride && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-accent"
                          title="התנועה כלולה גם בסיכומים החודשיים (הוצאה שוטפת בנוסף לחלקה בפרויקט)"
                        >
                          <CalendarCheck className="size-2.5" />
                          גם חודשי
                        </span>
                      )}
                      {t.excludedFromTotals && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                          title="תנועה חשבונאית בלבד — מוצגת לתיעוד אך לא נספרת בסיכומי הפרויקט או החודשיים"
                        >
                          <CircleSlash className="size-2.5" />
                          לא נספרת
                        </span>
                      )}
                    </div>
                    {t.notes && (
                      <div className="text-[11px] text-muted-foreground" title={t.notes}>
                        {t.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {cat ? (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}
                      >
                        {cat.nameHe}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {accName ?? '—'}
                  </td>
                  <td className={`px-3 py-2 tabular-nums font-semibold text-end ${
                    t.amount > 0 ? 'text-success' : ''
                  }`}>
                    {/* Signed display: negative = expense (no sign, magnitude
                        only — matches the rest of the app's expense rendering),
                        positive = income (with explicit + and green color so
                        funding visually pops out from spending). */}
                    {t.amount > 0
                      ? `+${formatIls(t.amount, { decimals: false })}`
                      : formatIls(Math.abs(t.amount), { decimals: false })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditTxnId(t.id)}
                        className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                        title="ערוך תנועה (כולל קטגוריה, סכום, חשבון, סימון העברה)"
                        aria-label="ערוך תנועה"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromProject(t.id)}
                        disabled={isPending}
                        className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        title="הסר תיוג פרויקט (התנועה תחזור לתצוגות החודשיות)"
                        aria-label="הסר תיוג פרויקט"
                      >
                        <FolderMinus className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditTransactionModal
          transaction={{
            id:                       editing.id,
            date:                     editing.date,
            chargeDate:               editing.chargeDate,
            amount:                   editing.amount,
            merchant:                 editing.merchant,
            categoryId:               editing.categoryId,
            subCategoryId:            editing.subCategoryId,
            accountId:                editing.accountId,
            notes:                    editing.notes,
            isTransfer:               editing.isTransfer,
            includeInMonthlyOverride: editing.includeInMonthlyOverride,
            excludedFromTotals:       editing.excludedFromTotals,
            projectId,
          }}
          categories={categories}
          subCategories={subCategories}
          accounts={accounts}
          onClose={() => setEditTxnId(null)}
        />
      )}
    </>
  );
}
