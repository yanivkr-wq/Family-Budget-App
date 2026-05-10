'use server';

/**
 * CRUD + bulk server actions for notification tasks & their reminders.
 *
 * The shape passed in by the client is intentionally flat — one task with an
 * array of reminders. We unwrap it server-side into the two-table layout, in
 * a transaction so a failed reminder insert rolls back the task. Unique on
 * (task_id, offset_days, fire_time) catches duplicate reminders.
 */

import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import type { ReminderChannelPrefs } from '@fba/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export interface ReminderInput {
  /** Days before due_date. 0 = on due date. */
  offsetDays: number;
  /** 'HH:MM' or 'HH:MM:SS' */
  fireTime: string;
  channels: ReminderChannelPrefs;
  /**
   * Which contacts should be notified for this reminder. Empty / undefined
   * means "fall back to creator's user profile" (legacy behavior). New
   * reminders should always pass at least one contact id.
   */
  recipientContactIds?: string[];
  enabled: boolean;
}

export interface NotificationTaskInput {
  title: string;
  description: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  /** Auto-respawn cadence on completion. Default 'none' = one-shot. */
  recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly';
  categoryId: string | null;
  transactionId: string | null;
  /** Optional link to a recurring pattern (subscription / monthly bill). */
  recurringPatternId: string | null;
  reminders: ReminderInput[];
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return {
    userId: session.user.id,
    householdId: session.user.householdId,
    db: getDb(),
  };
}

function normalizeFireTime(t: string): string {
  // Accept 'HH:MM' or 'HH:MM:SS', emit 'HH:MM:SS' for the time column.
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  return '09:00:00';
}

function validateInput(input: NotificationTaskInput): string | null {
  if (!input.title.trim()) return 'כותרת היא שדה חובה';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return 'תאריך יעד לא חוקי';
  if (input.reminders.length === 0) return 'יש להגדיר לפחות תזכורת אחת';
  for (const r of input.reminders) {
    if (!Number.isFinite(r.offsetDays)) return 'מרווח תזכורת חייב להיות מספר';
    if (r.offsetDays < 0 || r.offsetDays > 365) return 'מרווח תזכורת חייב להיות בין 0 ל-365 ימים';
    if (!r.channels.in_app && !r.channels.email && !r.channels.whatsapp) {
      return 'בכל תזכורת יש לבחור לפחות ערוץ הודעה אחד';
    }
  }
  return null;
}

// ── CREATE ───────────────────────────────────────────────────────────────────
export async function createNotificationTask(
  input: NotificationTaskInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const { userId, householdId, db } = await requireUser();
    const validationError = validateInput(input);
    if (validationError) return { ok: false, error: validationError };

    // Two inserts in a Drizzle transaction. Reminders inherit the new task id.
    const taskId = await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(schema.notificationTasks)
        .values({
          householdId,
          createdByUserId:    userId,
          title:              input.title.trim(),
          description:        input.description?.trim() || null,
          dueDate:            input.dueDate,
          status:             input.status,
          recurrence:         input.recurrence,
          categoryId:         input.categoryId,
          transactionId:      input.transactionId,
          recurringPatternId: input.recurringPatternId,
        })
        .returning({ id: schema.notificationTasks.id });

      if (!task) throw new Error('failed to insert task');

      await tx.insert(schema.notificationReminders).values(
        input.reminders.map((r) => ({
          taskId:               task.id,
          offsetDays:           r.offsetDays,
          fireTime:             normalizeFireTime(r.fireTime),
          channels:             r.channels,
          recipientContactIds:  r.recipientContactIds && r.recipientContactIds.length > 0
            ? r.recipientContactIds
            : null,
          enabled:              r.enabled,
        })),
      );
      return task.id;
    });

    revalidatePath('/notifications');
    // Also revalidate /transactions and /recurring so the per-row bell
    // color is fresh after the user creates a notification from those
    // surfaces. We could revalidate unconditionally but only doing it
    // when the link was actually set keeps unrelated views from
    // re-rendering for nothing.
    if (input.transactionId)      revalidatePath('/transactions');
    if (input.recurringPatternId) revalidatePath('/recurring');
    return { ok: true, id: taskId };
  } catch (e) {
    if (e instanceof Error && e.message.includes('unique')) {
      return { ok: false, error: 'שתי תזכורות לא יכולות להיות באותו מועד' };
    }
    console.error('createNotificationTask', e);
    return { ok: false, error: 'שגיאה ביצירת התראה' };
  }
}

