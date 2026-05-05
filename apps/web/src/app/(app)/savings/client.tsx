'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { formatIls } from '@fba/shared';
import {
  PiggyBank,
  Pencil,
  Trash2,
  Plus,
  X,
  Target,
  TrendingUp,
  CheckCircle2,
  PauseCircle,
  CircleDollarSign,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  Car,
  Home,
  Plane,
  BookOpen,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createGoal, updateGoal, deleteGoal, updateGoalBalance } from './actions';

// ─── types ────────────────────────────────────────────────────────────────────

export interface GoalRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  targetAmountIls: number | null;
  currentAmountIls: number;
  monthlyContributionIls: number | null;
  targetDate: string | null;
  status: 'active' | 'paused' | 'completed';
  priority: number;
  notes: string | null;
}

export interface MonthlySavingsData {
  month: string;
  deposited: number;       // sum of savings-tagged transactions this month
  target: number;          // sum of monthly targets on savings categories
}

// ─── icon/color presets ───────────────────────────────────────────────────────

// Lucide name → component map. We store the NAME (string) in the DB `icon`
// column so SSR/JSON-serialization stays simple, then look up the component
// here for rendering. Add new entries to both ICON_MAP and ICON_PRESETS.
const ICON_MAP: Record<string, LucideIcon> = {
  HeartPulse,
  Car,
  Home,
  Plane,
  BookOpen,
  Wallet,
  Target,
  TrendingUp,
  PiggyBank, // fallback / "general"
};

const ICON_PRESETS: Array<{ name: keyof typeof ICON_MAP; label: string }> = [
  { name: 'HeartPulse', label: 'קרן חירום' },
  { name: 'Car',        label: 'רכב' },
  { name: 'Home',       label: 'דיור' },
  { name: 'Plane',      label: 'חופשה' },
  { name: 'BookOpen',   label: 'חינוך' },
  { name: 'Wallet',     label: 'כללי' },
  { name: 'Target',     label: 'יעד' },
  { name: 'TrendingUp', label: 'השקעות' },
];

