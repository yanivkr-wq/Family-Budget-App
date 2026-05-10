/**
 * Notification dispatcher — the cron-driven heart of the reminders system.
 *
 * Tick logic (every REMINDER_CRON, default every 5 min):
 *
 *   1. Scan ENABLED reminders attached to ACTIVE tasks where the computed
 *      fire-instant (due_date - offset_days, at fire_time, in TZ) sits
 *      within the look-back / look-ahead window of "now".
 *
 *   2. For each (reminder × enabled-channel) combo, INSERT a notification_event
 *      with state='pending'. The (reminder_id, fire_at, channel) UNIQUE
 *      constraint de-dupes — re-running the cron in the same window is
 *      idempotent, no double-fires.
 *
 *   3. For each freshly-pending event, call the channel adapter. Update the
 *      event row to 'sent' / 'failed' / 'skipped' with sent_at + error_msg.
 *
 * Why a look-back window? If the worker was down at the exact fire-time we
 * want to catch up on the next tick. WINDOW_BACK_HOURS bounds how far back
 * we'll fire stale reminders — anything older is silently dropped (better
 * than spamming the user about yesterday's due date at 3am).
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import type { Config } from '../config';
import { sendEmail, sendInApp, sendWhatsApp, type ChannelOutcome } from './channels';
import type { ReminderChannelPrefs, NotificationChannel } from '@fba/db';
import type { FastifyBaseLogger } from 'fastify';

const WINDOW_BACK_HOURS = 6;
const WINDOW_FORWARD_MINUTES = 1;

interface DueReminderRow {
  reminderId:           string;
  offsetDays:           number;
  fireTime:             string; // 'HH:MM:SS'
  channels:             ReminderChannelPrefs;
  recipientContactIds:  string[] | null;
  enabled:              boolean;
  taskId:               string;
  title:                string;
  description:          string | null;
  dueDate:              string;
  status:               string;
  householdId:          string;
  userId:               string;
  userEmail:            string | null;
  userPhone:            string | null;
}

/** A single recipient + its delivery info. NULL contact_id = legacy
 *  fallback (the task creator's user profile). */
interface Recipient {
  contactId: string | null;
  email:     string | null;
  phone:     string | null;
}

