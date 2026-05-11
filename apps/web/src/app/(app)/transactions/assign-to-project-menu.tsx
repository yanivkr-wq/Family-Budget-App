'use client';

/**
 * Tiny floating dropdown for assigning one or many transactions to a
 * project (or removing the existing tag).
 *
 * Used in two places on /transactions:
 *   • Per-row briefcase button (pass `triggerRect` from getBoundingClientRect())
 *   • Bulk-action bar when ≥1 selected
 *
 * Positioning is BOUNDS-AWARE: the menu computes its top/left from the
 * trigger rect and clamps to the viewport with an 8px margin so it
 * never gets clipped at the edge of the screen — even on rows near the
 * bottom of a long table or buttons at the visual-left edge in RTL.
 *
 * Closes on outside click, Esc, or after a successful action.
 */

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { Briefcase, X, FolderMinus } from 'lucide-react';
import Link from 'next/link';
import { assignTransactionsToProject } from '../projects/actions';
import { setTransactionFlags } from './actions';

export interface ProjectOption {
  id:    string;
  name:  string;
  color: string | null;
}

/** Initial state of the per-row flags shown in the menu. Pass undefined for
 *  bulk (multi-row) actions where rows may disagree — the menu then renders
 *  the toggles in an "indeterminate" state and applies the user's choice
 *  to all selected rows on click. */
export interface InitialFlags {
  isTransfer?:               boolean;
  excludedFromTotals?:       boolean;
  includeInMonthlyOverride?: boolean;
}