/** Render a goal icon by stored name; fall back to PiggyBank if unknown/null. */
function GoalIcon({
  name,
  className,
  style,
}: {
  name: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon: LucideIcon = (name ? ICON_MAP[name] : undefined) ?? PiggyBank;
  return <Icon className={className} style={style} />;
}

const COLOR_PRESETS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function progressPct(current: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function etaMonths(
  current: number,
  target: number | null,
  monthly: number | null,
): number | null {
  if (!target || !monthly || monthly <= 0) return null;
  const remaining = target - current;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / monthly);
}

function statusLabel(status: GoalRow['status']): string {
  if (status === 'paused') return 'מושהה';
  if (status === 'completed') return 'הושלם';
  return 'פעיל';
}

function StatusIcon({ status }: { status: GoalRow['status'] }) {
  if (status === 'completed')
    return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (status === 'paused')
    return <PauseCircle className="size-4 text-amber-500" />;
  return <CircleDollarSign className="size-4 text-primary" />;
}

// ─── goal form modal ──────────────────────────────────────────────────────────

interface GoalFormProps {
  goal?: GoalRow;
  onClose: () => void;
}

function GoalForm({ goal, onClose }: GoalFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(goal?.color ?? COLOR_PRESETS[0]!);
  const [selectedIcon, setSelectedIcon] = useState<string>(goal?.icon ?? ICON_PRESETS[0]!.name);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    // inject icon/color since they're controlled state
    data.set('icon', selectedIcon);
    data.set('color', selectedColor);
    if (goal) data.set('id', goal.id);

    startTransition(async () => {
      const result = goal ? await updateGoal(data) : await createGoal(data);
      if (!result.ok) {
        setError(result.error ?? 'שגיאה בשמירה');
      } else {
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            {goal ? 'עריכת יעד חיסכון' : 'יעד חיסכון חדש'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* name */}
          <div>
            <label className="mb-1 block text-sm font-medium">שם היעד *</label>
            <input
              name="name"
              defaultValue={goal?.name ?? ''}
              required
              placeholder="קרן חירום"
              className="input w-full"
            />
          </div>

          {/* description */}
          <div>
            <label className="mb-1 block text-sm font-medium">תיאור (אופציונלי)</label>
            <input
              name="description"
              defaultValue={goal?.description ?? ''}
              placeholder="למה אני חוסך לזה?"
              className="input w-full"
            />
          </div>

          {/* icon row */}
          <div>
            <label className="mb-1 block text-sm font-medium">אייקון</label>
            <div className="flex flex-wrap gap-2">
              {ICON_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.label}
                  onClick={() => setSelectedIcon(p.name)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                    selectedIcon === p.name
                      ? 'border-primary bg-primary-soft ring-1 ring-primary text-primary'
                      : 'hover:bg-muted text-muted-foreground',
                  )}
                >
                  <GoalIcon name={p.name} className="size-4" />
                </button>
              ))}
            </div>
          </div>

          {/* color row */}
          <div>
            <label className="mb-1 block text-sm font-medium">צבע</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform',
                    selectedColor === c ? 'scale-125 border-foreground' : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>

          {/* amounts row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">יעד (₪)</label>
              <input
                name="targetAmountIls"
                type="number"
                min="0"
                step="100"
                defaultValue={goal?.targetAmountIls ?? ''}
                placeholder="50,000"
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">יתרה נוכחית (₪)</label>
              <input
                name="currentAmountIls"
                type="number"
                min="0"
                step="100"
                defaultValue={goal?.currentAmountIls ?? '0'}
                className="input w-full"
              />
            </div>
          </div>

          {/* contribution + target date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">הפקדה חודשית (₪)</label>
              <input
                name="monthlyContributionIls"
                type="number"
                min="0"
                step="100"
                defaultValue={goal?.monthlyContributionIls ?? ''}
                placeholder="500"
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">תאריך יעד</label>
              <input
                name="targetDate"
                type="date"
                defaultValue={goal?.targetDate ?? ''}
                className="input w-full"
              />
            </div>
          </div>

          {/* status */}
          <div>
            <label className="mb-1 block text-sm font-medium">סטטוס</label>
            <select name="status" defaultValue={goal?.status ?? 'active'} className="input w-full">
              <option value="active">פעיל</option>
              <option value="paused">מושהה</option>
              <option value="completed">הושלם</option>
            </select>
          </div>

          {/* notes */}
          <div>
            <label className="mb-1 block text-sm font-medium">הערות</label>
            <textarea
              name="notes"
              defaultValue={goal?.notes ?? ''}
              rows={2}
              className="input w-full resize-none"
              placeholder="פרטים נוספים..."
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost btn-sm">
              ביטול
            </button>
            <button type="submit" disabled={isPending} className="btn-primary btn-sm">
              {isPending ? 'שומר...' : goal ? 'עדכן יעד' : 'צור יעד'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── quick balance modal ──────────────────────────────────────────────────────

interface QuickBalanceProps {
  goal: GoalRow;
  onClose: () => void;
}

function QuickBalanceModal({ goal, onClose }: QuickBalanceProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set('id', goal.id);
    startTransition(async () => {
      const result = await updateGoalBalance(data);
      if (!result.ok) setError(result.error ?? 'שגיאה');
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">עדכון יתרה – {goal.name}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium">יתרה חדשה (₪)</label>
            <input
              name="currentAmountIls"
              type="number"
              min="0"
              step="100"
              defaultValue={goal.currentAmountIls}
              autoFocus
              required
              className="input w-full text-lg"
            />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost btn-sm">
              ביטול
            </button>
            <button type="submit" disabled={isPending} className="btn-primary btn-sm">
              {isPending ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── delete confirm ───────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  goal: GoalRow;
  onClose: () => void;
}

function DeleteConfirm({ goal, onClose }: DeleteConfirmProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const data = new FormData();
    data.set('id', goal.id);
    startTransition(async () => {
      await deleteGoal(data);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">מחיקת יעד</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            האם למחוק את יעד <strong>{goal.name}</strong>? פעולה זו בלתי הפיכה.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost btn-sm">
              ביטול
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="btn-sm rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              {isPending ? 'מוחק...' : 'מחק'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── goal card ────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: GoalRow;
  onEdit: (g: GoalRow) => void;
  onDelete: (g: GoalRow) => void;
  onUpdateBalance: (g: GoalRow) => void;
}

function GoalCard({ goal, onEdit, onDelete, onUpdateBalance }: GoalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const pct = progressPct(goal.currentAmountIls, goal.targetAmountIls);
  const eta = etaMonths(
    goal.currentAmountIls,
    goal.targetAmountIls,
    goal.monthlyContributionIls,
  );
  const accentColor = goal.color ?? '#10b981';
  const isCompleted = goal.status === 'completed' || pct >= 100;

  return (
    <div
      className={cn(
        'rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
        goal.status === 'paused' && 'opacity-70',
      )}
    >
      {/* top color bar */}
      <div
        className="h-1 rounded-t-xl"
        style={{ backgroundColor: accentColor }}
      />

      <div className="p-4">
        {/* header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <GoalIcon
              name={goal.icon}
              className={cn('size-6 shrink-0', !goal.color && 'text-muted-foreground')}
              style={goal.color ? { color: goal.color } : undefined}
            />
            <div>
              <p className="font-semibold">{goal.name}</p>
              {goal.description && (
                <p className="text-xs text-muted-foreground">{goal.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusIcon status={goal.status} />
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-2xs font-medium',
                goal.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : goal.status === 'paused'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-primary-soft text-primary',
              )}
            >
              {statusLabel(goal.status)}
            </span>
          </div>
        </div>

        {/* amounts */}
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-xl font-bold tabular-nums" style={{ color: accentColor }}>
              {formatIls(goal.currentAmountIls, { decimals: false })}
            </p>
            {goal.targetAmountIls && (
              <p className="text-xs text-muted-foreground">
                מתוך {formatIls(goal.targetAmountIls, { decimals: false })}
              </p>
            )}
          </div>
          {goal.targetAmountIls && (
            <span className="text-2xl font-bold tabular-nums text-muted-foreground">
              {pct}%
            </span>
          )}
        </div>

        {/* progress bar */}
        {goal.targetAmountIls && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                backgroundColor: accentColor,
              }}
            />
          </div>
        )}

        {/* ETA / target date row */}
        {(eta !== null || goal.targetDate || goal.monthlyContributionIls) && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {goal.monthlyContributionIls && (
              <span className="flex items-center gap-1">
                <TrendingUp className="size-3" />
                {formatIls(goal.monthlyContributionIls, { decimals: false })} / חודש
              </span>
            )}
            {eta !== null && eta > 0 && (
              <span className="flex items-center gap-1">
                <Target className="size-3" />
                עוד {eta} חודשים
              </span>
            )}
            {isCompleted && eta === 0 && (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="size-3" />
                יעד הושג!
              </span>
            )}
            {goal.targetDate && (
              <span>יעד: {new Date(goal.targetDate).toLocaleDateString('he-IL', { year: 'numeric', month: 'long' })}</span>
            )}
          </div>
        )}

        {/* expanded notes */}
        {goal.notes && (
          <>
            <button
              className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              הערות
            </button>
            {expanded && (
              <p className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {goal.notes}
              </p>
            )}
          </>
        )}

        {/* action buttons */}
        <div className="mt-3 flex gap-2 border-t pt-3">
          <button
            onClick={() => onUpdateBalance(goal)}
            className="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/80"
          >
            עדכן יתרה
          </button>
          <button
            onClick={() => onEdit(goal)}
            className="rounded-md p-1.5 hover:bg-muted"
            title="עריכה"
          >
            <Pencil className="size-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={() => onDelete(goal)}
            className="rounded-md p-1.5 hover:bg-muted"
            title="מחיקה"
          >
            <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main client component ────────────────────────────────────────────────────

interface SavingsClientProps {
  goals: GoalRow[];
  monthly: MonthlySavingsData | null;
}

export function SavingsClient({ goals, monthly }: SavingsClientProps) {
  const [formGoal, setFormGoal] = useState<GoalRow | 'new' | null>(null);
  const [balanceGoal, setBalanceGoal] = useState<GoalRow | null>(null);
  const [deleteGoalRow, setDeleteGoalRow] = useState<GoalRow | null>(null);

  const active = goals.filter((g) => g.status === 'active');
  const paused = goals.filter((g) => g.status === 'paused');
  const completed = goals.filter((g) => g.status === 'completed');

  // monthly savings rate card
  const savingsRate =
    monthly && monthly.target > 0
      ? Math.min(100, Math.round((monthly.deposited / monthly.target) * 100))
      : null;

  const totalCurrent = goals.filter((g) => g.status !== 'completed').reduce((s, g) => s + g.currentAmountIls, 0);
  const totalTarget = goals.filter((g) => g.status !== 'completed' && g.targetAmountIls !== null).reduce((s, g) => s + (g.targetAmountIls ?? 0), 0);

  return (
    <>
      {/* ── monthly savings rate banner ── */}
      {monthly && (
        <div className="tile flex items-center justify-between gap-4 border-primary/30 bg-primary-soft/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">חיסכון החודש</p>
              <p className="text-lg font-bold tabular-nums">
                {formatIls(monthly.deposited, { decimals: false })}
              </p>
            </div>
          </div>
          {monthly.target > 0 && (
            <div className="text-left">
              <p className="text-xs text-muted-foreground">
                מתוך יעד {formatIls(monthly.target, { decimals: false })}
              </p>
              <p
                className={cn(
                  'text-lg font-bold tabular-nums',
                  savingsRate !== null && savingsRate >= 100
                    ? 'text-emerald-600'
                    : 'text-primary',
                )}
              >
                {savingsRate}%
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── totals summary (if there are active goals) ── */}
      {active.length > 0 && totalTarget > 0 && (
        <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">סה״כ חסכון מצטבר (יעדים פעילים)</span>
          <span className="font-semibold tabular-nums">
            {formatIls(totalCurrent, { decimals: false })}
            {totalTarget > 0 && (
              <span className="text-muted-foreground">
                {' '}/ {formatIls(totalTarget, { decimals: false })}
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── goals grid ── */}
      <div className="space-y-6">
        {/* add button */}
        <div className="flex justify-end">
          <button
            onClick={() => setFormGoal('new')}
            className="btn-primary btn-sm flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            יעד חדש
          </button>
        </div>

        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-card p-12 text-center">
            <PiggyBank className="size-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium">אין יעדי חיסכון עדיין</p>
              <p className="mt-1 text-sm text-muted-foreground">
                הגדר יעד ראשון — קרן חירום, רכב, חופשה, או כל מטרה אחרת
              </p>
            </div>
            <button
              onClick={() => setFormGoal('new')}
              className="btn-primary btn-sm flex items-center gap-1.5"
            >
              <Plus className="size-4" />
              הוסף יעד ראשון
            </button>
          </div>
        ) : (
          <>
            {/* active goals */}
            {active.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">יעדים פעילים</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {active.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onEdit={setFormGoal}
                      onDelete={setDeleteGoalRow}
                      onUpdateBalance={setBalanceGoal}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* paused goals */}
            {paused.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">מושהים</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {paused.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onEdit={setFormGoal}
                      onDelete={setDeleteGoalRow}
                      onUpdateBalance={setBalanceGoal}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* completed goals */}
            {completed.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">הושלמו 🎉</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {completed.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onEdit={setFormGoal}
                      onDelete={setDeleteGoalRow}
                      onUpdateBalance={setBalanceGoal}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── modals ── */}
      {formGoal !== null && (
        <GoalForm
          goal={formGoal === 'new' ? undefined : formGoal}
          onClose={() => setFormGoal(null)}
        />
      )}
      {balanceGoal && (
        <QuickBalanceModal goal={balanceGoal} onClose={() => setBalanceGoal(null)} />
      )}
      {deleteGoalRow && (
        <DeleteConfirm goal={deleteGoalRow} onClose={() => setDeleteGoalRow(null)} />
      )}
    </>
  );
}