// ── UPDATE ───────────────────────────────────────────────────────────────────
// Strategy: replace the reminder set in full. Simpler and less error-prone
// than diffing — these lists are short (typically 1-5 reminders).
export async function updateNotificationTask(
  id: string,
  input: NotificationTaskInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireUser();
    const validationError = validateInput(input);
    if (validationError) return { ok: false, error: validationError };

    await db.transaction(async (tx) => {
      // Verify the task belongs to this household before mutating.
      const [existing] = await tx
        .select({ id: schema.notificationTasks.id })
        .from(schema.notificationTasks)
        .where(and(
          eq(schema.notificationTasks.id, id),
          eq(schema.notificationTasks.householdId, householdId),
        ));
      if (!existing) throw new Error('not_found');

      await tx
        .update(schema.notificationTasks)
        .set({
          title:              input.title.trim(),
          description:        input.description?.trim() || null,
          dueDate:            input.dueDate,
          status:             input.status,
          recurrence:         input.recurrence,
          categoryId:         input.categoryId,
          transactionId:      input.transactionId,
          recurringPatternId: input.recurringPatternId,
          updatedAt:          new Date(),
        })
        .where(eq(schema.notificationTasks.id, id));

      // Wipe + reinsert the reminder set. Cascades on notification_event are
      // OK because we're keeping the same task — old events stay, the new
      // reminder rows just take over future fires.
      await tx.delete(schema.notificationReminders).where(eq(schema.notificationReminders.taskId, id));
      await tx.insert(schema.notificationReminders).values(
        input.reminders.map((r) => ({
          taskId:               id,
          offsetDays:           r.offsetDays,
          fireTime:             normalizeFireTime(r.fireTime),
          channels:             r.channels,
          recipientContactIds:  r.recipientContactIds && r.recipientContactIds.length > 0
            ? r.recipientContactIds
            : null,
          enabled:              r.enabled,
        })),
      );
    });

    revalidatePath('/notifications');
    revalidatePath('/transactions');
    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === 'not_found') {
      return { ok: false, error: 'התראה לא נמצאה' };
    }
    if (e instanceof Error && e.message.includes('unique')) {
      return { ok: false, error: 'שתי תזכורות לא יכולות להיות באותו מועד' };
    }
    console.error('updateNotificationTask', e);
    return { ok: false, error: 'שגיאה בעדכון התראה' };
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function deleteNotificationTask(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireUser();
    await db
      .delete(schema.notificationTasks)
      .where(and(
        eq(schema.notificationTasks.id, id),
        eq(schema.notificationTasks.householdId, householdId),
      ));
    revalidatePath('/notifications');
    revalidatePath('/transactions');
    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    console.error('deleteNotificationTask', e);
    return { ok: false, error: 'שגיאה במחיקה' };
  }
}

// ── STATUS toggle (single) + auto-respawn on completion ─────────────────────
//
// When a recurring task is marked 'completed', we copy it forward — same
// title/description/category/contacts/reminders, but with due_date shifted
// by one cycle. The original completed row stays for history. This is what
// makes "remind me every quarter to pay arnona" actually work without the
// user manually cloning the task four times a year.
//
// Cycle length:
//   monthly   → +1 month
//   quarterly → +3 months
//   yearly    → +12 months
// Day-of-month is clamped to the last day of the target month so e.g.
// Jan 31 → Feb 28/29 (instead of overflowing into March).
const RECURRENCE_MONTH_STEP: Record<string, number> = {
  monthly:   1,
  quarterly: 3,
  yearly:    12,
};

function shiftDueDate(dueDate: string, recurrence: string): string | null {
  const step = RECURRENCE_MONTH_STEP[recurrence];
  if (!step) return null;
  const parts = dueDate.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]); // 1-based
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const targetMonth = m + step;
  const lastDayOfTarget = new Date(Date.UTC(y, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTarget);
  const next = new Date(Date.UTC(y, targetMonth - 1, clampedDay));
  return next.toISOString().slice(0, 10);
}