/** One full dispatcher tick. Safe to call concurrently — the unique index protects. */
export async function dispatchDueReminders(opts: {
  config: Config;
  logger: FastifyBaseLogger;
}): Promise<{ scanned: number; fired: number }> {
  const { config, logger } = opts;
  const db = getDb();

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_BACK_HOURS * 3_600_000);
  const windowEnd   = new Date(now.getTime() + WINDOW_FORWARD_MINUTES * 60_000);

  // Pull every active reminder that COULD plausibly be due in this window.
  // We over-fetch by date and refine in JS — small reminder counts so a tight
  // SQL filter isn't worth the complexity. Date math: a reminder with
  // offset_days=7 fires when (today + 7) >= due_date AND (today + 7) <=
  // due_date + back_window_days. Easier: compute fire_at per row in JS.
  const rows = await db
    .select({
      reminderId:           schema.notificationReminders.id,
      offsetDays:           schema.notificationReminders.offsetDays,
      fireTime:             schema.notificationReminders.fireTime,
      channels:             schema.notificationReminders.channels,
      recipientContactIds:  schema.notificationReminders.recipientContactIds,
      enabled:              schema.notificationReminders.enabled,
      taskId:               schema.notificationTasks.id,
      title:                schema.notificationTasks.title,
      description:          schema.notificationTasks.description,
      dueDate:              schema.notificationTasks.dueDate,
      status:               schema.notificationTasks.status,
      householdId:          schema.notificationTasks.householdId,
      userId:               schema.notificationTasks.createdByUserId,
      userEmail:            schema.users.email,
      userPhone:            schema.users.phoneE164,
    })
    .from(schema.notificationReminders)
    .innerJoin(
      schema.notificationTasks,
      eq(schema.notificationReminders.taskId, schema.notificationTasks.id),
    )
    .innerJoin(
      schema.users,
      eq(schema.notificationTasks.createdByUserId, schema.users.id),
    )
    .where(
      and(
        eq(schema.notificationReminders.enabled, true),
        eq(schema.notificationTasks.status, 'active'),
      ),
    );

  // Pre-fetch all referenced contacts in one shot so the per-row dispatch
  // loop doesn't N+1 query. Build a contact_id -> {email, phone} map.
  const allContactIds = new Set<string>();
  for (const r of rows as DueReminderRow[]) {
    if (r.recipientContactIds) {
      for (const cid of r.recipientContactIds) allContactIds.add(cid);
    }
  }
  const contactMap = new Map<string, { email: string | null; phone: string | null }>();
  if (allContactIds.size > 0) {
    const contacts = await db
      .select({
        id:        schema.notificationContacts.id,
        email:     schema.notificationContacts.email,
        phoneE164: schema.notificationContacts.phoneE164,
      })
      .from(schema.notificationContacts)
      .where(inArray(schema.notificationContacts.id, Array.from(allContactIds)));
    for (const c of contacts) {
      contactMap.set(c.id, { email: c.email, phone: c.phoneE164 });
    }
  }

  let fired = 0;
  for (const r of rows as DueReminderRow[]) {
    const fireAt = computeFireAt(r.dueDate, r.offsetDays, r.fireTime, config.TZ);
    if (!fireAt) continue;
    if (fireAt < windowStart || fireAt > windowEnd) continue;

    // Build the per-channel set the user enabled.
    const channels: NotificationChannel[] = [];
    if (r.channels?.in_app)   channels.push('in_app');
    if (r.channels?.email)    channels.push('email');
    if (r.channels?.whatsapp) channels.push('whatsapp');
    if (channels.length === 0) continue;

    // Resolve recipients for this reminder.
    //   - recipientContactIds populated  → fan out to each contact
    //   - null/empty                     → legacy fallback to creator's profile
    const recipients: Recipient[] = [];
    if (r.recipientContactIds && r.recipientContactIds.length > 0) {
      for (const cid of r.recipientContactIds) {
        const c = contactMap.get(cid);
        if (!c) continue; // contact was deleted between query and dispatch
        recipients.push({ contactId: cid, email: c.email, phone: c.phone });
      }
    } else {
      recipients.push({ contactId: null, email: r.userEmail, phone: r.userPhone });
    }
    if (recipients.length === 0) continue;

    // Bodies are channel-specific:
    //   - in_app / WhatsApp → terse text (saved in body_snapshot too)
    //   - email             → adds a "Mark done" link at the end so the
    //                         recipient can complete the task from inbox
    const plainBody = buildBody(r);
    const emailBody = buildEmailBody(r, config.APP_URL);

    // in_app is special: the bell is a shared household-level surface, so
    // one event covers all recipients. Fire it once with contact_id = NULL
    // before fanning out the per-recipient channels (email/whatsapp).
    if (r.channels?.in_app) {
      await fireOne({
        db, config, logger,
        r, fireAt,
        channel: 'in_app',
        contactId: null,
        toEmail: null,
        toPhone: null,
        body: plainBody,
      }).then((didFire) => { if (didFire) fired += 1; });
    }

    // Fan out email + whatsapp per recipient.
    for (const recipient of recipients) {
      for (const channel of channels) {
        if (channel === 'in_app') continue; // handled above
        await fireOne({
          db, config, logger,
          r, fireAt,
          channel,
          contactId: recipient.contactId,
          toEmail: recipient.email,
          toPhone: recipient.phone,
          body: channel === 'email' ? emailBody : plainBody,
        }).then((didFire) => { if (didFire) fired += 1; });
      }
    }
  }

  return { scanned: rows.length, fired };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Insert + dispatch a single (channel, contact) firing for a reminder.
 *  Returns true if a new event was fired (false on de-dup conflict). */
