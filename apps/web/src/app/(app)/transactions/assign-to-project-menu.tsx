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

export interface ProjectOption {
  id:    string;
  name:  string;
  color: string | null;
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
}: {
  projects:       ProjectOption[];
  transactionIds: string[];
  showRemove:     boolean;
  onClose:        () => void;
  onDone?:        (updated: number) => void;
  triggerRect:    DOMRect;
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