export async function setNotificationStatus(
  id: string,
  status: 'active' | 'paused' | 'completed' | 'cancelled',
): Promise<{ ok: boolean; error?: string; nextTaskId?: string; nextDueDate?: string }> {
  try {
    const { householdId, db } = await requireUser();
    let nextTaskId: string | undefined;
    let nextDueDate: string | undefined;

    await db.transaction(async (tx) => {
      // Mark the original task with the requested status.
      const [updated] = await tx
        .update(schema.notificationTasks)
        .set({ status, updatedAt: new Date() })
        .where(and(
          eq(schema.notificationTasks.id, id),
          eq(schema.notificationTasks.householdId, householdId),
        ))
        .returning({
          id:                 schema.notificationTasks.id,
          title:              schema.notificationTasks.title,
          description:        schema.notificationTasks.description,
          dueDate:            schema.notificationTasks.dueDate,
          recurrence:         schema.notificationTasks.recurrence,
          categoryId:         schema.notificationTasks.categoryId,
          transactionId:      schema.notificationTasks.transactionId,
          recurringPatternId: schema.notificationTasks.recurringPatternId,
          createdByUserId:    schema.notificationTasks.createdByUserId,
        });

      if (!updated) return; // not found / not owned by this household

      // Auto-respawn ONLY on completion of recurring tasks. Cancelled /
      // paused don't trigger respawn — those are explicit "no, don't repeat".
      if (status !== 'completed' || updated.recurrence === 'none') return;

      const shifted = shiftDueDate(updated.dueDate, updated.recurrence);
      if (!shifted) return;

      const [next] = await tx
        .insert(schema.notificationTasks)
        .values({
          householdId,
          createdByUserId:    updated.createdByUserId,
          title:              updated.title,
          description:        updated.description,
          dueDate:            shifted,
          status:             'active',
          recurrence:         updated.recurrence,
          categoryId:         updated.categoryId,
          transactionId:      updated.transactionId,
          recurringPatternId: updated.recurringPatternId,
        })
        .returning({ id: schema.notificationTasks.id });

      if (!next) return;
      nextTaskId = next.id;
      nextDueDate = shifted;

      // Copy reminders from the source task to the new one. We use the
      // SAME offsets/times/channels/contacts/enabled — the user's mental
      // model is "this exact reminder schedule, on the next cycle".
      const sourceReminders = await tx
        .select({
          offsetDays:           schema.notificationReminders.offsetDays,
          fireTime:             schema.notificationReminders.fireTime,
          channels:             schema.notificationReminders.channels,
          recipientContactIds:  schema.notificationReminders.recipientContactIds,
          enabled:              schema.notificationReminders.enabled,
        })
        .from(schema.notificationReminders)
        .where(eq(schema.notificationReminders.taskId, updated.id));

      if (sourceReminders.length > 0) {
        await tx.insert(schema.notificationReminders).values(
          sourceReminders.map((r) => ({
            taskId:               next.id,
            offsetDays:           r.offsetDays,
            fireTime:             r.fireTime,
            channels:             r.channels,
            recipientContactIds:  r.recipientContactIds,
            enabled:              r.enabled,
          })),
        );
      }
    });

    revalidatePath('/notifications');
    revalidatePath('/transactions');
    revalidatePath('/recurring');
    return { ok: true, nextTaskId, nextDueDate };
  } catch (e) {
    console.error('setNotificationStatus', e);
    return { ok: false, error: 'שגיאה בעדכון סטטוס' };
  }
}

// ── BULK actions ─────────────────────────────────────────────────────────────
export async function bulkSetStatus(
  ids: string[],
  status: 'active' | 'paused' | 'completed' | 'cancelled',
): Promise<{ ok: boolean; affected: number; error?: string }> {
  try {
    if (ids.length === 0) return { ok: true, affected: 0 };
    const { householdId, db } = await requireUser();
    const result = await db
      .update(schema.notificationTasks)
      .set({ status, updatedAt: new Date() })
      .where(and(
        inArray(schema.notificationTasks.id, ids),
        eq(schema.notificationTasks.householdId, householdId),
      ))
      .returning({ id: schema.notificationTasks.id });
    revalidatePath('/notifications');
    revalidatePath('/transactions');
    revalidatePath('/recurring');
    return { ok: true, affected: result.length };
  } catch (e) {
    console.error('bulkSetStatus', e);
    return { ok: false, affected: 0, error: 'שגיאה בעדכון מרובה' };
  }
}

