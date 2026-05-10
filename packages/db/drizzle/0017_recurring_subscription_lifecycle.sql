-- Migration 0017 — subscription lifecycle on recurring_pattern
--
-- Adds the missing pieces for tracking when a subscription ends or renews:
--   • subscription_end_date — explicit "this period ends on" date. NULL means
--     open-ended / no defined end (the historical default for everything we've
--     auto-detected so far).
--   • auto_renew — does the subscription roll over by itself? Defaults to TRUE
--     because that's how most monthly services behave (Netflix, Spotify, gym).
--     User can flip to FALSE for fixed-term contracts that need manual renewal.
--   • cancel_notice_days — how many days BEFORE the end date the user must
--     cancel to avoid auto-renewal. Used by the "expiring soon" insight to
--     flag patterns where the cancel deadline is approaching, not just the
--     end date itself. Defaults to 0 (no notice required).
--
-- All three are nullable / defaulted so this is a non-breaking change for
-- existing patterns. The form / list defaults to "no end date set" which
-- matches today's behavior exactly.

ALTER TABLE "recurring_pattern"
  ADD COLUMN IF NOT EXISTS "subscription_end_date" date,
  ADD COLUMN IF NOT EXISTS "auto_renew" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cancel_notice_days" integer NOT NULL DEFAULT 0;

-- Index to speed up the "expiring within N days" query — narrow partial index
-- since most rows will have NULL end_date and we never need to scan those.
CREATE INDEX IF NOT EXISTS "recurring_pattern_end_date_idx"
  ON "recurring_pattern" ("household_id", "subscription_end_date")
  WHERE "subscription_end_date" IS NOT NULL;
