-- Migration 0011: feedback log
-- A day-to-day diary the admin uses to capture UX issues, bugs, and
-- feature ideas WHILE using the app. Later exported as Markdown and
-- handed to Claude Code so changes can be made.

CREATE TABLE "feedback" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "category"     text NOT NULL DEFAULT 'other'
    CHECK ("category" IN ('bug', 'ux', 'feature', 'other')),
  "message"      text NOT NULL,
  "page_path"    text,         -- where the user was when they wrote it
  "user_agent"   text,         -- browser / device hint, useful for repro
  "status"       text NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open', 'in_progress', 'resolved', 'dismissed')),
  "resolved_at"  timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "feedback_household_idx" ON "feedback" ("household_id", "created_at" DESC);
CREATE INDEX "feedback_status_idx"    ON "feedback" ("household_id", "status");
