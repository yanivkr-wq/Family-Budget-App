-- Performance indexes added in optimization pass
-- These cover the two hottest query patterns on the transactions table.

-- (1) Dashboard hot path: household + billingMonth + is_projected
--     Covers: SELECT … WHERE household_id = ? AND billing_month = ? AND deleted_at IS NULL AND is_projected = false
CREATE INDEX IF NOT EXISTS "transaction_billing_month_active_idx"
  ON "transaction" ("household_id", "billing_month", "is_projected");

-- (2) Charge-date breakdown on the dashboard
--     Covers: WHERE … AND (charge_date IS NULL OR charge_date <= ?)
--             and WHERE … AND charge_date IS NOT NULL AND charge_date > ?
CREATE INDEX IF NOT EXISTS "transaction_charge_date_idx"
  ON "transaction" ("household_id", "charge_date");
