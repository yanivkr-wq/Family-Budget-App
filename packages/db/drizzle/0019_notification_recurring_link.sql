-- Migration 0019 — Link notification tasks to recurring patterns
--
-- Adds a nullable foreign key from notification_task to recurring_pattern so
-- the user can attach a reminder directly to a subscription / monthly bill
-- (e.g. "remind me 7 days before my Netflix renewal" or "remind me 14 days
-- before my gym membership ends so I can cancel").
--
-- Mirrors the existing transaction_id link — both are nullable, both use
-- ON DELETE SET NULL so deleting the source pattern doesn't cascade-kill
-- the notification (the reminder might still be useful as a manual entry).

ALTER TABLE "notification_task"
  ADD COLUMN IF NOT EXISTS "recurring_pattern_id" uuid
    REFERENCES "recurring_pattern"("id") ON DELETE SET NULL;

-- Index for the /recurring page's "which patterns have a notification?"
-- lookup. Partial: only rows that actually have a link, since most rows
-- won't and we never need to scan the NULL ones.
CREATE INDEX IF NOT EXISTS "notification_task_recurring_idx"
  ON "notification_task" ("household_id", "recurring_pattern_id")
  WHERE "recurring_pattern_id" IS NOT NULL;