export async function bulkDelete(
  ids: string[],
): Promise<{ ok: boolean; affected: number; error?: string }> {
  try {
    if (ids.length === 0) return { ok: true, affected: 0 };
    const { householdId, db } = await requireUser();
    const result = await db
      .delete(schema.notificationTasks)
      .where(and(
        inArray(schema.notificationTasks.id, ids),
        eq(schema.notificationTasks.householdId, householdId),
      ))
      .returning({ id: schema.notificationTasks.id });
    revalidatePath('/notifications');
    revalidatePath('/transactions');
    revalidatePath('/recurring');
    return { ok: true, affected: result.length };
  } catch (e) {
    console.error('bulkDelete', e);
    return { ok: false, affected: 0, error: 'שגיאה במחיקה מרובה' };
  }
}

// ── In-app event helpers ─────────────────────────────────────────────────────
// ── Test fire — dispatch a reminder NOW, bypassing the cron ────────────────
//
// Used by the "שלח בדיקה" button in the notification modal so the user can
// verify their channels + recipients work without waiting up to 5 minutes
// for the next cron tick. Talks to the worker over the internal HTTP token
// rather than duplicating the dispatcher logic on the web side.
//
// We accept an in-flight payload (the unsaved task + its first reminder)
// so the user can test BEFORE saving — useful for "let me try this title /
// recipient combo before I commit to it". For saved tasks we accept the
// reminder id and load it on the worker side.
export async function testFireReminder(args: {
  /** Task fields. For unsaved tasks supply title + dueDate; for saved
   *  tasks the worker uses the saved title via reminderId. */
  title:                string;
  description:          string | null;
  channels:             { in_app: boolean; email: boolean; whatsapp: boolean };
  recipientContactIds:  string[];
}): Promise<{ ok: boolean; error?: string; sent: number; failed: number; skipped: number }> {
  try {
    const { householdId, db } = await requireUser();

    // Pull contact email/phone for each requested recipient. Empty list =
    // legacy fallback (creator's own user profile).
    const recipients: Array<{ contactId: string | null; email: string | null; phone: string | null; label: string }> = [];
    if (args.recipientContactIds.length > 0) {
      const rows = await db
        .select({
          id:        schema.notificationContacts.id,
          label:     schema.notificationContacts.label,
          phoneE164: schema.notificationContacts.phoneE164,
          email:     schema.notificationContacts.email,
        })
        .from(schema.notificationContacts)
        .where(and(
          inArray(schema.notificationContacts.id, args.recipientContactIds),
          eq(schema.notificationContacts.householdId, householdId),
        ));
      for (const r of rows) {
        recipients.push({ contactId: r.id, email: r.email, phone: r.phoneE164, label: r.label });
      }
    }
    if (recipients.length === 0) {
      // Legacy fallback to user profile.
      const session = await auth();
      if (!session?.user) return { ok: false, error: 'unauthorized', sent: 0, failed: 0, skipped: 0 };
      const [u] = await db
        .select({ email: schema.users.email, phone: schema.users.phoneE164 })
        .from(schema.users)
        .where(eq(schema.users.id, session.user.id));
      if (u) recipients.push({ contactId: null, email: u.email, phone: u.phone, label: 'אתה' });
    }

    if (recipients.length === 0) {
      return { ok: false, error: 'אין נמענים', sent: 0, failed: 0, skipped: 0 };
    }

    // Hit the worker via the internal HTTP route. We add the route below.
    const workerUrl = process.env.WORKER_INTERNAL_URL ?? 'http://localhost:8080';
    const token     = process.env.WORKER_INTERNAL_TOKEN;
    if (!token) return { ok: false, error: 'WORKER_INTERNAL_TOKEN not set', sent: 0, failed: 0, skipped: 0 };

    const resp = await fetch(`${workerUrl}/notifications/test-fire`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        title:       args.title || 'בדיקה',
        description: args.description ?? '',
        channels:    args.channels,
        recipients:  recipients.map((r) => ({
          email: r.email, phone: r.phone, label: r.label,
        })),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { ok: false, error: `worker ${resp.status}: ${text.slice(0, 200)}`, sent: 0, failed: 0, skipped: 0 };
    }
    const json = await resp.json() as { sent: number; failed: number; skipped: number };
    return { ok: true, sent: json.sent, failed: json.failed, skipped: json.skipped };
  } catch (e) {
    console.error('testFireReminder', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown', sent: 0, failed: 0, skipped: 0 };
  }
}

// ── Snooze (re-fire an in-app event at a later time) ───────────────────────
/**
 * Snooze an in-app event by inserting a NEW in_app event at fire_at + delta
 * and marking the current one as read. The new event is detached from any
 * reminder (reminder_id is set to the original's reminder_id but the
 * unique constraint allows multiple events per (reminder, fire_at, channel)
 * since fire_at differs). Title/body are copied from the original snapshot.
 *
 * Snooze is in-app only by design — re-emailing or re-WhatsApping after a
 * user dismissed a reminder once would be too noisy.
 */
const SNOOZE_PRESETS_HOURS: Record<string, number> = {
  '1h':       1,
  '4h':       4,
  'tomorrow': 24,
  'week':     24 * 7,
};

export async function snoozeEvent(
  eventId: string,
  preset: '1h' | '4h' | 'tomorrow' | 'week',
): Promise<{ ok: boolean; error?: string; nextFireAt?: string }> {
  try {
    const { householdId, db } = await requireUser();
    const hours = SNOOZE_PRESETS_HOURS[preset];
    if (!hours) return { ok: false, error: 'invalid preset' };

    const [original] = await db
      .select({
        id:            schema.notificationEvents.id,
        reminderId:    schema.notificationEvents.reminderId,
        taskId:        schema.notificationEvents.taskId,
        userId:        schema.notificationEvents.userId,
        titleSnapshot: schema.notificationEvents.titleSnapshot,
        bodySnapshot:  schema.notificationEvents.bodySnapshot,
      })
      .from(schema.notificationEvents)
      .where(and(
        eq(schema.notificationEvents.id, eventId),
        eq(schema.notificationEvents.householdId, householdId),
        eq(schema.notificationEvents.channel, 'in_app'),
      ));
    if (!original) return { ok: false, error: 'event not found' };

    const nextFireAt = new Date(Date.now() + hours * 3_600_000);

    await db.transaction(async (tx) => {
      // Mark current event as 'read' so the bell badge clears.
      await tx
        .update(schema.notificationEvents)
        .set({ state: 'read' })
        .where(eq(schema.notificationEvents.id, eventId));

      // Insert the snoozed event. State 'sent' so it shows immediately in
      // the bell at fire time (the dispatcher would normally do that for
      // newly-fired events; a manually-inserted snooze event is already
      // "delivered" when its time comes).
      await tx
        .insert(schema.notificationEvents)
        .values({
          reminderId:    original.reminderId,
          taskId:        original.taskId,
          householdId,
          userId:        original.userId,
          contactId:     null,
          fireAt:        nextFireAt,
          channel:       'in_app',
          state:         'sent',
          sentAt:        nextFireAt,
          titleSnapshot: `[נדחה] ${original.titleSnapshot}`,
          bodySnapshot:  original.bodySnapshot,
        })
        .onConflictDoNothing({
          target: [
            schema.notificationEvents.reminderId,
            schema.notificationEvents.fireAt,
            schema.notificationEvents.channel,
            schema.notificationEvents.contactId,
          ],
        });
    });

    revalidatePath('/');
    revalidatePath('/notifications');
    return { ok: true, nextFireAt: nextFireAt.toISOString() };
  } catch (e) {
    console.error('snoozeEvent', e);
    return { ok: false, error: 'שגיאה בדחיית ההתראה' };
  }
}

/**
 * From the bell dropdown: mark the underlying TASK (not just the event) as
 * completed. If the task has a recurrence, the next instance is auto-spawned
 * by setNotificationStatus.
 */
export async function completeTaskFromEvent(
  eventId: string,
): Promise<{ ok: boolean; error?: string; nextDueDate?: string }> {
  try {
    const { householdId, db } = await requireUser();
    const [event] = await db
      .select({ taskId: schema.notificationEvents.taskId })
      .from(schema.notificationEvents)
      .where(and(
        eq(schema.notificationEvents.id, eventId),
        eq(schema.notificationEvents.householdId, householdId),
      ));
    if (!event) return { ok: false, error: 'event not found' };

    // Also mark the bell event as 'read' so the badge clears.
    await db
      .update(schema.notificationEvents)
      .set({ state: 'read' })
      .where(eq(schema.notificationEvents.id, eventId));

    return await setNotificationStatus(event.taskId, 'completed');
  } catch (e) {
    console.error('completeTaskFromEvent', e);
    return { ok: false, error: 'שגיאה בסימון כבוצע' };
  }
}

/** Mark an in-app event as read (used by the bell dropdown). */
export async function markEventRead(eventId: string): Promise<{ ok: boolean }> {
  try {
    const { householdId, db } = await requireUser();
    await db
      .update(schema.notificationEvents)
      .set({ state: 'read' })
      .where(and(
        eq(schema.notificationEvents.id, eventId),
        eq(schema.notificationEvents.householdId, householdId),
        eq(schema.notificationEvents.channel, 'in_app'),
      ));
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('markEventRead', e);
    return { ok: false };
  }
}

/** Mark every unread in-app event as read. */
export async function markAllEventsRead(): Promise<{ ok: boolean; affected: number }> {
  try {
    const { householdId, db } = await requireUser();
    const result = await db
      .update(schema.notificationEvents)
      .set({ state: 'read' })
      .where(and(
        eq(schema.notificationEvents.householdId, householdId),
        eq(schema.notificationEvents.channel, 'in_app'),
        eq(schema.notificationEvents.state, 'sent'),
      ))
      .returning({ id: schema.notificationEvents.id });
    revalidatePath('/');
    return { ok: true, affected: result.length };
  } catch (e) {
    console.error('markAllEventsRead', e);
    return { ok: false, affected: 0 };
  }
}

// ── User contact ─────────────────────────────────────────────────────────────
export async function updateUserPhone(
  phoneE164: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { userId, db } = await requireUser();
    const trimmed = phoneE164?.trim() || null;
    // Light E.164 validation: + and 8-15 digits. Reject obvious garbage rather
    // than waiting for Twilio to error at send-time.
    if (trimmed && !/^\+[1-9]\d{7,14}$/.test(trimmed)) {
      return { ok: false, error: 'מספר טלפון חייב להיות בפורמט E.164 (לדוגמה +972501234567)' };
    }
    await db
      .update(schema.users)
      .set({ phoneE164: trimmed })
      .where(eq(schema.users.id, userId));
    revalidatePath('/settings/notifications');
    return { ok: true };
  } catch (e) {
    console.error('updateUserPhone', e);
    return { ok: false, error: 'שגיאה בעדכון טלפון' };
  }
}

