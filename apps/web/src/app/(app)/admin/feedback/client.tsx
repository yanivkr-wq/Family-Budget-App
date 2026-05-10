'use client';

/**
 * Feedback admin: list + status toggles + delete + Markdown export.
 *
 * The export button copies the rendered Markdown to the clipboard
 * AND opens it in a new tab as a data URL so the admin can also
 * download or paste manually.
 */

import { useState, useTransition } from 'react';
import {
  Trash2, Download, Copy, Check, Pencil,
  Inbox, Hammer, Eye, CircleCheck, Ban, RotateCcw,
} from 'lucide-react';
import { setFeedbackStatus, deleteFeedback, exportFeedbackMarkdown, updateFeedback, type FeedbackRow } from './actions';
import { cn } from '@/lib/utils';

const CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  bug:     { label: 'באג',         className: 'bg-destructive/10 text-destructive' },
  ux:      { label: 'UX',          className: 'bg-amber-100 text-amber-700' },
  feature: { label: 'פיצ׳ר',       className: 'bg-primary/10 text-primary' },
  other:   { label: 'אחר',         className: 'bg-muted text-muted-foreground' },
};
// Status visual map. Each row carries:
//   • Hebrew label (shown on the badge)
//   • Tone class for the icon + label
//   • Icon component — chosen so the meaning reads at a glance:
//     Inbox = "still in the queue, untouched"
//     Hammer = "being worked on"
//     Eye = "ready, waiting for the user to verify"
//     CircleCheck = "verified + done"
//     Ban = "won't fix / dismissed"
const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  open:               { label: 'פתוח',           className: 'text-muted-foreground',    icon: Inbox },
  in_progress:        { label: 'בעבודה',         className: 'text-primary',             icon: Hammer },
  pending_validation: { label: 'ממתין לאימות',   className: 'text-amber-600 dark:text-amber-400', icon: Eye },
  resolved:           { label: 'נפתר',           className: 'text-success',             icon: CircleCheck },
  dismissed:           { label: 'נדחה',          className: 'text-muted-foreground/60', icon: Ban },
};

type FilterStatus = FeedbackRow['status'];
const ALL_STATUSES: FilterStatus[] = ['open', 'in_progress', 'pending_validation', 'resolved', 'dismissed'];

