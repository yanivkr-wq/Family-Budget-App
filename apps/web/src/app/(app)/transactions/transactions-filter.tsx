'use client';

import { useCallback } from 'react';
import { Search, X } from 'lucide-react';

export interface FilterState {
  text: string;
  categoryId: string;
  accountId: string;
  sign: 'all' | 'expense' | 'income';
  /** Filter rows by their flag: any / recurring / installment / one-off. */
  flag: 'all' | 'recurring' | 'installment' | 'one-off';
  dateFrom: string;
  dateTo: string;
}

export const emptyFilter: FilterState = {
  text: '',
  categoryId: '',
  accountId: '',
  sign: 'all',
  flag: 'all',
  dateFrom: '',
  dateTo: '',
};

export function isFilterActive(f: FilterState): boolean {
  return (
    f.text !== '' ||
    f.categoryId !== '' ||
    f.accountId !== '' ||
    f.sign !== 'all' ||
    f.flag !== 'all' ||
    f.dateFrom !== '' ||
    f.dateTo !== ''
  );
}

interface Cat {
  id: string;
  nameHe: string;
}
interface Account {
  id: string;
  name: string;
}

export function TransactionsFilter(props: {
  filter: FilterState;
  categories: Cat[];
  accounts: Account[];
  totalCount: number;
  filteredCount: number;
  onChange: (f: FilterState) => void;
}) {
  const { filter, onChange } = props;

  const set = useCallback(
    (partial: Partial<FilterState>) => onChange({ ...filter, ...partial }),
    [filter, onChange],
  );

  const active = isFilterActive(filter);

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Free-text search */}
        <div className="relative flex-1 min-w-40">
          <Search className="pointer-events-none absolute inset-y-0 end-2.5 my-auto size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="חיפוש בית עסק..."
            value={filter.text}
            onChange={(e) => set({ text: e.target.value })}
            className="w-full rounded-md border bg-background py-1.5 pe-8 ps-2.5 text-sm placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Category */}
        <select
          value={filter.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">כל הקטגוריות</option>
          {props.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameHe}
            </option>
          ))}
        </select>

        {/* Account */}
        <select
          value={filter.accountId}
          onChange={(e) => set({ accountId: e.target.value })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">כל החשבונות</option>
          {props.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Income / Expense */}
        <select
          value={filter.sign}
          onChange={(e) => set({ sign: e.target.value as FilterState['sign'] })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">הכנסות + הוצאות</option>
          <option value="expense">הוצאות בלבד</option>
          <option value="income">הכנסות בלבד</option>
        </select>

        {/* Flag — recurring / installment / one-off */}
        <select
          value={filter.flag}
          onChange={(e) => set({ flag: e.target.value as FilterState['flag'] })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          title="סנן לפי דגל"
        >
          <option value="all">כל הדגלים</option>
          <option value="recurring">קבועות בלבד</option>
          <option value="installment">תשלומים בלבד</option>
          <option value="one-off">חד-פעמיות בלבד</option>
        </select>

        {/* Date from */}
        <input
          type="date"
          value={filter.dateFrom}
          onChange={(e) => set({ dateFrom: e.target.value })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          title="מתאריך"
        />

        {/* Date to */}
        <input
          type="date"
          value={filter.dateTo}
          onChange={(e) => set({ dateTo: e.target.value })}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          title="עד תאריך"
        />

        {/* Clear */}
        {active && (
          <button
            onClick={() => onChange(emptyFilter)}
            className="inline-flex items-center gap-1 rounded-md border border-muted px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/40"
            title="נקה פילטרים"
          >
            <X className="size-3" />
            נקה
          </button>
        )}
      </div>

      {/* Result count */}
      {active && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {props.filteredCount === props.totalCount
            ? `${props.totalCount} תנועות`
            : `מציג ${props.filteredCount} מתוך ${props.totalCount} תנועות`}
        </p>
      )}
    </div>
  );
}