// ── Notification contacts (household-scoped recipients) ─────────────────────

export interface ContactInput {
  label:     string;
  phoneE164: string | null;
  email:     string | null;
  isDefault: boolean;
}

function validateContactInput(input: ContactInput): string | null {
  if (!input.label.trim()) return 'תווית חובה';
  if (!input.phoneE164 && !input.email) {
    return 'יש להזין לפחות טלפון או דוא"ל לאיש קשר';
  }
  if (input.phoneE164 && !/^\+[1-9]\d{7,14}$/.test(input.phoneE164.trim())) {
    return 'מספר טלפון חייב להיות בפורמט E.164 (לדוגמה +972501234567)';
  }
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    return 'כתובת דוא"ל לא תקינה';
  }
  return null;
}

/** Promote one contact to default; demote any existing default in the same
 *  household. Done in a transaction so the partial unique index can't trip. */
async function setSingleDefault(tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0], householdId: string, contactId: string) {
  await tx
    .update(schema.notificationContacts)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(schema.notificationContacts.householdId, householdId),
      eq(schema.notificationContacts.isDefault, true),
    ));
  await tx
    .update(schema.notificationContacts)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(
      eq(schema.notificationContacts.id, contactId),
      eq(schema.notificationContacts.householdId, householdId),
    ));
}

