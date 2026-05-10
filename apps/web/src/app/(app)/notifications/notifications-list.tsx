'use client';

/**
 * Interactive notification-tasks table.
 *
 * Owns:
 *   • Row checkboxes + toggle-all + bulk action bar (pause / resume / delete)
 *   • Per-row inline status toggle + edit / delete
 *   • Add modal (FAB-style "+ הוסף התראה" button)
 *   • Edit modal (opens when a row is clicked)
 */

import { useMemo, useState, useTransition } from 'react';
import {
  Bell, BellOff, CheckCircle2, Pencil, Plus, Trash2,
  CircleSlash, PlayCircle, X, Mail, MessageCircle, Smartphone, Repeat,
} from 'lucide-react';
import {
  bulkDelete,
  bulkSetStatus,
  deleteNotificationTask,
  setNotificationStatus,
} from './actions';
import { NotificationModal, type NotificationModalSeed, type NotificationContactLite } from './notification-modal';
import type { ReminderChannelPrefs } from '@fba/db';

export interface ReminderRowData {
  id:                  string;
  offsetDays:          number;
  fireTime:            string; // 'HH:MM'
  channels:            ReminderChannelPrefs;
  /** May be null for legacy reminders that pre-date the contacts feature. */
  recipientContactIds: string[] | null;
  enabled:             boolean;
}

export interface NotificationRowData {
  id:                 string;
  title:              string;
  description:        string | null;
  dueDate:            string;
  status:             'active' | 'paused' | 'completed' | 'cancelled';
  recurrence:         'none' | 'monthly' | 'quarterly' | 'yearly';
  categoryId:         string | null;
  transactionId:      string | null;
  /** Optional link to a recurring pattern. Surfaced in the row so the
   *  user knows the reminder is about a subscription / monthly bill. */
  recurringPatternId: string | null;
  /** Display label for the linked pattern (merchant). Resolved
   *  server-side so the row doesn't have to look it up. */
  recurringPatternLabel: string | null;
  reminders:          ReminderRowData[];
}

interface Cat { id: string; nameHe: string; color: string | null }
interface RecentTxn { id: string; merchant: string; amount: number; date: string }

