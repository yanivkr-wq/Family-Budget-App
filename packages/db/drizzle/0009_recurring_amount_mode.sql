-- Migration 0009: dynamic / range mode for recurring patterns
-- Three modes:
--   'fixed'   (default, legacy) → expected_amount_ils is the ONE expected amount
--   'range'   → expected = midpoint, min/max define the validation window
--   'dynamic' → no fixed amount; the actual transaction amount wins each cycle
-- Used for variable bills like electricity (changes every month) or insurance
-- (small monthly drift like 194.5 → 196.7 ₪).

ALTER TABLE "recurring_pattern"
  ADD COLUMN "amount_mode" text NOT NULL DEFAULT 'fixed',
  ADD COLUMN "min_amount_ils" numeric(10, 2),
  ADD COLUMN "max_amount_ils" numeric(10, 2);