export async function createContact(input: ContactInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { householdId, db } = await requireUser();
    const err = validateContactInput(input);
    if (err) return { ok: false, error: err };

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.notificationContacts)
        .values({
          householdId,
          label:     input.label.trim(),
          phoneE164: input.phoneE164?.trim() || null,
          email:     input.email?.trim() || null,
          // Defer setting isDefault here — handled below to avoid the
          // partial unique index conflict if an existing default exists.
          isDefault: false,
        })
        .returning({ id: schema.notificationContacts.id });
      if (!row) throw new Error('insert_failed');
      if (input.isDefault) await setSingleDefault(tx, householdId, row.id);
      return row.id;
    });

    revalidatePath('/settings/notifications');
    revalidatePath('/notifications');
    return { ok: true, id };
  } catch (e) {
    console.error('createContact', e);
    return { ok: false, error: 'שגיאה ביצירת איש קשר' };
  }
}

export async function updateContact(id: string, input: ContactInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireUser();
    const err = validateContactInput(input);
    if (err) return { ok: false, error: err };

    await db.transaction(async (tx) => {
      await tx
        .update(schema.notificationContacts)
        .set({
          label:     input.label.trim(),
          phoneE164: input.phoneE164?.trim() || null,
          email:     input.email?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.notificationContacts.id, id),
          eq(schema.notificationContacts.householdId, householdId),
        ));
      if (input.isDefault) await setSingleDefault(tx, householdId, id);
    });

    revalidatePath('/settings/notifications');
    revalidatePath('/notifications');
    return { ok: true };
  } catch (e) {
    console.error('updateContact', e);
    return { ok: false, error: 'שגיאה בעדכון איש קשר' };
  }
}

