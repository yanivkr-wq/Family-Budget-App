'use client';

/**
 * Add / edit modal for a notification task.
 *
 * The interesting part is the multi-reminder builder: a user can stack as many
 * reminder rows as they want, each with its own offset (days before due date),
 * time-of-day, channel mix, and enable toggle. Validation and de-dup happen
 * server-side; here we just collect the rows.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { Plus, Trash2, X, Mail, MessageCircle, Smartphone, User, Send, Loader2 } from 'lucide-react';
import {
  createNotificationTask,
  testFireReminder,
  updateNotificationTask,
  type ReminderInput,
} from './actions';
import type { ReminderChannelPrefs } from '@fba/db';

export interface NotificationContactLite {
  id:        string;
  label:     string;
  phoneE164: string | null;
  email:     string | null;
  isDefault: boolean;
}

interface Cat { id: string; nameHe: string }
interface RecentTxn { id: string; merchant: string; amount: number; date: string }

export interface NotificationModalSeed {
  id?:                string;
  title:              string;
  description:        string | null;
  dueDate:            string;
  status:             'active' | 'paused' | 'completed' | 'cancelled';
  /** Auto-respawn cadence: 'none' = one-shot. Otherwise marking the task
   *  done creates the next instance with due_date shifted by one cycle. */
  recurrence:         'none' | 'monthly' | 'quarterly' | 'yearly';
  categoryId:         string | null;
  transactionId:      string | null;
  /** Optional link to a recurring pattern. Carried through to the action
   *  payload as a hidden field — no UI input for it (the form is launched
   *  pre-linked from the /recurring page bell). */
  recurringPatternId: string | null;
  reminders:          ReminderInput[];
}

const STATUS_OPTIONS: Array<{ value: NotificationModalSeed['status']; label: string }> = [
  { value: 'active',    label: 'פעיל' },
  { value: 'paused',    label: 'מושהה' },
  { value: 'completed', label: 'הושלם' },
  { value: 'cancelled', label: 'בוטל' },
];

const RECURRENCE_OPTIONS: Array<{ value: NotificationModalSeed['recurrence']; label: string }> = [
  { value: 'none',      label: 'חד-פעמי' },
  { value: 'monthly',   label: 'חודשי' },
  { value: 'quarterly', label: 'רבעוני' },
  { value: 'yearly',    label: 'שנתי' },
];

// Common offsets surfaced as quick-add buttons.
const OFFSET_PRESETS: Array<{ days: number; label: string }> = [
  { days: 0,  label: 'ביום היעד' },
  { days: 1,  label: '1 יום לפני' },
  { days: 3,  label: '3 ימים לפני' },
  { days: 7,  label: 'שבוע לפני' },
  { days: 14, label: 'שבועיים לפני' },
  { days: 30, label: 'חודש לפני' },
];

function defaultReminders(defaultContactId: string | null): ReminderInput[] {
  const ids = defaultContactId ? [defaultContactId] : [];
  return [
    { offsetDays: 7, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, recipientContactIds: ids, enabled: true },
    { offsetDays: 1, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, recipientContactIds: ids, enabled: true },
    { offsetDays: 0, fireTime: '09:00', channels: { in_app: true, email: false, whatsapp: false }, recipientContactIds: ids, enabled: true },
  ];
}

