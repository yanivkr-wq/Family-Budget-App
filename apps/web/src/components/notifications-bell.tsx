'use client';

/**
 * Notifications bell — sits in the global header next to the user menu.
 *
 * Polls a server action every 30s for the latest in-app events. Click opens a
 * dropdown listing the most recent N events (sent + read). Each row is
 * clickable: clicking marks the event as read and navigates to the linked
 * /notifications page (or the linked transaction if there is one).
 *
 * Unread badge = count of events in 'sent' state for the current household.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, Check, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import {
  completeTaskFromEvent,
  markAllEventsRead,
  markEventRead,
  snoozeEvent,
} from '@/app/(app)/notifications/actions';

export interface BellEvent {
  id:     string;
  taskId: string;
  title:  string;
  body:   string | null;
  fireAt: string; // ISO
  state:  'pending' | 'sent' | 'failed' | 'skipped' | 'read';
}

interface Props {
  /** Initial server-rendered events (avoids empty state on first paint). */
  initial: BellEvent[];
  /** Server action that returns the latest events for polling. */
  fetcher: () => Promise<BellEvent[]>;
}

export function NotificationsBell({ initial, fetcher }: Props) {
  const [events, setEvents] = useState<BellEvent[]>(initial);
  const [open, setOpen]     = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = events.filter((e) => e.state === 'sent').length;

  // Poll every 30s while page visible.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const fresh = await fetcher();
        if (alive) setEvents(fresh);
      } catch { /* swallow — next tick will retry */ }
    };
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [fetcher]);

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function handleClickEvent(eventId: string) {
    startTransition(async () => {
      await markEventRead(eventId);
      setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, state: 'read' } : e));
    });
  }

  function handleMarkAll() {
    startTransition(async () => {
      await markAllEventsRead();
      setEvents((prev) => prev.map((e) => e.state === 'sent' ? { ...e, state: 'read' } : e));
    });
  }

  function handleComplete(eventId: string) {
    startTransition(async () => {
      const r = await completeTaskFromEvent(eventId);
      if (r.ok) {
        // Clear from list — task is done. The auto-respawned next instance
        // (if any) won't show in the bell until its own fire time.
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
      }
    });
  }

  function handleSnooze(eventId: string, preset: '1h' | '4h' | 'tomorrow' | 'week') {
    startTransition(async () => {
      const r = await snoozeEvent(eventId, preset);
      if (r.ok) {
        // Mark the original as read locally so badge clears. The new
        // (snoozed) event won't show until its fire_at — bell polls every
        // 30s and will pick it up then.
        setEvents((prev) => prev.map((e) => e.id === eventId ? { ...e, state: 'read' } : e));
      }
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted"
        title="התראות"
        aria-label="התראות"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -end-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
            aria-label={`${unreadCount} התראות חדשות`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute end-0 mt-2 w-80 max-h-[420px] overflow-hidden rounded-lg border bg-card shadow-xl z-50"
          dir="rtl"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">התראות</p>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                >
                  <Check className="size-3" /> סמן הכל כנקרא
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-2xs text-accent hover:underline"
              >
                נהל
                <ExternalLink className="size-2.5" />
              </Link>
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                אין התראות עדיין
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {events.map((e) => (
                  <BellEventRow
                    key={e.id}
                    event={e}
                    pending={pending}
                    onClick={() => handleClickEvent(e.id)}
                    onComplete={() => handleComplete(e.id)}
                    onSnooze={(preset) => handleSnooze(e.id, preset)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single row in the bell dropdown. Click anywhere on the body marks it read.
 * Hover reveals two action chips: ✓ (mark task complete) and ⏰ (snooze
 * popover with 4 preset offsets). Action buttons stop click propagation so
 * they don't accidentally trigger the row's mark-read behavior.
 */
function BellEventRow({
  event,
  pending,
  onClick,
  onComplete,
  onSnooze,
}: {
  event: BellEvent;
  pending: boolean;
  onClick: () => void;
  onComplete: () => void;
  onSnooze: (preset: '1h' | '4h' | 'tomorrow' | 'week') => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  return (
    <li
      onClick={onClick}
      className={`group relative w-full cursor-pointer px-3 py-2 transition-colors hover:bg-muted/40 ${
        event.state === 'sent' ? 'bg-accent/5' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {event.state === 'sent' && (
          <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{event.title}</p>
          {event.body && (
            <p className="text-2xs text-muted-foreground line-clamp-2 whitespace-pre-line">
              {event.body}
            </p>
          )}
          <p className="mt-0.5 text-2xs text-muted-foreground/80 tabular-nums">
            {formatRelative(event.fireAt)}
          </p>
        </div>
      </div>

      {/* Action chips — visible on row hover. opacity-0 → opacity-100 keeps
          the row layout stable (no shift when hovering). */}
      <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); onComplete(); }}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-soft px-2 py-0.5 text-2xs text-success hover:bg-success/15 disabled:opacity-50"
          title="סמן את המשימה כבוצעה"
        >
          <CheckCircle2 className="size-3" />
          בוצע
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); setSnoozeOpen((v) => !v); }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
            title="דחה התראה"
          >
            <Clock className="size-3" />
            דחה
          </button>
          {snoozeOpen && (
            <div
              className="absolute end-0 top-full z-10 mt-1 w-32 rounded-md border bg-card shadow-lg"
              onClick={(ev) => ev.stopPropagation()}
            >
              <ul className="py-0.5 text-2xs">
                {[
                  { preset: '1h' as const,       label: 'בעוד שעה' },
                  { preset: '4h' as const,       label: 'בעוד 4 שעות' },
                  { preset: 'tomorrow' as const, label: 'מחר' },
                  { preset: 'week' as const,     label: 'בעוד שבוע' },
                ].map((p) => (
                  <li key={p.preset}>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSnoozeOpen(false);
                        onSnooze(p.preset);
                      }}
                      className="block w-full px-3 py-1.5 text-start hover:bg-muted/40"
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1)   return 'כרגע';
  if (min < 60)  return `לפני ${min} דק'`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `לפני ${hr} שע'`;
  const day = Math.round(hr / 24);
  if (day < 7)   return `לפני ${day} ימים`;
  return new Date(iso).toLocaleDateString('he-IL');
}
