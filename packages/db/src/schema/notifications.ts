/**
 * Notifications & reminders schema.
 *
 * Three tables that together implement scheduled budget reminders:
 *
 *   notificationTasks      — the user-facing item (e.g. "Pay arnona Q1 2026").
 *                            Owns due_date and an aggregate status.
 *   notificationReminders  — one row per fire-interval (7d before, 3d before,
 *                            on day). Carries its own per-channel toggles so a
 *                            single task can mix delivery methods.
 *   notificationEvents     — append-only log of dispatched / queued messages.
 *                            One row per (reminder × channel) firing. The
 *                            in-app bell reads from this table.
 *
 * See migration 0018 for the table-level constraints and indexes.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { households, users } from './identity';
import { categories, transactions, recurringPatterns } from './finance';

/** Per-channel toggle blob stored in notification_reminder.channels. */
export interface ReminderChannelPrefs {
  in_app:   boolean;
  email:    boolean;
  whatsapp: boolean;
}

/** Channel id values used by notification_event.channel + the worker. */
export type NotificationChannel = 'in_app' | 'email' | 'whatsapp';

// ── notification_contact ────────────────────────────────────────────────────
/**
 * Household-scoped recipient for notifications. Each contact has a label
 * (e.g. "אני", "אישה", "אמא") and optional phone + email. A reminder picks
 * which contacts to notify via notification_reminder.recipientContactIds.
 *
 * One contact per household is marked is_default and pre-selects on new
 * reminders. Migration 0020 backfills one default "אני" contact per
 * household using the first user's profile.
 */
export const notificationContacts = pgTable(
  'notification_contact',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    phoneE164: text('phone_e164'),
    email: text(),
    isDefault: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index('notification_contact_household_idx').on(t.householdId),
  }),
);

// ── notification_task ───────────────────────────────────────────────────────
export const notificationTasks = pgTable(
  'notification_task',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    dueDate: date().notNull(),
    /**
     * 'active'    — fires reminders normally
     * 'paused'    — kept on file but reminders skipped
     * 'completed' — user marked done; no further reminders, history preserved
     * 'cancelled' — user no longer needs; no further reminders, history preserved
     */
    status: text({ enum: ['active', 'paused', 'completed', 'cancelled'] })
      .notNull()
      .default('active'),
    /**
     * Recurrence cadence. When non-'none', completing the task auto-creates
     * a sibling for the next cycle (handled by markTaskCompleted action).
     */
    recurrence: text({ enum: ['none', 'monthly', 'quarterly', 'yearly'] })
      .notNull()
      .default('none'),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    /** Optional link to the txn the user clicked the bell on. */
    transactionId: uuid().references(() => transactions.id, { onDelete: 'set null' }),
    /**
     * Optional link to the recurring pattern this reminder is about (e.g.
     * "remind me 7 days before Netflix renews"). Set when the user clicks
     * the bell on a row in /recurring. Either this OR transactionId may be
     * set (or both for fully-tagged reminders), or neither for
     * standalone tasks created from /notifications.
     */
    recurringPatternId: uuid().references(() => recurringPatterns.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx:    index('notification_task_household_idx').on(t.householdId),
    dueActiveIdx:    index('notification_task_due_active_idx').on(t.dueDate),
    recurringIdx:    index('notification_task_recurring_idx').on(t.householdId, t.recurringPatternId),
  }),
);

// ── notification_reminder ───────────────────────────────────────────────────
export const notificationReminders = pgTable(
  'notification_reminder',
  {
    id: uuid().defaultRandom().primaryKey(),
    taskId: uuid()
      .notNull()
      .references(() => notificationTasks.id, { onDelete: 'cascade' }),
    /** Days BEFORE due_date to fire. 0 = on the due date itself. */
    offsetDays: integer().notNull().default(0),
    /** Time-of-day in the household TZ; default 09:00. */
    fireTime: time().notNull().default('09:00:00'),
    /** Per-channel toggles. JSON for forward-compat with new channels. */
    channels: jsonb().$type<ReminderChannelPrefs>().notNull().default({
      in_app: true,
      email: false,
      whatsapp: false,
    }),
    /**
     * Which household contacts should receive this reminder. JSONB array
     * of contact UUIDs. NULL means legacy behavior — fall back to the
     * task creator's user profile (user.email + user.phoneE164). New
     * reminders should always populate this with at least one contact.
     */
    recipientContactIds: jsonb('recipient_contact_ids').$type<string[]>(),
    /** Independent enable flag so one of N reminders can be muted. */
    enabled: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    taskIdx:    index('notification_reminder_task_idx').on(t.taskId),
    uniqOffset: unique().on(t.taskId, t.offsetDays, t.fireTime),
  }),
);