async function fireOne(opts: {
  db:        ReturnType<typeof getDb>;
  config:    Config;
  logger:    FastifyBaseLogger;
  r:         DueReminderRow;
  fireAt:    Date;
  channel:   NotificationChannel;
  contactId: string | null;
  toEmail:   string | null;
  toPhone:   string | null;
  body:      string;
}): Promise<boolean> {
  const { db, config, logger, r, fireAt, channel, contactId, toEmail, toPhone, body } = opts;

  const inserted = await db
    .insert(schema.notificationEvents)
    .values({
      reminderId:    r.reminderId,
      taskId:        r.taskId,
      householdId:   r.householdId,
      userId:        r.userId,
      contactId,
      fireAt,
      channel,
      state:         'pending',
      titleSnapshot: r.title,
      bodySnapshot:  body,
    })
    .onConflictDoNothing({
      target: [
        schema.notificationEvents.reminderId,
        schema.notificationEvents.fireAt,
        schema.notificationEvents.channel,
        schema.notificationEvents.contactId,
      ],
    })
    .returning({ id: schema.notificationEvents.id });

  if (inserted.length === 0) return false;
  const eventId = inserted[0]!.id;

  const outcome = await dispatchOne(channel, {
    toEmail, toPhone, title: r.title, body,
  }, config);

  await db
    .update(schema.notificationEvents)
    .set(buildUpdate(outcome))
    .where(eq(schema.notificationEvents.id, eventId));

  if (!outcome.ok && !('skipped' in outcome && outcome.skipped)) {
    logger.warn(
      { eventId, channel, contactId, error: 'error' in outcome ? outcome.error : undefined },
      'notification dispatch failed',
    );
  }
  return true;
}


function computeFireAt(
  dueDate: string,
  offsetDays: number,
  fireTime: string,
  tz: string,
): Date | null {
  // dueDate is 'YYYY-MM-DD'; we want (dueDate - offsetDays) at fireTime in TZ.
  const parts = dueDate.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const timeParts = fireTime.split(':');
  const hh = Number(timeParts[0] ?? '9');
  const mm = Number(timeParts[1] ?? '0');

  // Build the local-wall-clock instant in the household TZ. We approximate
  // by computing UTC for that wall-time using a TZ-offset lookup. For the
  // common case (Asia/Jerusalem with DST) this is close enough — worst case
  // a reminder fires an hour off twice a year. A precise tzdata library
  // would fix that; not worth the dep yet.
  const localDate = new Date(Date.UTC(y, m - 1, d - offsetDays, hh, mm, 0));
  const offsetMin = tzOffsetMinutes(localDate, tz);
  return new Date(localDate.getTime() - offsetMin * 60_000);
}

/**
 * Approximate TZ offset (in minutes east of UTC) for `date` in `tz`. Uses
 * Intl.DateTimeFormat which handles DST correctly. Returns 0 on failure.
 */
function tzOffsetMinutes(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get('year'), get('month') - 1, get('day'),
      get('hour'), get('minute'), get('second'),
    );
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** Body shown in the in-app bell + WhatsApp message. Plain text. */
function buildBody(r: DueReminderRow): string {
  const lines: string[] = [];
  if (r.description) lines.push(r.description, '');
  lines.push(`תאריך יעד: ${r.dueDate}`);
  if (r.offsetDays > 0) {
    lines.push(`התראה ${r.offsetDays} ימים לפני`);
  } else if (r.offsetDays === 0) {
    lines.push('התראה ביום היעד');
  } else {
    lines.push(`התראה ${Math.abs(r.offsetDays)} ימים אחרי תאריך היעד`);
  }
  return lines.join('\n');
}

/** Body specialized for email — adds a "Mark done" link at the end so the
 *  recipient can complete the task from their inbox in one click. */
function buildEmailBody(r: DueReminderRow, appUrl: string): string {
  const baseBody = buildBody(r);
  const doneUrl = `${appUrl.replace(/\/$/, '')}/notifications?done=${encodeURIComponent(r.taskId)}`;
  return `${baseBody}\n\n— — —\nסיימת? סמני כבוצע: ${doneUrl}`;
}

async function dispatchOne(
  channel: NotificationChannel,
  msg: { toEmail: string | null; toPhone: string | null; title: string; body: string },
  config: Config,
): Promise<ChannelOutcome> {
  switch (channel) {
    case 'in_app':   return sendInApp(msg);
    case 'email':    return sendEmail(msg, config);
    case 'whatsapp': return sendWhatsApp(msg, config);
  }
}

function buildUpdate(outcome: ChannelOutcome) {
  if (outcome.ok) {
    return { state: 'sent' as const, sentAt: new Date() };
  }
  if ('skipped' in outcome && outcome.skipped) {
    return { state: 'skipped' as const, errorMsg: outcome.reason };
  }
  return { state: 'failed' as const, errorMsg: 'error' in outcome ? outcome.error : 'unknown' };
}

// Re-exports for the cron registrar.
export { sendEmail, sendInApp, sendWhatsApp };