export async function deleteContact(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireUser();
    // Guard: refuse to delete the LAST contact — without one, the user has
    // no way to receive notifications other than the legacy fallback.
    const remaining = await db
      .select({ id: schema.notificationContacts.id })
      .from(schema.notificationContacts)
      .where(eq(schema.notificationContacts.householdId, householdId));
    if (remaining.length <= 1) {
      return { ok: false, error: 'חייב להישאר לפחות איש קשר אחד' };
    }
    await db
      .delete(schema.notificationContacts)
      .where(and(
        eq(schema.notificationContacts.id, id),
        eq(schema.notificationContacts.householdId, householdId),
      ));
    revalidatePath('/settings/notifications');
    revalidatePath('/notifications');
    return { ok: true };
  } catch (e) {
    console.error('deleteContact', e);
    return { ok: false, error: 'שגיאה במחיקת איש קשר' };
  }
}

/** Server-side helper for pages that need the contacts list. */
export async function listContacts() {
  const { householdId, db } = await requireUser();
  const rows = await db
    .select({
      id:        schema.notificationContacts.id,
      label:     schema.notificationContacts.label,
      phoneE164: schema.notificationContacts.phoneE164,
      email:     schema.notificationContacts.email,
      isDefault: schema.notificationContacts.isDefault,
    })
    .from(schema.notificationContacts)
    .where(eq(schema.notificationContacts.householdId, householdId))
    .orderBy(schema.notificationContacts.isDefault, schema.notificationContacts.label);
  // Sort: default first, then alphabetical by label.
  return rows.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.label.localeCompare(b.label, 'he');
  });
}

// Light helper that exposes the household's recent in-app events to the bell.
// Caller is the GlobalHeader server-side wrapper.
export async function getRecentInAppEvents(limit = 30) {
  const { householdId, db } = await requireUser();
  const rows = await db
    .select({
      id:            schema.notificationEvents.id,
      taskId:        schema.notificationEvents.taskId,
      title:         schema.notificationEvents.titleSnapshot,
      body:          schema.notificationEvents.bodySnapshot,
      fireAt:        schema.notificationEvents.fireAt,
      state:         schema.notificationEvents.state,
    })
    .from(schema.notificationEvents)
    .where(and(
      eq(schema.notificationEvents.householdId, householdId),
      eq(schema.notificationEvents.channel, 'in_app'),
    ))
    .orderBy(sql`${schema.notificationEvents.fireAt} DESC`)
    .limit(limit);
  return rows;
}