export function NotificationModal({
  seed,
  categories,
  recentTransactions,
  contacts,
  onClose,
  onSaved,
}: {
  seed: NotificationModalSeed | null;
  categories: Cat[];
  recentTransactions: RecentTxn[];
  /**
   * Household contacts available as recipients. Empty array hides the
   * recipient picker entirely (legacy fallback to creator profile). Should
   * always have at least one contact in practice — the migration backfilled
   * a default "אני" per household.
   */
  contacts: NotificationContactLite[];
  onClose: () => void;
  /**
   * Optional callback fired ONLY after a successful save (create or
   * update). Distinct from onClose, which also fires on cancel / backdrop
   * click / Esc. Used by callers (e.g. the txn-row bell) that need to
   * reflect the newly-created notification in their local UI without a
   * full page reload.
   */
  onSaved?: (taskId?: string) => void;
}) {
  const isEdit = seed?.id !== undefined;

  const [title, setTitle]                 = useState(seed?.title ?? '');
  const [description, setDescription]     = useState(seed?.description ?? '');
  const [dueDate, setDueDate]             = useState(seed?.dueDate ?? defaultDueDate());
  const [status, setStatus]               = useState<NotificationModalSeed['status']>(seed?.status ?? 'active');
  const [recurrence, setRecurrence]       = useState<NotificationModalSeed['recurrence']>(seed?.recurrence ?? 'none');
  const [categoryId, setCategoryId]       = useState(seed?.categoryId ?? '');
  const [transactionId, setTransactionId] = useState(seed?.transactionId ?? '');
  // Recurring-pattern link is hidden — set by the launcher (e.g. /recurring
  // bell), carried through unchanged. No UI for picking it from here.
  const recurringPatternId = seed?.recurringPatternId ?? null;
  const defaultContactId = contacts.find((c) => c.isDefault)?.id ?? contacts[0]?.id ?? null;
  const [reminders, setReminders]         = useState<ReminderInput[]>(
    seed?.reminders && seed.reminders.length > 0
      ? seed.reminders.map((r) => ({
          // Normalize: if seed reminder has no recipient list, pre-select the default.
          ...r,
          recipientContactIds: r.recipientContactIds && r.recipientContactIds.length > 0
            ? r.recipientContactIds
            : (defaultContactId ? [defaultContactId] : []),
        }))
      : defaultReminders(defaultContactId),
  );
  const [error, setError]                 = useState<string | null>(null);
  const [pending, startTransition]        = useTransition();
  // Inline status for the "send test" button — surfaces sent/failed/skipped
  // counts so the user knows immediately whether their channels worked.
  const [testStatus, setTestStatus]       = useState<{ ok: boolean; msg: string } | null>(null);
  const [testPending, setTestPending]     = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function addReminder(offsetDays = 0) {
    setReminders((prev) => [
      ...prev,
      {
        offsetDays,
        fireTime: '09:00',
        channels: { in_app: true, email: false, whatsapp: false },
        recipientContactIds: defaultContactId ? [defaultContactId] : [],
        enabled: true,
      },
    ]);
  }

  function updateReminder(idx: number, patch: Partial<ReminderInput>) {
    setReminders((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function toggleChannel(idx: number, ch: keyof ReminderChannelPrefs) {
    setReminders((prev) => prev.map((r, i) => i === idx
      ? { ...r, channels: { ...r.channels, [ch]: !r.channels[ch] } }
      : r,
    ));
  }
  function toggleRecipient(idx: number, contactId: string) {
    setReminders((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const current = new Set(r.recipientContactIds ?? []);
      if (current.has(contactId)) current.delete(contactId);
      else current.add(contactId);
      return { ...r, recipientContactIds: Array.from(current) };
    }));
  }
  function removeReminder(idx: number) {
    setReminders((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Fire the FIRST reminder right now via the worker test endpoint.
   *  Useful for verifying channel + recipient setup before saving. */
  async function handleTestFire() {
    setTestStatus(null);
    setTestPending(true);
    try {
      const r0 = reminders[0];
      if (!r0) {
        setTestStatus({ ok: false, msg: 'הוסיפי תזכורת אחת לפחות' });
        return;
      }
      const result = await testFireReminder({
        title:                title || 'בדיקה',
        description:          description.trim() || null,
        channels:             r0.channels,
        recipientContactIds:  r0.recipientContactIds ?? [],
      });
      if (result.ok) {
        const parts: string[] = [];
        if (result.sent    > 0) parts.push(`${result.sent} נשלחו`);
        if (result.skipped > 0) parts.push(`${result.skipped} דולגו`);
        if (result.failed  > 0) parts.push(`${result.failed} נכשלו`);
        setTestStatus({
          ok: result.failed === 0,
          msg: parts.length > 0 ? parts.join(' · ') : 'אין מה לשלוח',
        });
      } else {
        setTestStatus({ ok: false, msg: result.error ?? 'שגיאה' });
      }
    } finally {
      setTestPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      title,
      description: description.trim() || null,
      dueDate,
      status,
      recurrence,
      categoryId: categoryId || null,
      transactionId: transactionId || null,
      recurringPatternId,
      reminders,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateNotificationTask(seed!.id!, payload)
        : await createNotificationTask(payload);
      if (!res.ok) {
        setError(res.error ?? 'שגיאה');
        return;
      }
      // Notify caller before closing so they can mutate their own state
      // (e.g. mark the linked txn as "now has a reminder"). For updates
      // we don't have a fresh id, so pass the existing one. For creates
      // we have res.id from the server action.
      onSaved?.(isEdit ? seed!.id : (res as { id?: string }).id);
      onClose();
    });
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border bg-card shadow-xl" dir="rtl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-card px-5 py-4">
          <h2 className="text-base font-semibold">
            {isEdit ? 'עריכת התראה' : 'הוספת התראה'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/40" aria-label="סגור">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title + due date */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                כותרת המשימה <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="למשל: תשלום ארנונה Q1"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                תאריך יעד <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">תיאור</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="פרטים נוספים שיוצגו בהתראה"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Category + transaction link */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">קטגוריה</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                <option value="">— ללא —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.nameHe}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">תנועה קשורה</label>
              <select
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                <option value="">— ללא —</option>
                {recentTransactions.slice(0, 50).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.merchant}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status + recurrence side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">סטטוס</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as NotificationModalSeed['status'])}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">חזרה</label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as NotificationModalSeed['recurrence'])}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
                title="כשמסמנים את המשימה כהושלמה, היא תיווצר אוטומטית מחדש לפי המחזור הזה"
              >
                {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Reminders builder */}
          <fieldset className="rounded-md border border-dashed border-muted-foreground/30 p-3 space-y-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              תזכורות <span className="font-normal">(לפחות אחת)</span>
            </legend>

            {/* Quick presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-2xs text-muted-foreground">הוספה מהירה:</span>
              {OFFSET_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => addReminder(p.days)}
                  className="rounded-full border bg-card px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <ul className="space-y-2">
              {reminders.map((r, idx) => (
                <li key={idx} className="rounded-md border bg-background p-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-2xs">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateReminder(idx, { enabled: e.target.checked })}
                        className="size-3.5"
                      />
                      פעיל
                    </label>
                    <span className="text-2xs text-muted-foreground">·</span>
                    <label className="flex items-center gap-1 text-2xs">
                      ימים לפני:
                      <input
                        type="number"
                        min="0"
                        max="365"
                        value={r.offsetDays}
                        onChange={(e) => updateReminder(idx, { offsetDays: Number(e.target.value) })}
                        className="w-14 rounded border bg-background px-1.5 py-0.5 text-2xs tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-2xs">
                      שעה:
                      <input
                        type="time"
                        value={r.fireTime.slice(0, 5)}
                        onChange={(e) => updateReminder(idx, { fireTime: e.target.value })}
                        className="rounded border bg-background px-1.5 py-0.5 text-2xs tabular-nums"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeReminder(idx)}
                      className="ms-auto rounded-md p-1 text-destructive hover:bg-destructive/10"
                      title="מחק תזכורת זו"
                      aria-label="מחק תזכורת זו"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-2xs text-muted-foreground">ערוצים:</span>
                    <ChannelChip
                      icon={Smartphone}
                      label="באפליקציה"
                      active={r.channels.in_app}
                      onClick={() => toggleChannel(idx, 'in_app')}
                    />
                    <ChannelChip
                      icon={Mail}
                      label='דוא"ל'
                      active={r.channels.email}
                      onClick={() => toggleChannel(idx, 'email')}
                    />
                    <ChannelChip
                      icon={MessageCircle}
                      label="WhatsApp"
                      active={r.channels.whatsapp}
                      onClick={() => toggleChannel(idx, 'whatsapp')}
                    />
                  </div>
                  {/* Recipient picker — only shown when there are real contacts AND
                      at least one per-recipient channel (email/whatsapp) is on.
                      The bell ("באפליקציה") is shared at household level so
                      doesn't need a recipient. */}
                  {contacts.length > 0 && (r.channels.email || r.channels.whatsapp) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-2xs text-muted-foreground">שולחים אל:</span>
                      {contacts.map((c) => {
                        const selected = (r.recipientContactIds ?? []).includes(c.id);
                        const lacksPhone = !c.phoneE164;
                        const lacksEmail = !c.email;
                        // Surface a hint when the contact can't actually be
                        // reached on a channel the user enabled — they'll
                        // just be skipped at dispatch time.
                        const warns: string[] = [];
                        if (r.channels.whatsapp && lacksPhone) warns.push('אין טלפון');
                        if (r.channels.email    && lacksEmail) warns.push('אין דוא"ל');
                        const title = warns.length > 0 ? warns.join(' · ') : c.label;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleRecipient(idx, c.id)}
                            aria-pressed={selected}
                            title={title}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors ${
                              selected
                                ? 'border-accent bg-accent/15 text-accent'
                                : 'border-muted-foreground/30 bg-card text-muted-foreground hover:bg-muted/40'
                            }`}
                          >
                            <User className="size-3" aria-hidden />
                            {c.label}
                            {warns.length > 0 && selected && (
                              <span className="text-warning">⚠</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => addReminder(0)}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-muted/40"
            >
              <Plus className="size-3" /> הוסף תזכורת
            </button>
          </fieldset>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            {/* Test-fire button + inline status — left side so the user
                sees it as a "diagnostic action" separate from save/cancel. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestFire}
                disabled={testPending || pending}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                title="שלח עכשיו את התזכורת הראשונה לפי ההגדרות שהוקלדו (לא נשמר)"
              >
                {testPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                שלח בדיקה
              </button>
              {testStatus && (
                <span className={`text-2xs ${testStatus.ok ? 'text-success' : 'text-destructive'}`}>
                  {testStatus.msg}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/40"
              >
                ביטול
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? 'שומר…' : isEdit ? 'עדכן' : 'הוסף'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChannelChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors ${
        active
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-muted-foreground/30 bg-card text-muted-foreground hover:bg-muted/40'
      }`}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </button>
  );
}

function defaultDueDate(): string {
  // Default: 7 days out, in YYYY-MM-DD.
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
