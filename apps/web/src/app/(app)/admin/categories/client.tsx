'use client';

import { useState, useTransition } from 'react';
import {
  Plus, ChevronDown, ChevronRight, Pencil, Archive, RotateCcw,
  Check, X, Loader2, EyeOff, Tags, PiggyBank,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIls } from '@fba/shared';
import { createCategory, updateCategory, archiveCategory, restoreCategory } from './actions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Cat {
  id: string;
  nameHe: string;
  color: string | null;
  icon: string | null;
  isIncome: boolean;
  isSavings: boolean;
  isArchived: boolean;
  sortOrder: number;
  monthlyTargetIls: string | null;
  parentId: string | null;
}

interface Props {
  categories: Cat[];
}

// ─── Colour swatches ──────────────────────────────────────────────────────────

const SWATCHES = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#64748b',
];

// ─── Inline edit form for a single category ───────────────────────────────────

function InlineEditForm({
  cat,
  onDone,
}: {
  cat: Cat;
  onDone: () => void;
}) {
  const [nameHe, setNameHe] = useState(cat.nameHe);
  const [color, setColor] = useState(cat.color ?? '');
  const [target, setTarget] = useState(
    cat.monthlyTargetIls ? String(Number(cat.monthlyTargetIls)) : '',
  );
  const [isIncome, setIsIncome] = useState(cat.isIncome);
  const [isSavings, setIsSavings] = useState(cat.isSavings);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    const fd = new FormData();
    fd.set('id', cat.id);
    fd.set('nameHe', nameHe);
    fd.set('color', color);
    fd.set('monthlyTargetIls', target);
    fd.set('isIncome', String(isIncome));
    fd.set('isSavings', String(isSavings));
    startTransition(async () => {
      const r = await updateCategory(fd);
      if (r.ok) onDone();
      else setError(r.error ?? 'שגיאה');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1" dir="rtl">
      <input
        value={nameHe}
        onChange={(e) => setNameHe(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm w-36"
        placeholder="שם"
        dir="rtl"
      />

      {/* Color swatches */}
      <div className="flex items-center gap-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setColor(s)}
            className={cn(
              'size-5 rounded-full border-2 transition-transform hover:scale-110',
              color === s ? 'border-foreground scale-110' : 'border-transparent',
            )}
            style={{ backgroundColor: s }}
            aria-label={s}
          />
        ))}
        <button
          type="button"
          onClick={() => setColor('')}
          className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          ×
        </button>
      </div>

      {!cat.parentId && (
        <>
          {/* Monthly target */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">תקציב:</span>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="₪ / חודש"
              className="rounded-md border bg-background px-2 py-1 text-sm w-24 tabular-nums"
              min={0}
            />
          </div>

          {/* Income toggle */}
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={isIncome}
              onChange={(e) => setIsIncome(e.target.checked)}
            />
            הכנסות
          </label>

          {/* Savings toggle */}
          <label className="flex items-center gap-1.5 text-xs" title="תסמן קטגוריה זו כחיסכון — תנועות בה יספרו כהפקדת חיסכון">
            <input
              type="checkbox"
              checked={isSavings}
              onChange={(e) => setIsSavings(e.target.checked)}
            />
            <PiggyBank className="size-3 text-emerald-600" />
            חיסכון
          </label>
        </>
      )}

      <button
        onClick={save}
        disabled={isPending || !nameHe.trim()}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
      >
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        שמור
      </button>
      <button onClick={onDone} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
        <X className="size-3.5" />
      </button>

      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Add category form ────────────────────────────────────────────────────────

function AddCategoryForm({
  parentId,
  onDone,
}: {
  parentId: string | null;
  onDone: () => void;
}) {
  const [nameHe, setNameHe] = useState('');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [target, setTarget] = useState('');
  const [isIncome, setIsIncome] = useState(false);
  const [isSavings, setIsSavings] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    const fd = new FormData();
    fd.set('nameHe', nameHe);
    fd.set('color', color);
    if (parentId) fd.set('parentId', parentId);
    fd.set('monthlyTargetIls', target);
    fd.set('isIncome', String(isIncome));
    fd.set('isSavings', String(isSavings));
    startTransition(async () => {
      const r = await createCategory(fd);
      if (r.ok) { setNameHe(''); setTarget(''); onDone(); }
      else setError(r.error ?? 'שגיאה');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary-soft/10 p-2" dir="rtl">
      <input
        value={nameHe}
        onChange={(e) => setNameHe(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm w-36"
        placeholder={parentId ? 'שם תת-קטגוריה' : 'שם קטגוריה'}
        autoFocus
        dir="rtl"
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone(); }}
      />

      {/* Color */}
      <div className="flex items-center gap-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setColor(s)}
            className={cn(
              'size-5 rounded-full border-2 transition-transform hover:scale-110',
              color === s ? 'border-foreground scale-110' : 'border-transparent',
            )}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>

      {!parentId && (
        <>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">תקציב:</span>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="₪ / חודש"
              className="rounded-md border bg-background px-2 py-1 text-sm w-24 tabular-nums"
              min={0}
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={isIncome} onChange={(e) => setIsIncome(e.target.checked)} />
            הכנסות
          </label>
          <label className="flex items-center gap-1.5 text-xs" title="קטגוריה זו מייצגת חיסכון">
            <input type="checkbox" checked={isSavings} onChange={(e) => setIsSavings(e.target.checked)} />
            <PiggyBank className="size-3 text-emerald-600" />
            חיסכון
          </label>
        </>
      )}

      <button
        onClick={save}
        disabled={isPending || !nameHe.trim()}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
      >
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
        הוסף
      </button>
      <button onClick={onDone} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
        <X className="size-3.5" />
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Single category row ──────────────────────────────────────────────────────

function CategoryRow({
  cat,
  subCats,
  showArchived,
}: {
  cat: Cat;
  subCats: Cat[];
  showArchived: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [isPending, startTransition] = useTransition();

  const visibleSubs = subCats.filter((s) => showArchived || !s.isArchived);

  function toggleArchive() {
    if (!confirm(cat.isArchived ? 'שחזר קטגוריה?' : 'לארכב קטגוריה? כל התת-קטגוריות יוארכבו איתה.'))
      return;
    startTransition(async () => {
      if (cat.isArchived) await restoreCategory(cat.id);
      else await archiveCategory(cat.id);
    });
  }

  return (
    <div className={cn('rounded-md border', cat.isArchived && 'opacity-50')}>
      {/* Category header row */}
      {editing ? (
        <div className="px-3 py-2">
          <InlineEditForm cat={cat} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Expand toggle */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'כווץ' : 'הרחב'}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>

          {/* Color dot */}
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: cat.color ?? 'hsl(215 65% 35%)' }}
          />

          {/* Name */}
          <span className={cn('flex-1 flex items-center gap-1.5 text-sm font-medium', cat.isIncome && 'text-success')}>
            {cat.nameHe}
            {cat.isIncome && <span className="text-xs text-muted-foreground">(הכנסות)</span>}
            {cat.isSavings && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-2xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <PiggyBank className="size-2.5" /> חיסכון
              </span>
            )}
            {cat.isArchived && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <EyeOff className="size-3" /> מוסתר
              </span>
            )}
          </span>

          {/* Target */}
          {cat.monthlyTargetIls && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatIls(Number(cat.monthlyTargetIls), { decimals: false })} / חודש
            </span>
          )}

          {/* Sub-count */}
          {subCats.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
              {subCats.length} תת-קטגוריות
            </span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setEditing(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              title="ערוך"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={toggleArchive}
              disabled={isPending}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              title={cat.isArchived ? 'שחזר' : 'ארכב'}
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : cat.isArchived ? (
                <RotateCcw className="size-3.5" />
              ) : (
                <Archive className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Sub-categories */}
      {(expanded || addingSub) && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
          {visibleSubs.length === 0 && !addingSub && (
            <p className="py-1 text-xs text-muted-foreground">אין תת-קטגוריות</p>
          )}
          {visibleSubs.map((sub) => (
            <SubCategoryRow key={sub.id} cat={sub} showArchived={showArchived} />
          ))}
          {addingSub ? (
            <AddCategoryForm parentId={cat.id} onDone={() => setAddingSub(false)} />
          ) : (
            !cat.isArchived && (
              <button
                onClick={() => setAddingSub(true)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3.5" />
                הוסף תת-קטגוריה
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-category row ─────────────────────────────────────────────────────────

function SubCategoryRow({ cat, showArchived: _ }: { cat: Cat; showArchived: boolean }) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function toggleArchive() {
    if (!confirm(cat.isArchived ? 'שחזר תת-קטגוריה?' : 'ארכב תת-קטגוריה?')) return;
    startTransition(async () => {
      if (cat.isArchived) await restoreCategory(cat.id);
      else await archiveCategory(cat.id);
    });
  }

  if (editing) {
    return (
      <div className="rounded-md border bg-background px-2 py-1">
        <InlineEditForm cat={cat} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background/80',
        cat.isArchived && 'opacity-50',
      )}
    >
      <span className="ms-3 text-muted-foreground">↳</span>
      {cat.color && (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: cat.color }}
        />
      )}
      <span className="flex-1">{cat.nameHe}</span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          title="ערוך"
        >
          <Pencil className="size-3" />
        </button>
        <button
          onClick={toggleArchive}
          disabled={isPending}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          title={cat.isArchived ? 'שחזר' : 'ארכב'}
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : cat.isArchived ? (
            <RotateCcw className="size-3" />
          ) : (
            <Archive className="size-3" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

export function CategoriesClient({ categories }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const [addingTop, setAddingTop] = useState(false);

  const topCats = categories.filter((c) => !c.parentId);
  const subMap = new Map<string, Cat[]>();
  for (const c of categories) {
    if (c.parentId) {
      if (!subMap.has(c.parentId)) subMap.set(c.parentId, []);
      subMap.get(c.parentId)!.push(c);
    }
  }

  const incomeCount = topCats.filter((c) => c.isIncome && !c.isArchived).length;
  const expenseCount = topCats.filter((c) => !c.isIncome && !c.isArchived).length;
  const archivedCount = categories.filter((c) => c.isArchived).length;

  const visible = topCats.filter((c) => showArchived || !c.isArchived);
  const expense = visible.filter((c) => !c.isIncome).sort((a, b) => a.sortOrder - b.sortOrder);
  const income = visible.filter((c) => c.isIncome).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">קטגוריות</h1>
          <p className="text-sm text-muted-foreground">
            {expenseCount} הוצאות · {incomeCount} הכנסות
            {archivedCount > 0 && ` · ${archivedCount} מוסתרות`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
                showArchived
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <EyeOff className="size-3.5" />
              {showArchived ? 'הסתר מוסתרות' : 'הצג מוסתרות'}
            </button>
          )}
          <button
            onClick={() => setAddingTop(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            קטגוריה חדשה
          </button>
        </div>
      </header>

      {/* ── Add form ── */}
      {addingTop && (
        <AddCategoryForm parentId={null} onDone={() => setAddingTop(false)} />
      )}

      {/* ── Expense categories ── */}
      {expense.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            הוצאות
          </h2>
          {expense.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              subCats={subMap.get(c.id) ?? []}
              showArchived={showArchived}
            />
          ))}
        </section>
      )}

      {/* ── Income categories ── */}
      {income.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            הכנסות
          </h2>
          {income.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              subCats={subMap.get(c.id) ?? []}
              showArchived={showArchived}
            />
          ))}
        </section>
      )}

      {visible.length === 0 && !addingTop && (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Tags className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">אין קטגוריות עדיין</p>
          <p className="mt-1 text-xs text-muted-foreground">לחץ על &ldquo;קטגוריה חדשה&rdquo; כדי להתחיל</p>
        </div>
      )}
    </div>
  );
}