// ── notification_event ──────────────────────────────────────────────────────
export const notificationEvents = pgTable(
  'notification_event',
  {
    id: uuid().defaultRandom().primaryKey(),
    reminderId: uuid()
      .notNull()
      .references(() => notificationReminders.id, { onDelete: 'cascade' }),
    taskId: uuid()
      .notNull()
      .references(() => notificationTasks.id, { onDelete: 'cascade' }),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fireAt: timestamp({ withTimezone: true }).notNull(),
    channel: text({ enum: ['in_app', 'email', 'whatsapp'] }).notNull(),
    /**
     * Which contact this event was directed at. NULL for legacy / no-contact
     * events (fallback to creator's profile). Composite uniqueness with
     * (reminder_id, fire_at, channel) lets a single reminder fan out to
     * multiple contacts on the same fire without collision.
     */
    contactId: uuid('contact_id').references(() => notificationContacts.id, { onDelete: 'set null' }),
    /**
     * 'pending' — created, not yet dispatched
     * 'sent'    — delivered to provider
     * 'failed'  — provider returned error
     * 'skipped' — channel disabled / no contact info
     * 'read'    — in_app: user clicked it in the bell dropdown
     */
    state: text({ enum: ['pending', 'sent', 'failed', 'skipped', 'read'] })
      .notNull()
      .default('pending'),
    sentAt: timestamp({ withTimezone: true }),
    errorMsg: text(),
    /** Frozen at fire-time so editing the task later doesn't rewrite history. */
    titleSnapshot: text().notNull(),
    bodySnapshot: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Compound unique on (reminder, fire_at, channel, contact_id) is the
    // worker's de-dupe key — a single reminder fires one event per
    // (channel × contact) per scheduled time. NULLS NOT DISTINCT semantics
    // are enforced at the SQL layer (migration 0020); Drizzle's unique()
    // helper alone doesn't express it but the runtime DDL has it.
    reminderFireUniq: unique('notification_event_reminder_fire_uniq').on(
      t.reminderId,
      t.fireAt,
      t.channel,
      t.contactId,
    ),
    householdRecentIdx: index('notification_event_household_recent_idx').on(
      t.householdId,
      t.fireAt,
    ),
  }),
);

// ── relations ───────────────────────────────────────────────────────────────
export const notificationTasksRelations = relations(notificationTasks, ({ many, one }) => ({
  reminders: many(notificationReminders),
  household: one(households, { fields: [notificationTasks.householdId], references: [households.id] }),
  createdBy: one(users, { fields: [notificationTasks.createdByUserId], references: [users.id] }),
  transaction: one(transactions, { fields: [notificationTasks.transactionId], references: [transactions.id] }),
  recurringPattern: one(recurringPatterns, { fields: [notificationTasks.recurringPatternId], references: [recurringPatterns.id] }),
}));

export const notificationRemindersRelations = relations(notificationReminders, ({ one, many }) => ({
  task: one(notificationTasks, { fields: [notificationReminders.taskId], references: [notificationTasks.id] }),
  events: many(notificationEvents),
}));

export const notificationEventsRelations = relations(notificationEvents, ({ one }) => ({
  reminder: one(notificationReminders, { fields: [notificationEvents.reminderId], references: [notificationReminders.id] }),
  task: one(notificationTasks, { fields: [notificationEvents.taskId], references: [notificationTasks.id] }),
  user: one(users, { fields: [notificationEvents.userId], references: [users.id] }),
  contact: one(notificationContacts, { fields: [notificationEvents.contactId], references: [notificationContacts.id] }),
}));

export const notificationContactsRelations = relations(notificationContacts, ({ one }) => ({
  household: one(households, { fields: [notificationContacts.householdId], references: [households.id] }),
}));
