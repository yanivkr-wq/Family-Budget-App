-- Migration 0018 — Notifications & reminders system
--
-- Three tables forming the lifecycle of a budget reminder:
--
--   notification_task     — the user-facing item (e.g. "Pay arnona Q1 2026")
--                          One task may carry many reminders.
--   notification_reminder — one row per "fire interval" (7d before, 3d before,
--                          on due date). Each carries its own channel set so
--                          the user can pick e.g. email-only for the early
--                          warning and whatsapp+in-app for the final ping.
--   notification_event    — append-only log of dispatched (or to-be-dispatched)
--                          messages. The worker creates these and updates state
--                          as channels acknowledge / fail. Also drives the
--                          in-app bell dropdown.
--
-- Plus: user.phone_e164 — required for WhatsApp delivery (E.164 format,
-- e.g. +972501234567). Email comes from the existing user.email.

-- ── User contact ─────────────────────────────────────────────────────────────
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "phone_e164" text;

-- ── notification_task ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_task" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id"      uuid NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "created_by_user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title"             text NOT NULL,
  "description"       text,
  "due_date"          date NOT NULL,
  -- 'active'    — fires reminders normally
  -- 'paused'    — kept on file but no reminders fire
  -- 'completed' — user marked done; no further reminders, kept for history
  -- 'cancelled' — user no longer needs; no further reminders, kept for history
  "status"            text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active','paused','completed','cancelled')),
  "category_id"       uuid REFERENCES "category"("id") ON DELETE SET NULL,
  -- Optional link to the transaction the user clicked the bell on. Null when
  -- the task was created standalone via /notifications.
  "transaction_id"    uuid REFERENCES "transaction"("id") ON DELETE SET NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_task_household_idx"
  ON "notification_task" ("household_id");

-- Partial index for the cron job: only "active" tasks with future-ish dates
-- need scanning. Cleanup of completed/cancelled tasks won't slow it down.
CREATE INDEX IF NOT EXISTS "notification_task_due_active_idx"
  ON "notification_task" ("due_date")
  WHERE "status" = 'active';

-- ── notification_reminder ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_reminder" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id"        uuid NOT NULL REFERENCES "notification_task"("id") ON DELETE CASCADE,
  -- Days BEFORE the task's due_date to fire. 0 = on the due date itself.
  -- Negative is allowed (e.g. -1 for "day after" reminders, useful for
  -- confirmations) but not exposed in the form for the v1 design.
  "offset_days"    integer NOT NULL DEFAULT 0,
  -- Time-of-day in the household's local TZ. Stored as HH:MM:SS for clarity.
  -- Defaults to 09:00 because that's when most actionable reminders are read.
  "fire_time"      time NOT NULL DEFAULT '09:00:00',
  -- jsonb {email: bool, whatsapp: bool, in_app: bool}. We use jsonb (not three
  -- columns or an enum array) because future channels (Slack, push) plug in
  -- without a schema change.
  "channels"       jsonb NOT NULL DEFAULT '{"in_app":true,"email":false,"whatsapp":false}'::jsonb,
  -- Per-reminder enable flag — separate from task.status so a user can disable
  -- one reminder of a multi-reminder task without nuking the rest.
  "enabled"        boolean NOT NULL DEFAULT true,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  -- A given task shouldn't have two reminders at the same offset+time — that's
  -- almost always a UI mistake, never legitimate.
  UNIQUE ("task_id", "offset_days", "fire_time")
);

CREATE INDEX IF NOT EXISTS "notification_reminder_task_idx"
  ON "notification_reminder" ("task_id");

-- ── notification_event ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_event" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reminder_id"  uuid NOT NULL REFERENCES "notification_reminder"("id") ON DELETE CASCADE,
  "task_id"      uuid NOT NULL REFERENCES "notification_task"("id") ON DELETE CASCADE,
  "household_id" uuid NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "user_id"      uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- When this event was/should be fired (already in TZ-localized timestamptz).
  "fire_at"      timestamptz NOT NULL,
  -- Which channel produced this event. Each (reminder × channel) gets its own
  -- event row so we can track per-channel success/failure independently.
  "channel"      text NOT NULL CHECK ("channel" IN ('in_app','email','whatsapp')),
  -- 'pending' (created, not yet dispatched), 'sent' (delivered to provider),
  -- 'failed' (provider returned error), 'skipped' (channel disabled or no
  -- contact info). 'read' is in_app-only and tracks the bell dropdown.
  "state"        text NOT NULL DEFAULT 'pending'
    CHECK ("state" IN ('pending','sent','failed','skipped','read')),
  "sent_at"      timestamptz,
  "error_msg"    text,
  -- Snapshotted text shown in the in-app bell — frozen at fire-time so editing
  -- the task later doesn't rewrite history.
  "title_snapshot"   text NOT NULL,
  "body_snapshot"    text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

-- Cron lookup: "what's due in the last/next few minutes that I haven't
-- already created an event for". The (reminder_id, fire_at) compound is the
-- de-dupe key the worker uses.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_event_reminder_fire_uniq"
  ON "notification_event" ("reminder_id", "fire_at", "channel");

-- Bell dropdown query: "give me last N events for this household by recency".
CREATE INDEX IF NOT EXISTS "notification_event_household_recent_idx"
  ON "notification_event" ("household_id", "fire_at" DESC);
