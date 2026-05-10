'use client';

/**
 * Interactive recurring-patterns table. Server-component page.tsx loads the
 * data and hands it to this client island, which owns:
 *   • The "Add new" button + add modal
 *   • Per-row edit / delete / pause-resume buttons + edit modal
 *
 * Display logic stays close to the original server-side render so the table
 * looks identical — just with extra action buttons on each row.
 */

import { useEffect, useState, useTransition } from 'react';
import { Bell, BellPlus, Pencil, Plus, Trash2, PauseCircle, PlayCircle, Loader2 } from 'lucide-react';
import { formatIls } from '@fba/shared';
import { cn } from '@/lib/utils';
import { RecurringModal, type RecurringPatternRow } from './recurring-modal';
import { createReminderForAllPatterns, deleteRecurringPattern, setRecurringStatus } from './actions';
import { NotificationModal, type NotificationModalSeed, type NotificationContactLite } from '../notifications/notification-modal';

interface Cat { id: string; nameHe: string; color: string | null }

const FREQ_LABEL: Record<string, string> = {
  monthly:   'חודשי',
  bimonthly: 'דו-חודשי',
  quarterly: 'רבעוני',
  yearly:    'שנתי',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  ended:  'הסתיים',
};

export function RecurringList({
  patterns,
  categories,
  patternIdsWithNotifications,
  notificationContacts,
}: {
  patterns: Array<RecurringPatternRow & {
    lastSeenMonth:    string;
    occurrenceCount:  number;
  }>;
  categories: Cat[];
  /** Pattern IDs that already have a non-completed notification attached.
   *  Drives the colored bell column. */
  patternIdsWithNotifications: string[];
  /** Household contacts for the per-row "set reminder" modal. */
  notificationContacts: NotificationContactLite[];
}) {
  const [modalPattern, setModalPattern] = useState<RecurringPatternRow | null | undefined>(undefined);
  // undefined = closed; null = create mode; object = edit mode
  const [isPending, startTransition] = useTransition();

  // Notification modal state — opened by clicking the per-row bell.
  const [notifySeed, setNotifySeed] = useState<NotificationModalSeed | null>(null);
  const [notifyPatternId, setNotifyPatternId] = useState<string | null>(null);
  const [batchPending, batchStartTransition] = useTransition();
  const [batchResult, setBatchResult] = useState<{ created: number; skipped: number } | null>(null);
  const [patternsWithNotifications, setPatternsWithNotifications] = useState<Set<string>>(
    () => new Set(patternIdsWithNotifications),
  );
  // Re-sync from the server prop whenever it changes (after revalidation
  // or back-nav).
  useEffect(() => {
    setPatternsWithNotifications(new Set(patternIdsWithNotifications));
  }, [patternIdsWithNotifications]);

  const catMap = new Map(categories.map((c) => [c.id, c]));

  function onDelete(id: string) {
    if (!confirm('למחוק את התבנית?')) return;
    startTransition(async () => {
      await deleteRecurringPattern(id);
    });
  }

  function onToggleStatus(id: string, current: string) {
    const next = current === 'active' ? 'paused' : 'active';
    startTransition(async () => {
      await setRecurringStatus(id, next);
    });
  }

  /** Batch-create reminders for every active pattern that doesn't already
   *  have one. Smart defaults per pattern (end_date → cancellation timeline,
   *  no end_date → payment-day timeline). */
  function onBatchCreateReminders() {
    if (!confirm('ליצור התראות חכמות לכל המנויים הפעילים שעדיין אין להם התראה?')) return;
    setBatchResult(null);
    batchStartTransition(async () => {
      const r = await createReminderForAllPatterns();
      if (r.ok) {
        setBatchResult({ created: r.created, skipped: r.skipped });
        // Optimistically mark all patterns as having notifications (the
        // server has revalidated /recurring already; the prop sync effect
        // will reconcile precisely in a moment).
        if (r.created > 0) {
          setPatternsWithNotifications(new Set(patterns.map((p) => p.id)));
        }
      }
    });
  }

  /**
   * Build a notification seed for the given recurring pattern. Picks smart
   * defaults so the user can usually just hit "save":
   *
   *   • Title: pattern label + monthly amount
   *   • Description: structured context the email body will include
   *   • Due date:
   *       - if pattern has subscription_end_date → use that (cancellation
   *         decision is the actionable moment)
   *       - else → today + N days based on frequency (monthly = 30,
   *         quarterly = 90, etc.) — placeholder the user can adjust
   *   • Reminders:
   *       - subscription with end-date: 14d / 7d / 0d before (cancellation)
   *       - regular monthly bill: 3d / 1d / 0d before (payment)
   */
  function buildNotificationSeed(p: typeof patterns[number]): NotificationModalSeed {
    const amt = Math.abs(Number(p.expectedAmountIls));
    const isIncome = Number(p.expectedAmountIls) >= 0;
    const freqLabel = FREQ_LABEL[p.frequency] ?? p.frequency;

    const hasEndDate = !!p.subscriptionEndDate;
    const dueDate = hasEndDate ? p.subscriptionEndDate! : addDaysIso(new Date(), freqDaysAhead(p.frequency));

    const titlePrefix = isIncome ? 'הכנסה צפויה' : 'תשלום';
    const title = `${titlePrefix}: ${p.merchantNormalized} · ${formatIls(amt, { decimals: false })}`;

    const descLines: string[] = [];
    if (p.description) descLines.push(p.description);
    descLines.push(`סכום צפוי: ${formatIls(amt, { decimals: false })} · תדירות: ${freqLabel}`);
    if (hasEndDate) {
      const action = p.autoRenew
        ? 'מתחדש אוטומטית — בטל לפני תאריך זה אם לא רוצה להמשיך'
        : 'לא מתחדש אוטומטית — אישור חידוש ידני אם רלוונטי';
      descLines.push(action);
      if (p.cancelNoticeDays > 0) {
        descLines.push(`דרושים ${p.cancelNoticeDays} ימי הודעה לביטול`);
      }
    }

    // Reminder strategy: if there's an end-date, optimize for the cancel
    // decision (long lead time). Otherwise optimize for "don't forget to
    // pay" (short lead time).
    const reminders = hasEndDate
      ? [
          { offsetDays: 14, fireTime: '09:00', channels: { in_app: true, email: true,  whatsapp: false }, enabled: true },
          { offsetDays: 7,  fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, enabled: true },
          { offsetDays: 0,  fireTime: '09:00', channels: { in_app: true, email: true,  whatsapp: false }, enabled: true },
        ]
      : [
          { offsetDays: 3, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, enabled: true },
          { offsetDays: 1, fireTime: '09:00', channels: { in_app: true, email: true,  whatsapp: false }, enabled: true },
          { offsetDays: 0, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, enabled: true },
        ];

    // Map the pattern's frequency to a notification recurrence value so
    // marking a payment "done" auto-creates the next month's reminder.
    // 'bimonthly' has no notification equivalent (we don't surface that
    // option in the UI) — fall through to 'none' and let the user adjust.
    const recurrence: NotificationModalSeed['recurrence'] =
      p.frequency === 'monthly'   ? 'monthly' :
      p.frequency === 'quarterly' ? 'quarterly' :
      p.frequency === 'yearly'    ? 'yearly' :
                                    'none';

    return {
      title,
      description:        descLines.join(' · '),
      dueDate,
      status:             'active',
      recurrence,
      categoryId:         p.categoryId,
      transactionId:      null,
      recurringPatternId: p.id,
      reminders,
    };
  }

  return (
    <>
      {/* Add button + batch-create-reminders + count */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {patterns.length === 0 ? 'אין תבניות' : `${patterns.length} תבניות סך הכל`}
          {batchResult && (
            <span className="ms-2 text-2xs text-success">
              ✓ נוצרו {batchResult.created} התראות חדשות
              {batchResult.skipped > 0 ? ` (${batchResult.skipped} נכשלו)` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Batch-create reminders for all patterns missing one. Doesn't
              open the modal — uses smart defaults per pattern (end_date
              → cancellation timeline; no end_date → payment-day timeline). */}
          <button
            type="button"
            onClick={onBatchCreateReminders}
            disabled={batchPending || patterns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            title="צור התראות חכמות לכל המנויים הפעילים שעדיין אין להם התראה"
          >
            {batchPending ? <Loader2 className="size-3.5 animate-spin" /> : <BellPlus className="size-3.5" />}
            צור התראות לכולם
          </button>
          <button
            type="button"
            onClick={() => setModalPattern(null)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            הוסף הוצאה קבועה
          </button>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          לחץ על &ldquo;הוסף הוצאה קבועה&rdquo; כדי להתחיל. דוגמאות: ארנונה, פלאפון, נטפליקס, משכנתא.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-3 py-2 font-medium">בית עסק</th>
                <th className="border-b px-3 py-2 font-medium">קטגוריה</th>
                <th className="border-b px-3 py-2 font-medium">סכום צפוי</th>
                <th className="border-b px-3 py-2 font-medium">תדירות</th>
                <th className="border-b px-3 py-2 font-medium">חודש אחרון</th>
                <th className="border-b px-3 py-2 font-medium">הופעות</th>
                <th className="border-b px-3 py-2 font-medium">תאריך סיום</th>
                <th className="border-b px-3 py-2 font-medium">סטטוס</th>
                <th className="border-b px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => {
                const cat = p.categoryId ? catMap.get(p.categoryId) : null;
                const amt = Number(p.expectedAmountIls);
                const isIncome = amt >= 0;
                const isPaused = p.status === 'paused';
                return (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.merchantNormalized}</div>
                      {p.description && (
                        <div className="text-[11px] text-muted-foreground" title={p.description}>
                          {p.description}
                        </div>
                      )}
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
                    <td className={`px-3 py-2 tabular-nums ${isIncome ? 'text-success font-medium' : ''}`}>
                      {p.amountMode === 'dynamic' ? (
                        <span className="text-muted-foreground italic">דינמי</span>
                      ) : p.amountMode === 'range' && p.minAmountIls != null && p.maxAmountIls != null ? (
                        <div className="flex flex-col leading-tight">
                          <span>
                            {isIncome ? '+' : '−'}{formatIls(Math.abs(Number(p.minAmountIls)), { decimals: false })}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            עד {formatIls(Math.abs(Number(p.maxAmountIls)), { decimals: false })}
                          </span>
                        </div>
                      ) : (
                        <>{isIncome ? '+' : '−'}{formatIls(Math.abs(amt), { decimals: false })}</>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {FREQ_LABEL[p.frequency] ?? p.frequency}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.lastSeenMonth}</td>
                    <td className="px-3 py-2 tabular-nums">{p.occurrenceCount}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {p.subscriptionEndDate ? (
                        <div className="flex flex-col leading-tight">
                          <span>{p.subscriptionEndDate}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {p.autoRenew ? 'מתחדש' : 'לא מתחדש'}
                            {p.cancelNoticeDays > 0 ? ` · ${p.cancelNoticeDays} ימי הודעה` : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === 'active'
                            ? 'bg-success/10 text-success'
                            : p.status === 'ended'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-warning/10 text-warning'
                        }`}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {(() => {
                          const hasNotif = patternsWithNotifications.has(p.id);
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setNotifyPatternId(p.id);
                                setNotifySeed(buildNotificationSeed(p));
                              }}
                              className={cn(
                                'rounded-md p-1.5',
                                hasNotif
                                  ? 'bg-accent/15 text-accent hover:bg-accent/25'
                                  : 'text-muted-foreground hover:text-accent hover:bg-accent/10',
                              )}
                              title={hasNotif
                                ? 'תזכורת קיימת — לחץ להוספה / עריכה'
                                : 'הגדר תזכורת לתבנית זו'}
                              aria-label="הגדר תזכורת"
                              aria-pressed={hasNotif}
                            >
                              <Bell className={cn('size-3.5', hasNotif && 'fill-current')} />
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => onToggleStatus(p.id, p.status)}
                          disabled={isPending || p.status === 'ended'}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/40 disabled:opacity-30"
                          title={isPaused ? 'הפעל מחדש' : 'השהה'}
                          aria-label={isPaused ? 'הפעל מחדש' : 'השהה'}
                        >
                          {isPaused
                            ? <PlayCircle className="size-3.5" />
                            : <PauseCircle className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalPattern(p)}
                          className="rounded-md p-1.5 text-foreground/70 hover:bg-accent/40"
                          title="ערוך"
                          aria-label="ערוך"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(p.id)}
                          disabled={isPending}
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

      {modalPattern !== undefined && (
        <RecurringModal
          pattern={modalPattern}
          categories={categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          onClose={() => setModalPattern(undefined)}
        />
      )}

      {/* Per-row notification modal — opened by clicking the bell.
          The seed is built by buildNotificationSeed() with smart defaults
          based on whether the pattern has an end_date set. */}
      {notifySeed && (
        <NotificationModal
          seed={notifySeed}
          categories={categories.map((c) => ({ id: c.id, nameHe: c.nameHe }))}
          contacts={notificationContacts}
          // No transactions surfaced here — the link is to the recurring
          // pattern, not a single transaction. Empty list keeps the
          // modal's transaction dropdown clean.
          recentTransactions={[]}
          onSaved={() => {
            // Optimistic UI: mark this pattern's bell as colored
            // immediately. Server-side revalidatePath('/recurring') in
            // the action will confirm on next nav.
            if (notifyPatternId) {
              setPatternsWithNotifications((prev) => {
                const next = new Set(prev);
                next.add(notifyPatternId);
                return next;
              });
            }
          }}
          onClose={() => {
            setNotifySeed(null);
            setNotifyPatternId(null);
          }}
        />
      )}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
/** Add N days to a Date and return YYYY-MM-DD. */
function addDaysIso(d: Date, days: number): string {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString().slice(0, 10);
}

/** Rough "next charge" lead time per frequency, used as a placeholder
 *  due-date when the pattern has no subscription_end_date set. */
function freqDaysAhead(freq: string): number {
  switch (freq) {
    case 'monthly':   return 30;
    case 'bimonthly': return 60;
    case 'quarterly': return 90;
    case 'yearly':    return 365;
    default:          return 30;
  }
}
