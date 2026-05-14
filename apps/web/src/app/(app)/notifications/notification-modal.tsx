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
import {
  Plus,
  X,
  Mail,
  MessageCircle,
  Smartphone,
  User,
  Send,
  Loader2,
  CheckCircle2,
  Circle,
  Settings2,
  CalendarCheck,
  Sparkles,
} from 'lucide-react';
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

  // ── Reminder mutators ────────────────────────────────────────────────
  //
  // Option-A model: the user picks WHICH offsets to remind on via preset
  // chips (or a custom-offset input). Channels / time / recipients are
  // GLOBAL by default — set once on a panel below the chips, applied to
  // every reminder. An "advanced mode" toggle reveals per-reminder
  // overrides for power users.
  //
  // The underlying ReminderInput[] schema is unchanged so save / load /
  // server actions don't need to know about the global vs per-reminder
  // distinction. We just keep all the rows in sync when the global panel
  // mutates.
  const [advancedMode, setAdvancedMode] = useState(false);
  const [showCustomOffset, setShowCustomOffset] = useState(false);
  const [customOffsetInput, setCustomOffsetInput] = useState('');

  // Global channel / time / recipient values — derived from the first
  // reminder, or sensible defaults when the list is empty.
  const firstReminder = reminders[0];
  const globalFireTime = (firstReminder?.fireTime ?? '09:00').slice(0, 5);
  const globalChannels: ReminderChannelPrefs = firstReminder?.channels ?? {
    in_app: true,
    email: false,
    whatsapp: false,
  };
  const globalRecipientIds = firstReminder?.recipientContactIds ?? (defaultContactId ? [defaultContactId] : []);

  function hasOffset(offsetDays: number): boolean {
    return reminders.some((r) => r.offsetDays === offsetDays);
  }

  /**
   * Add a reminder at the given offset, using the current global channels /
   * time / recipients. Inserted in sorted order (largest offset first) so
   * the resolved-date summary reads chronologically.
   */
  function addReminderAt(offsetDays: number) {
    if (offsetDays < 0 || offsetDays > 365) return;
    setReminders((prev) => {
      if (prev.some((r) => r.offsetDays === offsetDays)) return prev;
      const next: ReminderInput = {
        offsetDays,
        fireTime: globalFireTime + ':00',
        channels: { ...globalChannels },
        recipientContactIds: [...globalRecipientIds],
        enabled: true,
      };
      return [...prev, next].sort((a, b) => b.offsetDays - a.offsetDays);
    });
  }

  /** Toggle a preset on/off. On = add a reminder at that offset; off =
   *  remove the existing one. */
  function togglePresetOffset(offsetDays: number) {
    if (hasOffset(offsetDays)) {
      setReminders((prev) => prev.filter((r) => r.offsetDays !== offsetDays));
    } else {
      addReminderAt(offsetDays);
    }
  }

  /** Global time setter — propagates to every reminder. */
  function setGlobalFireTime(time: string) {
    setReminders((prev) => prev.map((r) => ({ ...r, fireTime: time + ':00' })));
  }

  /** Global channel toggle — flips for every reminder so they stay
   *  consistent. Advanced mode re-introduces per-reminder overrides. */
  function toggleGlobalChannel(ch: keyof ReminderChannelPrefs) {
    setReminders((prev) =>
      prev.map((r) => ({
        ...r,
        channels: { ...r.channels, [ch]: !globalChannels[ch] },
      })),
    );
  }

  /** Global recipient toggle. Recipients are only meaningful for email /
   *  whatsapp (in-app is household-wide), so the picker is hidden when
   *  neither channel is on. */
  function toggleGlobalRecipient(contactId: string) {
    setReminders((prev) =>
      prev.map((r) => {
        const set = new Set(r.recipientContactIds ?? []);
        if (set.has(contactId)) set.delete(contactId);
        else set.add(contactId);
        return { ...r, recipientContactIds: Array.from(set) };
      }),
    );
  }

  // Per-reminder mutators — only surfaced in advanced mode.
  function updateReminder(idx: number, patch: Partial<ReminderInput>) {
    setReminders((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function toggleChannel(idx: number, ch: keyof ReminderChannelPrefs) {
    setReminders((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, channels: { ...r.channels, [ch]: !r.channels[ch] } } : r,
      ),
    );
  }
  function toggleRecipient(idx: number, contactId: string) {
    setReminders((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const current = new Set(r.recipientContactIds ?? []);
        if (current.has(contactId)) current.delete(contactId);
        else current.add(contactId);
        return { ...r, recipientContactIds: Array.from(current) };
      }),
    );
  }
  function removeReminder(idx: number) {
    setReminders((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Custom offset submit (from the inline "+ מותאם..." picker). */
  function submitCustomOffset() {
    const n = Number(customOffsetInput);
    if (Number.isFinite(n) && n >= 0 && n <= 365) {
      addReminderAt(n);
      setCustomOffsetInput('');
      setShowCustomOffset(false);
    }
  }

  /** Resolve a YYYY-MM-DD due date − offsetDays back into a DD/MM/YYYY
   *  string for the summary panel. Defensive against an unparseable
   *  dueDate (returns empty string). */
  function resolveReminderDate(offsetDays: number): string {
    if (!dueDate) return '';
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() - offsetDays);
    return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  /** Pretty label for an offset — preset name if it matches one, else fallback. */
  function labelForOffset(days: number): string {
    const p = OFFSET_PRESETS.find((x) => x.days === days);
    if (p) return p.label;
    if (days === 0) return 'ביום היעד';
    return `${days} ימים לפני`;
  }

  /** Comma-separated list of active channel names for the summary panel. */
  function activeChannelsLabel(): string {
    const names: string[] = [];
    if (globalChannels.in_app) names.push('באפליקציה');
    if (globalChannels.email) names.push('דוא"ל');
    if (globalChannels.whatsapp) names.push('WhatsApp');
    return names.length === 0 ? '(לא נבחר ערוץ)' : names.join(' · ');
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

          {/* Reminders — Option A: preset chips drive add/remove, channels + time global */}
          <fieldset className="rounded-xl border border-dashed border-muted-foreground/30 p-4 space-y-4">
            <legend className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
              תזכורות <span className="font-normal">(לפחות אחת)</span>
              <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                {reminders.length}
              </span>
            </legend>

            {/* Step 1: preset chips — clicking ADDS or REMOVES a reminder
                at that offset. The active state is the source of truth for
                what gets saved. */}
            <div className="space-y-2">
              <p className="text-2xs text-muted-foreground">מתי להזכיר? (לחץ להפעלה/כיבוי)</p>
              <div className="flex flex-wrap gap-1.5">
                {OFFSET_PRESETS.map((p) => {
                  const active = hasOffset(p.days);
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => togglePresetOffset(p.days)}
                      aria-pressed={active}
                      className={
                        active
                          ? 'inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-2xs font-medium text-primary-foreground shadow-sm'
                          : 'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-2xs font-medium text-foreground hover:bg-muted/40'
                      }
                    >
                      {active ? <CheckCircle2 className="size-3" /> : <Circle className="size-3 opacity-40" />}
                      {p.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowCustomOffset((s) => !s)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed bg-card px-3 py-1 text-2xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="size-3" />
                  מותאם...
                </button>
              </div>
              {/* Inline custom-offset input */}
              {showCustomOffset && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-card/50 p-2">
                  <label className="flex items-center gap-1.5 text-2xs">
                    ימים לפני:
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={customOffsetInput}
                      onChange={(e) => setCustomOffsetInput(e.target.value)}
                      placeholder="למשל 21"
                      className="w-20 rounded border bg-background px-1.5 py-0.5 text-2xs tabular-nums"
                      autoFocus
                    />
                  </label>
                  <button
                    type="button"
                    onClick={submitCustomOffset}
                    className="rounded-md bg-primary px-2.5 py-0.5 text-2xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    הוסף
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCustomOffset(false); setCustomOffsetInput(''); }}
                    className="rounded-md px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/40"
                  >
                    ביטול
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: global channels + time. In standard mode applies to
                EVERY reminder; advanced mode (toggle below) lets the user
                override per row. Hidden when no reminders are configured —
                nothing to control. */}
            {reminders.length > 0 && !advancedMode && (
              <div className="rounded-lg border bg-muted/10 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Settings2 className="size-3.5 text-muted-foreground" />
                  <h4 className="text-2xs font-semibold text-muted-foreground">
                    ערוצים ושעה (חל על כל התזכורות)
                  </h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-2xs text-muted-foreground">שעת שליחה</span>
                    <input
                      type="time"
                      value={globalFireTime}
                      onChange={(e) => setGlobalFireTime(e.target.value)}
                      className="w-full rounded border bg-background px-2 py-1 text-2xs tabular-nums text-right"
                    />
                  </label>
                  <div>
                    <span className="mb-1 block text-2xs text-muted-foreground">ערוצים</span>
                    <div className="flex flex-wrap gap-1">
                      <ChannelChip
                        icon={Smartphone}
                        label="באפליקציה"
                        active={globalChannels.in_app}
                        onClick={() => toggleGlobalChannel('in_app')}
                      />
                      <ChannelChip
                        icon={Mail}
                        label='דוא"ל'
                        active={globalChannels.email}
                        onClick={() => toggleGlobalChannel('email')}
                      />
                      <ChannelChip
                        icon={MessageCircle}
                        label="WhatsApp"
                        active={globalChannels.whatsapp}
                        onClick={() => toggleGlobalChannel('whatsapp')}
                      />
                    </div>
                  </div>
                </div>
                {/* Recipient picker — global. Same visibility rule as before:
                    only shown when email or whatsapp is on (in-app is
                    household-wide and doesn't need a target contact). */}
                {contacts.length > 0 && (globalChannels.email || globalChannels.whatsapp) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-2xs text-muted-foreground">שולחים אל:</span>
                    {contacts.map((c) => {
                      const selected = globalRecipientIds.includes(c.id);
                      const warns: string[] = [];
                      if (globalChannels.whatsapp && !c.phoneE164) warns.push('אין טלפון');
                      if (globalChannels.email && !c.email) warns.push('אין דוא"ל');
                      const title = warns.length > 0 ? warns.join(' · ') : c.label;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleGlobalRecipient(c.id)}
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
                          {warns.length > 0 && selected && <span className="text-warning">⚠</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAdvancedMode(true)}
                  className="text-2xs text-accent underline-offset-2 hover:underline"
                >
                  ◌ הגדר ערוצים נפרדים לכל תזכורת (מתקדם)
                </button>
              </div>
            )}

            {/* Advanced mode — per-reminder editor list. Same controls as
                the original layout for users who genuinely need different
                channels per reminder. The "back to standard mode" button
                resets all reminders to match the first one's channels/time
                (so the user doesn't get stuck in a confusing state). */}
            {reminders.length > 0 && advancedMode && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-2xs font-semibold text-muted-foreground">
                    הגדרות נפרדות לכל תזכורת
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      // Reset everything to the first row's settings, then exit advanced.
                      if (firstReminder) {
                        setReminders((prev) =>
                          prev.map((r) => ({
                            ...r,
                            fireTime: firstReminder.fireTime,
                            channels: { ...firstReminder.channels },
                            recipientContactIds: [...(firstReminder.recipientContactIds ?? [])],
                          })),
                        );
                      }
                      setAdvancedMode(false);
                    }}
                    className="text-2xs text-accent underline-offset-2 hover:underline"
                  >
                    ↑ חזור למצב סטנדרטי
                  </button>
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
                        <span className="text-2xs font-medium">{labelForOffset(r.offsetDays)}</span>
                        <span className="text-2xs text-muted-foreground tabular-nums">
                          ({resolveReminderDate(r.offsetDays)})
                        </span>
                        <label className="ms-auto flex items-center gap-1 text-2xs">
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
                          className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                          title="מחק תזכורת זו"
                          aria-label="מחק תזכורת זו"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
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
                      {contacts.length > 0 && (r.channels.email || r.channels.whatsapp) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-2xs text-muted-foreground">שולחים אל:</span>
                          {contacts.map((c) => {
                            const selected = (r.recipientContactIds ?? []).includes(c.id);
                            const warns: string[] = [];
                            if (r.channels.whatsapp && !c.phoneE164) warns.push('אין טלפון');
                            if (r.channels.email && !c.email) warns.push('אין דוא"ל');
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
                                {warns.length > 0 && selected && <span className="text-warning">⚠</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Step 3: resolved-date summary. Tells the user the EXACT
                dates the reminders will fire so they don't have to mentally
                subtract days from the due date. */}
            {reminders.length > 0 && (
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-accent" />
                  <h4 className="text-2xs font-semibold text-accent">סיכום</h4>
                </div>
                <p className="text-2xs">
                  <span className="font-semibold tabular-nums">{reminders.length} תזכורות</span>
                  {' '}יישלחו ב-{advancedMode ? '(הגדרות נפרדות לכל אחת)' : `${activeChannelsLabel()} בשעה ${globalFireTime}`}:
                </p>
                <ul className="space-y-0.5 text-2xs text-muted-foreground">
                  {reminders.map((r, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <CalendarCheck className="size-3 text-accent shrink-0" />
                      <span className="tabular-nums">{resolveReminderDate(r.offsetDays)}</span>
                      <span>· {labelForOffset(r.offsetDays)}</span>
                      {!r.enabled && <span className="text-warning">(מושהה)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