const STATUS_LABEL: Record<NotificationRowData['status'], string> = {
  active:    'פעיל',
  paused:    'מושהה',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const RECURRENCE_LABEL: Record<NotificationRowData['recurrence'], string> = {
  none:      'חד-פעמי',
  monthly:   'חודשי',
  quarterly: 'רבעוני',
  yearly:    'שנתי',
};

const STATUS_TONE: Record<NotificationRowData['status'], string> = {
  active:    'bg-success/10 text-success',
  paused:    'bg-warning/10 text-warning',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function NotificationsList({
  tasks,
  categories,
  recentTransactions,
  contacts,
}: {
  tasks: NotificationRowData[];
  categories: Cat[];
  recentTransactions: RecentTxn[];
  /** Household contacts available as recipients in the modal. */
  contacts: NotificationContactLite[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<NotificationModalSeed | null | undefined>(undefined);
  // undefined = closed; null = create-mode; object = edit-mode
  const [pending, startTransition] = useTransition();

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const txnMap = useMemo(() => new Map(recentTransactions.map((t) => [t.id, t])), [recentTransactions]);

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && selected.size < tasks.length;

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(tasks.map((t) => t.id)) : new Set());
  }
  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function onSingleStatus(id: string, status: NotificationRowData['status']) {
    startTransition(async () => {
      await setNotificationStatus(id, status);
    });
  }
  function onSingleDelete(id: string) {
    if (!confirm('למחוק את ההתראה?')) return;
    startTransition(async () => {
      await deleteNotificationTask(id);
    });
  }
  function onBulkStatus(status: NotificationRowData['status']) {
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkSetStatus(ids, status);
      clearSelection();
    });
  }
  function onBulkDelete() {
    const ids = Array.from(selected);
    if (!confirm(`למחוק ${ids.length} התראות?`)) return;
    startTransition(async () => {
      await bulkDelete(ids);
      clearSelection();
    });
  }

  return (
    <>
      {/* Header bar: bulk actions OR add button */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
          <span className="text-sm font-medium">
            {selected.size} נבחרו
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onBulkStatus('paused')}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
            >
              <CircleSlash className="size-3" /> השהה
            </button>
            <button
              type="button"
              onClick={() => onBulkStatus('active')}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
            >
              <PlayCircle className="size-3" /> הפעל
            </button>
            <button
              type="button"
              onClick={() => onBulkStatus('completed')}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
            >
              <CheckCircle2 className="size-3" /> סמן כהושלם
            </button>
            <button
              type="button"
              onClick={onBulkDelete}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              <Trash2 className="size-3" /> מחק
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex items-center gap-1 rounded-md p-1 text-muted-foreground hover:bg-muted/40"
              title="בטל בחירה"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {tasks.length === 0 ? 'אין התראות' : `${tasks.length} התראות סך הכל`}
          </p>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            הוסף התראה
          </button>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          לחצי על &ldquo;הוסף התראה&rdquo; כדי להתחיל. דוגמאות: ארנונה, ביטוח, חידוש דרכון, פגישה עם רואה חשבון.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => toggleAll(e.currentTarget.checked)}
                    className="size-4"
                    aria-label="בחר הכל"
                  />
                </th>
                <th className="border-b px-3 py-2 font-medium">משימה</th>
                <th className="border-b px-3 py-2 font-medium">תאריך יעד</th>
                <th className="border-b px-3 py-2 font-medium">חזרה</th>
                <th className="border-b px-3 py-2 font-medium">תזכורות</th>
                <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
                <th className="border-b px-3 py-2 font-medium">סטטוס</th>
                <th className="border-b px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const cat = t.categoryId ? catMap.get(t.categoryId) : null;
                const txn = t.transactionId ? txnMap.get(t.transactionId) : null;
                const isPaused = t.status === 'paused';
                const isInactive = t.status === 'completed' || t.status === 'cancelled';
                const isSelected = selected.has(t.id);

                return (
                  <tr
                    key={t.id}
                    className={`border-b last:border-0 ${isSelected ? 'bg-accent/5' : 'hover:bg-muted/30'} ${isInactive ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleOne(t.id, e.currentTarget.checked)}
                        className="size-4"
                        aria-label={`בחר ${t.title}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{t.title}</div>
                      {t.description && (
                        <div className="text-[11px] text-muted-foreground line-clamp-1" title={t.description}>
                          {t.description}
                        </div>
                      )}
                      {txn && (
                        <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                          קושר לתנועה: {txn.merchant}
                        </div>
                      )}
                      {t.recurringPatternLabel && (
                        <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                          קושר לקבוע: {t.recurringPatternLabel}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">{t.dueDate}</td>
                    <td className="px-3 py-2 text-xs">
                      {t.recurrence === 'none' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-2xs text-accent">
                          <Repeat className="size-2.5" aria-hidden /> {RECURRENCE_LABEL[t.recurrence]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ReminderSummary reminders={t.reminders} />
                    </td>
                    <td className="px-3 py-2">
                      {cat ? (
                        <span
                          className="pill text-xs"
                          style={{ backgroundColor: `${cat.color}25`, color: cat.color ?? undefined }}
                        >
                          {cat.nameHe}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[t.status]}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onSingleStatus(t.id, isPaused ? 'active' : 'paused')}
                          disabled={pending || isInactive}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40 disabled:opacity-30"
                          title={isPaused ? 'הפעל' : 'השהה'}
                          aria-label={isPaused ? 'הפעל' : 'השהה'}
                        >
                          {isPaused ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(toSeed(t))}
                          className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                          title="ערוך"
                          aria-label="ערוך"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onSingleDelete(t.id)}
                          disabled={pending}
                          className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                          title="מחק"
                          aria-label="מחק"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <NotificationModal
          seed={editing}
          categories={categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          contacts={contacts}
          recentTransactions={recentTransactions}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

function toSeed(t: NotificationRowData): NotificationModalSeed {
  return {
    id:                 t.id,
    title:              t.title,
    description:        t.description,
    dueDate:            t.dueDate,
    status:             t.status,
    recurrence:         t.recurrence,
    categoryId:         t.categoryId,
    transactionId:      t.transactionId,
    recurringPatternId: t.recurringPatternId,
    reminders:          t.reminders.map((r) => ({
      offsetDays:          r.offsetDays,
      fireTime:            r.fireTime,
      channels:            { ...r.channels },
      recipientContactIds: r.recipientContactIds ?? undefined,
      enabled:             r.enabled,
    })),
  };
}

function ReminderSummary({ reminders }: { reminders: ReminderRowData[] }) {
  if (reminders.length === 0) {
    return <span className="text-muted-foreground text-xs">ללא</span>;
  }
  return (
    <div className="space-y-0.5">
      {reminders.slice(0, 3).map((r) => (
        <div key={r.id} className="flex items-center gap-1.5 text-2xs">
          <span className={`tabular-nums ${r.enabled ? '' : 'line-through text-muted-foreground'}`}>
            {r.offsetDays === 0 ? 'ביום' : `${r.offsetDays}י׳ לפני`} · {r.fireTime}
          </span>
          <span className="flex items-center gap-0.5 text-muted-foreground">
            {r.channels.in_app   && <Smartphone className="size-2.5" aria-label="in-app" />}
            {r.channels.email    && <Mail className="size-2.5" aria-label="email" />}
            {r.channels.whatsapp && <MessageCircle className="size-2.5" aria-label="whatsapp" />}
          </span>
        </div>
      ))}
      {reminders.length > 3 && (
        <p className="text-2xs text-muted-foreground">+ {reminders.length - 3} נוספות</p>
      )}
    </div>
  );
}
