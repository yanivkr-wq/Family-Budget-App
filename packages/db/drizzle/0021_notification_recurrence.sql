-- Migration 0021 — Recurring notification tasks
--
-- Adds a recurrence dimension to notification_task so tasks like
-- "Pay arnona Q2 2026" can auto-respawn the next instance when marked
-- done — instead of requiring the user to manually clone the task four
-- times a year.
--
-- Behavior (enforced in the markTaskCompleted server action, not in SQL):
--   - When a task is marked status='completed' AND recurrence != 'none',
--     a sibling task is created with the same title/description/category/
--     contacts/reminders, but due_date shifted forward by one cycle.
--   - The original completed task stays around for history.
--
-- Recurrence values intentionally lean on the same vocabulary as
-- recurring_pattern.frequency so the user doesn't have to learn a new
-- one. 'none' is the default for backward compatibility — existing
-- tasks behave exactly as before.

ALTER TABLE "notification_task"
  ADD COLUMN IF NOT EXISTS "recurrence" text NOT NULL DEFAULT 'none'
    CHECK ("recurrence" IN ('none','monthly','quarterly','yearly'));
