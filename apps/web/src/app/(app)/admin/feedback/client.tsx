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
        {visible.map((it) => {
          const cat = CATEGORY_BADGE[it.category] ?? CATEGORY_BADGE.other!;
          const stat = STATUS_BADGE[it.status] ?? STATUS_BADGE.open!;
          const StatIcon = stat.icon;
          return (
            <article
              key={it.id}
              className={cn(
                'rounded-md border bg-card p-3',
                (it.status === 'resolved' || it.status === 'dismissed') && 'opacity-60',
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className={cn('rounded-full px-2 py-0.5 font-medium', cat.className)}>{cat.label}</span>
                  <span className={cn('inline-flex items-center gap-1', stat.className)}>
                    <StatIcon className="size-3" />
                    {stat.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(it.createdAt).toLocaleString('he-IL', {
                      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  {it.pagePath && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{it.pagePath}</code>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* Quick status toggles */}
                  {it.status !== 'in_progress' && (
                    <button onClick={() => changeStatus(it.id, 'in_progress')} disabled={isPending} title="סמן כבעבודה" className="rounded-md p-1.5 text-primary hover:bg-primary/10">
                      <PlayCircle className="size-3.5" />
                    </button>
                  )}
                  {it.status !== 'resolved' && (
                    <button onClick={() => changeStatus(it.id, 'resolved')} disabled={isPending} title="סמן כנפתר" className="rounded-md p-1.5 text-success hover:bg-success/10">
                      <CheckCircle2 className="size-3.5" />
                    </button>
                  )}
                  {it.status !== 'dismissed' && (
                    <button onClick={() => changeStatus(it.id, 'dismissed')} disabled={isPending} title="דחה" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40">
                      <X className="size-3.5" />
                    </button>
                  )}
                  {it.status !== 'open' && (
                    <button onClick={() => changeStatus(it.id, 'open')} disabled={isPending} title="פתח מחדש" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40">
                      <Circle className="size-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(it.id)} disabled={isPending} title="מחק" className="rounded-md p-1.5 text-destructive hover:bg-destructive/10">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm">{it.message}</p>
            </article>
          );
        })}
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
