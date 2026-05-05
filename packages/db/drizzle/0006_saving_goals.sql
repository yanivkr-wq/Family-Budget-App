-- Migration 0006: savings goals module
-- Adds:
--   1. is_savings flag on category (marks categories that track savings deposits)
--   2. saving_goal table (Layer 2: named goals with balance tracking)

-- 1. Category: is_savings flag
ALTER TABLE "category" ADD COLUMN "is_savings" boolean NOT NULL DEFAULT false;

-- 2. saving_goal table
CREATE TABLE "saving_goal" (
  "id"                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id"             uuid         NOT NULL REFERENCES "household"("id") ON DELETE CASCADE,
  "name"                     text         NOT NULL,
  "description"              text,
  "icon"                     text,
  "color"                    text,
  "target_amount_ils"        numeric(12,2),
  "current_amount_ils"       numeric(12,2) NOT NULL DEFAULT 0,
  "monthly_contribution_ils" numeric(10,2),
  "target_date"              date,
  "status"                   text         NOT NULL DEFAULT 'active',
  "priority"                 integer      NOT NULL DEFAULT 0,
  "notes"                    text,
  "created_at"               timestamptz  NOT NULL DEFAULT now(),
  "updated_at"               timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX ON "saving_goal" ("household_id");
CREATE INDEX ON "saving_goal" ("household_id", "status");