export function AssignToProjectMenu({
  projects,
  transactionIds,
  showRemove,
  onClose,
  onDone,
  /** Bounding rect of the button that opened the menu. Used to compute
   *  positioning + decide whether to open above/below the trigger. */
  triggerRect,
  /** Initial flag state for the toggles. For single-row use, pass the row's
   *  current values; for multi-row, omit (toggles start indeterminate). */
  initialFlags,
  /** True when the row this menu was opened from has a project tagged.
   *  Controls whether the "כלול גם בסיכומים החודשיים" toggle is shown
   *  (it only makes sense for project-tagged rows). */
  rowHasProject,
}: {
  projects:       ProjectOption[];
  transactionIds: string[];
  showRemove:     boolean;
  onClose:        () => void;
  onDone?:        (updated: number) => void;
  triggerRect:    DOMRect;
  initialFlags?:  InitialFlags;
  rowHasProject?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();
  // Position is computed AFTER first paint so we have the actual rendered
  // size of the menu and can clamp it to the viewport without guessing.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const menuRect = ref.current.getBoundingClientRect();
    const margin   = 8; // keep N px from any viewport edge
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;

    // Vertical: prefer below the trigger; fall back to above if it would
    // overflow the bottom edge.
    let top = triggerRect.bottom + 4;
    if (top + menuRect.height + margin > vh) {
      // Try above the trigger.
      const aboveTop = triggerRect.top - menuRect.height - 4;
      if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        // Neither fits cleanly — clamp to viewport so at least the top
        // is visible (user can scroll the menu's internal overflow).
        top = Math.max(margin, vh - menuRect.height - margin);
      }
    }

    // Horizontal: align the menu's RIGHT edge with the trigger's RIGHT
    // edge (RTL convention — menu drops down from the same visual edge
    // as the button). Then clamp so it stays inside the viewport.
    let left = triggerRect.right - menuRect.width;
    if (left < margin) left = margin;                                  // don't fall off the left
    if (left + menuRect.width + margin > vw) left = vw - menuRect.width - margin;  // or the right

    setPos({ top, left });
  }, [triggerRect]);

  // Close on outside click + Esc.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function pick(projectId: string | null) {
    startTransition(async () => {
      const res = await assignTransactionsToProject(transactionIds, projectId);
      if (res.ok) {
        onDone?.(res.updated);
      }
      onClose();
    });
  }

  // Per-row flag toggles. Each click sends just that one flag to the server
  // (other flags are left untouched). Local state mirrors the change so the
  // checkbox UI updates immediately; revalidation refreshes the row data
  // on next paint.
  const [flags, setFlags] = useState<InitialFlags>({
    isTransfer:               initialFlags?.isTransfer ?? false,
    excludedFromTotals:       initialFlags?.excludedFromTotals ?? false,
    includeInMonthlyOverride: initialFlags?.includeInMonthlyOverride ?? false,
  });
  function toggleFlag(key: keyof InitialFlags) {
    const next = !flags[key];
    setFlags((s) => ({ ...s, [key]: next }));
    startTransition(async () => {
      await setTransactionFlags({ transactionIds, [key]: next });
    });
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 rounded-lg border bg-card shadow-xl"
      dir="rtl"
      // First render: invisible + off-screen so we can measure without flicker.
      // After useLayoutEffect computes pos, swap to the clamped coordinates.
      style={pos
        ? { top: pos.top, left: pos.left, visibility: 'visible' }
        : { top: -9999, left: -9999, visibility: 'hidden' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Briefcase className="size-3.5" />
          תייג לפרויקט
          {transactionIds.length > 1 && (
            <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] text-primary">
              {transactionIds.length}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent/40"
          aria-label="סגור"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-72 overflow-y-auto py-1">
        {projects.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            אין פרויקטים. {' '}
            <Link href="/projects" className="text-primary hover:underline">
              צור פרויקט →
            </Link>
          </div>
        ) : (
          <>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={isPending}
                onClick={() => pick(p.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-right text-sm hover:bg-accent/40 disabled:opacity-50"
              >
                {p.color && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                )}
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* ── Per-row flag toggles ──────────────────────────────────────────
          Quick access to the same three flags the edit modal exposes,
          without forcing the user to open the modal for one-click changes
          while triaging a long list. */}
      <div className="space-y-1.5 border-t bg-muted/20 px-3 py-2.5 text-[11px]">
        <FlagToggle
          checked={!!flags.isTransfer}
          onChange={() => toggleFlag('isTransfer')}
          disabled={isPending}
          label="זוהי העברה בין חשבונות"
          help="כסף שעבר בין שני חשבונות שלך — לא ייחשב כהוצאה/הכנסה בסיכומים."
        />
        <FlagToggle
          checked={!!flags.excludedFromTotals}
          onChange={() => toggleFlag('excludedFromTotals')}
          disabled={isPending}
          label="אל תספור בסיכומים"
          help="התנועה תוצג ברשימה אבל לא תיכלל בשום סיכום (תנועה חשבונאית בלבד)."
        />
        {/* Always visible — user may toggle it BEFORE picking the project
            (set the override + assign in two clicks without re-opening the
            menu). When no project is tagged the flag has no effect, but it
            stays set so the next project assignment respects it. */}
        <FlagToggle
          checked={!!flags.includeInMonthlyOverride}
          onChange={() => toggleFlag('includeInMonthlyOverride')}
          disabled={isPending}
          label="כלול גם בסיכומים החודשיים"
          help="לתנועות פרויקט שאתה רוצה שיופיעו גם בלוח החודשי (capex+opex)."
        />
      </div>

      {/* Footer — remove option (only when at least one is tagged) */}
      {showRemove && (
        <div className="border-t">
          <button
            type="button"
            disabled={isPending}
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <FolderMinus className="size-3.5" />
            הסר תיוג פרויקט
          </button>
        </div>
      )}

      {projects.length > 0 && (
        <div className="border-t px-3 py-1.5">
          <Link
            href="/projects"
            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
          >
            ניהול פרויקטים →
          </Link>
        </div>
      )}
    </div>
  );
}

function FlagToggle({
  checked, onChange, disabled, label, help,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: string;
  help: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-accent/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1">
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground leading-snug">{help}</div>
      </div>
    </label>
  );
}
