-- Migration 0020 — Multi-recipient notification contacts
--
-- Replaces the implicit "send WhatsApp to user.phone_e164 / send email to
-- user.email" model with an explicit, household-scoped contacts list.
--
-- New tables/columns:
--   notification_contact         — labeled recipient (label + phone + email)
--   notification_reminder.recipient_contact_ids
--                                — jsonb array of contact_ids; NULL means
--                                  legacy behavior (send to creator's user
--                                  profile)
--   notification_event.contact_id
--                                — which contact this fire was directed at;
--                                  NULL for legacy/no-contact events
--
-- The old single-phone field on user.phone_e164 stays as the default contact
-- seed but contacts are independently editable thereafter.

-- ── notification_contact ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_contact" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "label"        text NOT NULL,
  -- Both nullable: a contact may have only phone (no email) or vice versa.
  -- Channels with missing delivery info just skip for that contact.
  "phone_e164"   text,
  "email"        text,
  -- Default contact = the one that pre-selects on new reminders. Exactly
  -- one default per household (enforced by the partial unique index below).
  "is_default"   boolean NOT NULL DEFAULT false,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_contact_household_idx"
  ON "notification_contact" ("household_id");

-- At most one default contact per household. Partial index excludes the
-- non-default rows so multiple non-defaults coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_contact_one_default_per_household"
  ON "notification_contact" ("household_id")
  WHERE "is_default" = true;

-- ── notification_reminder.recipient_contact_ids ──────────────────────────────
ALTER TABLE "notification_reminder"
  ADD COLUMN IF NOT EXISTS "recipient_contact_ids" jsonb;

-- ── notification_event.contact_id ────────────────────────────────────────────
-- ON DELETE SET NULL because deleting a contact shouldn't lose the history of
-- past notifications that went to them — they just become "no longer
-- attributable". The unique constraint below keeps NULL distinct from itself
-- so re-firing to a since-deleted contact doesn't collide.
ALTER TABLE "notification_event"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid
    REFERENCES "notification_contact"("id") ON DELETE SET NULL;

-- Replace the old unique constraint with one that includes contact_id, so a
-- single (reminder × fire_at × channel) can fan out to multiple contacts
-- without collision. NULLS NOT DISTINCT (PG15+) treats NULL contact as a
-- single bucket so legacy events keep their de-dup behavior.
DROP INDEX IF EXISTS "notification_event_reminder_fire_uniq";
CREATE UNIQUE INDEX IF NOT EXISTS "notification_event_reminder_fire_uniq"
  ON "notification_event" ("reminder_id", "fire_at", "channel", "contact_id")
  NULLS NOT DISTINCT;

-- ── Backfill: create a default "Me" contact per household ───────────────────
-- For every household that doesn't yet have a contact, seed one from the
-- first user's email + phone. Subsequent users in the same household don't
-- get extra contacts auto-created; the user manages contacts manually after.
INSERT INTO "notification_contact" ("household_id", "label", "phone_e164", "email", "is_default")
SELECT DISTINCT ON (u."household_id")
  u."household_id",
  'אני',
  u."phone_e164",
  u."email",
  true
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_contact" c WHERE c."household_id" = u."household_id"
)
ORDER BY u."household_id", u."created_at" ASC;