export function FeedbackList({ initial }: { initial: FeedbackRow[] }) {
  const [items, setItems] = useState(initial);
  // Multi-select status filter — empty Set means "show all". Stored as Set
  // so the user can stack any combination ("in_progress + pending_validation"
  // or "open + pending + in_progress" etc.).
  const [activeStatuses, setActiveStatuses] = useState<Set<FilterStatus>>(new Set());
  const [includeResolved, setIncludeResolved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // No active filter = show all; otherwise filter to the selected statuses.
  const visible = activeStatuses.size === 0
    ? items
    : items.filter((i) => activeStatuses.has(i.status));

  function toggleStatus(s: FilterStatus) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  function clearFilter() { setActiveStatuses(new Set()); }

  function changeStatus(id: string, status: FeedbackRow['status']) {
    startTransition(async () => {
      await setFeedbackStatus(id, status);
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, status, resolvedAt: (status === 'resolved' || status === 'dismissed') ? new Date().toISOString() : null } : it));
    });
  }

  function remove(id: string) {
    if (!confirm('למחוק את הפידבק?')) return;
    startTransition(async () => {
      await deleteFeedback(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
    });
  }

  function saveEdit(id: string, message: string, category: FeedbackRow['category']): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const r = await updateFeedback(id, message, category);
        if (r.ok) {
          setItems((prev) => prev.map((it) => (it.id === id ? { ...it, message: message.trim(), category } : it)));
        }
        resolve(r);
      });
    });
  }

  async function exportMarkdown() {
    setExporting(true);
    try {
      const statuses: FeedbackRow['status'][] = includeResolved
        ? ['open', 'in_progress', 'resolved', 'dismissed']
        : ['open', 'in_progress'];
      const md = await exportFeedbackMarkdown(statuses);
      // Copy to clipboard
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Also offer download
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const counts = {
    all:                items.length,
    open:               items.filter((i) => i.status === 'open').length,
    in_progress:        items.filter((i) => i.status === 'in_progress').length,
    pending_validation: items.filter((i) => i.status === 'pending_validation').length,
    resolved:           items.filter((i) => i.status === 'resolved').length,
    dismissed:          items.filter((i) => i.status === 'dismissed').length,
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar: filter chips (multi-select) + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1 text-sm">
          {/* "All" chip — clears the multi-select. Active when no statuses selected. */}
          <button
            onClick={clearFilter}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors',
              activeStatuses.size === 0
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            הכל
            <span className="ms-1 tabular-nums opacity-60">({counts.all})</span>
          </button>
          {/* Per-status chips — each toggles independently. Icon shown next to
              the label so the meaning is recognizable at a glance even
              without reading the Hebrew. */}
          {ALL_STATUSES.map((s) => {
            const meta = STATUS_BADGE[s]!;
            const Icon = meta.icon;
            const isActive = activeStatuses.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                aria-pressed={isActive}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : cn('hover:bg-accent/50', meta.className),
                )}
              >
                <Icon className="size-3" />
                {meta.label}
                <span className={cn('ms-1 tabular-nums', isActive ? 'opacity-80' : 'opacity-60')}>
                  ({counts[s]})
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
            כלול סגורים
          </label>
          <button
            onClick={exportMarkdown}
            disabled={exporting || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            title="ייצא כ-Markdown והעתק ללוח (להדבקה ב-Claude Code)"
          >
            {copied ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
            {copied ? 'הועתק!' : 'ייצא Markdown'}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {visible.length === 0 && (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {activeStatuses.size === 0
              ? 'עדיין אין פידבקים. לחץ על כפתור "פידבק" בפינה כדי להוסיף.'
              : `אין פידבקים בסטטוסים שנבחרו: ${[...activeStatuses].map((s) => STATUS_BADGE[s]?.label).join(', ')}.`}
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {visible.map((it) => (
          <FeedbackCard
            key={it.id}
            item={it}
            onChangeStatus={changeStatus}
            onRemove={remove}
            onSaveEdit={saveEdit}
            disabled={isPending}
          />
        ))}
      </div>

      {items.length > 0 && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1 flex items-center gap-1.5">
            <Copy className="size-3" />
            <strong>טיפ:</strong> &quot;ייצא Markdown&quot; מעתיק את הרשימה ללוח ההדבקה ושומר קובץ <code className="rounded bg-muted px-1 font-mono">.md</code>.
            הדבק את התוכן ישירות ב-Claude Code session כדי לעבוד על השיפורים.
          </p>
        </div>
      )}
    </div>
  );
}

/** One feedback row — extracted so we can hold per-item local state
 *  (the copied indicator) without rerendering the whole list on every
 *  copy click. */
function FeedbackCard({
  item,
  onChangeStatus,
  onRemove,
  onSaveEdit,
  disabled,
}: {
  item: FeedbackRow;
  onChangeStatus: (id: string, status: FeedbackRow['status']) => void;
  onRemove: (id: string) => void;
  onSaveEdit: (id: string, message: string, category: FeedbackRow['category']) => Promise<{ ok: boolean; error?: string }>;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftMessage, setDraftMessage] = useState(item.message);
  const [draftCategory, setDraftCategory] = useState<FeedbackRow['category']>(item.category);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cat = CATEGORY_BADGE[item.category] ?? CATEGORY_BADGE.other!;
  const stat = STATUS_BADGE[item.status] ?? STATUS_BADGE.open!;
  const StatIcon = stat.icon;

  function startEditing() {
    setDraftMessage(item.message);
    setDraftCategory(item.category);
    setSaveError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }
  async function commitEdit() {
    const r = await onSaveEdit(item.id, draftMessage, draftCategory);
    if (r.ok) setEditing(false);
    else setSaveError(r.error ?? 'שגיאה');
  }

  // Visual treatment per status:
  //   • resolved  → soft-green tint + strikethrough on the message
  //   • in_progress → soft-amber tint
  //   • dismissed → grayed-out
  //   • open      → default
  const cardClasses = cn(
    'rounded-md border p-3 transition-colors',
    item.status === 'resolved'           && 'border-success/40 bg-success/5',
    item.status === 'in_progress'        && 'border-primary/40 bg-primary/5',
    item.status === 'pending_validation' && 'border-amber-300/50 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-900/10',
    item.status === 'dismissed'          && 'border-border bg-muted/20 opacity-60',
    (!item.status || item.status === 'open') && 'border-border bg-card',
  );
  const messageClasses = cn(
    'whitespace-pre-wrap text-sm',
    item.status === 'resolved'  && 'line-through text-success/80 decoration-success/50',
    item.status === 'dismissed' && 'line-through text-muted-foreground',
  );

  /**
   * Copy the feedback message to the clipboard. When the item has an
   * attached screenshot, ALSO copy the image as a clipboard ClipboardItem
   * so the user can paste either the text OR the image into other apps
   * (e.g. paste the text into Claude Code, then paste the image too).
   *
   * Uses the modern ClipboardItem API. Falls back to text-only when the
   * browser doesn't support multi-format clipboard writes.
   */
  function copyText() {
    const text = item.message;
    const trySetCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };

    // No screenshot → simple text copy.
    if (!item.screenshotData) {
      void navigator.clipboard.writeText(text).then(trySetCopied);
      return;
    }

    // Screenshot present + browser supports ClipboardItem → write both.
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      // Convert the data URI to a Blob the clipboard accepts as image/png.
      void fetch(item.screenshotData)
        .then((res) => res.blob())
        .then((blob) =>
          navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob,
              'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
          ]),
        )
        .then(trySetCopied)
        .catch(() => {
          // Fall back to text-only on any failure (e.g. cross-origin blob
          // restrictions, browser API quirks).
          void navigator.clipboard.writeText(text).then(trySetCopied);
        });
    } else {
      void navigator.clipboard.writeText(text).then(trySetCopied);
    }
  }

  return (
    <article className={cardClasses}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-medium', cat.className)}>{cat.label}</span>
          <span className={cn('inline-flex items-center gap-1', stat.className)}>
            <StatIcon className="size-3" />
            {stat.label}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {new Date(item.createdAt).toLocaleString('he-IL', {
              year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            })}
          </span>
          {item.pagePath && (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{item.pagePath}</code>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Edit feedback */}
          {!editing && (
            <button
              onClick={startEditing}
              disabled={disabled}
              title="ערוך"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {/* Copy message text — quick paste into Claude Code */}
          <button
            onClick={copyText}
            title={copied ? 'הועתק' : 'העתק את הטקסט'}
            className={cn(
              'rounded-md p-1.5',
              copied ? 'text-success' : 'text-muted-foreground hover:bg-accent/40',
            )}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
          {/* Status transition buttons. Each button uses a distinctive icon
              + descriptive tooltip so the meaning is unambiguous on hover.
              Hidden when the item is already in that status. */}
          {item.status !== 'in_progress' && (
            <button
              onClick={() => onChangeStatus(item.id, 'in_progress')}
              disabled={disabled}
              title="סמן כבעבודה"
              className="rounded-md p-1.5 text-primary hover:bg-primary/10"
            >
              <Hammer className="size-3.5" />
            </button>
          )}
          {item.status !== 'pending_validation' && item.status !== 'resolved' && item.status !== 'dismissed' && (
            <button
              onClick={() => onChangeStatus(item.id, 'pending_validation')}
              disabled={disabled}
              title="ממתין לאימות (לבדיקה לפני סגירה)"
              className="rounded-md p-1.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
            >
              <Eye className="size-3.5" />
            </button>
          )}
          {item.status !== 'resolved' && (
            <button
              onClick={() => onChangeStatus(item.id, 'resolved')}
              disabled={disabled}
              title="סמן כנפתר ומאומת"
              className="rounded-md p-1.5 text-success hover:bg-success/10"
            >
              <CircleCheck className="size-3.5" />
            </button>
          )}
          {item.status !== 'dismissed' && (
            <button
              onClick={() => onChangeStatus(item.id, 'dismissed')}
              disabled={disabled}
              title="דחה (לא יתוקן)"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40"
            >
              <Ban className="size-3.5" />
            </button>
          )}
          {item.status !== 'open' && (
            <button
              onClick={() => onChangeStatus(item.id, 'open')}
              disabled={disabled}
              title="החזר לפתוח"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
          <button onClick={() => onRemove(item.id)} disabled={disabled} title="מחק" className="rounded-md p-1.5 text-destructive hover:bg-destructive/10">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <select
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as FeedbackRow['category'])}
            disabled={disabled}
            className="rounded-md border bg-card px-2 py-1 text-xs"
          >
            {(['bug', 'ux', 'feature', 'other'] as const).map((c) => (
              <option key={c} value={c}>{CATEGORY_BADGE[c]?.label}</option>
            ))}
          </select>
          {/* dir="auto" lets the browser pick LTR/RTL per the first strong character —
              English text aligns left even when the surrounding UI is RTL. */}
          <textarea
            dir="auto"
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
            disabled={disabled}
            rows={Math.min(10, Math.max(3, draftMessage.split('\n').length + 1))}
            className="w-full rounded-md border bg-card px-2 py-1 text-sm font-sans"
            style={{ textAlign: 'start' }}
          />
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={commitEdit}
              disabled={disabled || !draftMessage.trim()}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              שמור
            </button>
            <button
              onClick={cancelEdit}
              disabled={disabled}
              className="rounded-md border px-3 py-1 text-xs"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* dir="auto" handles English-vs-Hebrew alignment automatically. */}
          <p dir="auto" className={messageClasses} style={{ textAlign: 'start' }}>
            {item.message}
          </p>
          {/* Attached screenshot — clickable to expand to full size in a
              new tab. The thumbnail is bounded so a tall screenshot
              doesn't dominate the card. */}
          {item.screenshotData && (
            <a
              href={item.screenshotData}
              target="_blank"
              rel="noopener noreferrer"
              title="לחץ להגדלה בלשונית חדשה"
              className="mt-2 block overflow-hidden rounded-md border bg-muted/30 transition-shadow hover:shadow-md"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.screenshotData}
                alt="screenshot attached to feedback"
                className="block max-h-64 w-full object-contain"
              />
            </a>
          )}
        </>
      )}
    </article>
  );
}
