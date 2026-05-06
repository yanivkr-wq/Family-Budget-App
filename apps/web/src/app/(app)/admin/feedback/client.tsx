'use client';

/**
 * Feedback admin: list + status toggles + delete + Markdown export.
 *
 * The export button copies the rendered Markdown to the clipboard
 * AND opens it in a new tab as a data URL so the admin can also
 * download or paste manually.
 */

import { useState, useTransition } from 'react';
import { Trash2, Download, Copy, Check, CheckCircle2, Circle, PlayCircle, X } from 'lucide-react';
import { setFeedbackStatus, deleteFeedback, exportFeedbackMarkdown, type FeedbackRow } from './actions';
import { cn } from '@/lib/utils';

const CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  bug:     { label: 'באג',         className: 'bg-destructive/10 text-destructive' },
  ux:      { label: 'UX',          className: 'bg-amber-100 text-amber-700' },
  feature: { label: 'פיצ׳ר',       className: 'bg-primary/10 text-primary' },
  other:   { label: 'אחר',         className: 'bg-muted text-muted-foreground' },
};
const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  open:        { label: 'פתוח',    className: 'text-muted-foreground',      icon: Circle },
  in_progress: { label: 'בעבודה',  className: 'text-primary',               icon: PlayCircle },
  resolved:    { label: 'נפתר',    className: 'text-success',               icon: CheckCircle2 },
  dismissed:   { label: 'נדחה',    className: 'text-muted-foreground/60',   icon: X },
};

export function FeedbackList({ initial }: { initial: FeedbackRow[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'dismissed'>('all');
  const [includeResolved, setIncludeResolved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const visible = filter === 'all' ? items : items.filter((i) => i.status === filter);

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
    all:         items.length,
    open:        items.filter((i) => i.status === 'open').length,
    in_progress: items.filter((i) => i.status === 'in_progress').length,
    resolved:    items.filter((i) => i.status === 'resolved').length,
    dismissed:   items.filter((i) => i.status === 'dismissed').length,
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar: filter tabs + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-sm">
          {(['all', 'open', 'in_progress', 'resolved', 'dismissed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                filter === f ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {f === 'all' ? 'הכל' : STATUS_BADGE[f]?.label}
              <span className="ms-1 tabular-nums opacity-60">({counts[f]})</span>
            </button>
          ))}
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
            {filter === 'all' ? 'עדיין אין פידבקים. לחץ על כפתור "פידבק" בפינה כדי להוסיף.' : `אין פידבקים בסטטוס "${STATUS_BADGE[filter]?.label}".`}
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
  disabled,
}: {
  item: FeedbackRow;
  onChangeStatus: (id: string, status: FeedbackRow['status']) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const cat = CATEGORY_BADGE[item.category] ?? CATEGORY_BADGE.other!;
  const stat = STATUS_BADGE[item.status] ?? STATUS_BADGE.open!;
  const StatIcon = stat.icon;

  // Visual treatment per status:
  //   • resolved  → soft-green tint + strikethrough on the message
  //   • in_progress → soft-amber tint
  //   • dismissed → grayed-out
  //   • open      → default
  const cardClasses = cn(
    'rounded-md border p-3 transition-colors',
    item.status === 'resolved'    && 'border-success/40 bg-success/5',
    item.status === 'in_progress' && 'border-amber-300/50 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-900/10',
    item.status === 'dismissed'   && 'border-border bg-muted/20 opacity-60',
    (!item.status || item.status === 'open') && 'border-border bg-card',
  );
  const messageClasses = cn(
    'whitespace-pre-wrap text-sm',
    item.status === 'resolved'  && 'line-through text-success/80 decoration-success/50',
    item.status === 'dismissed' && 'line-through text-muted-foreground',
  );

  function copyText() {
    void navigator.clipboard.writeText(item.message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
          {/* Quick status toggles */}
          {item.status !== 'in_progress' && (
            <button onClick={() => onChangeStatus(item.id, 'in_progress')} disabled={disabled} title="סמן כבעבודה" className="rounded-md p-1.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30">
              <PlayCircle className="size-3.5" />
            </button>
          )}
          {item.status !== 'resolved' && (
            <button onClick={() => onChangeStatus(item.id, 'resolved')} disabled={disabled} title="סמן כנפתר" className="rounded-md p-1.5 text-success hover:bg-success/10">
              <CheckCircle2 className="size-3.5" />
            </button>
          )}
          {item.status !== 'dismissed' && (
            <button onClick={() => onChangeStatus(item.id, 'dismissed')} disabled={disabled} title="דחה" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40">
              <X className="size-3.5" />
            </button>
          )}
          {item.status !== 'open' && (
            <button onClick={() => onChangeStatus(item.id, 'open')} disabled={disabled} title="פתח מחדש" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40">
              <Circle className="size-3.5" />
            </button>
          )}
          <button onClick={() => onRemove(item.id)} disabled={disabled} title="מחק" className="rounded-md p-1.5 text-destructive hover:bg-destructive/10">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      <p className={messageClasses}>{item.message}</p>
    </article>
  );
}
