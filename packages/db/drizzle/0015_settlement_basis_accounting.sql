-- Phase 1 of the "settlement-basis accounting" shift on /insights.
--
-- Adds two columns:
--   1. account.settlement_merchant_pattern  — for credit-card accounts, this
--      is the merchant-name substring used to find the matching settlement
--      line on the linked bank account (e.g. "דיינרס" matches the bank-side
--      "דיינרס קלוב-י -₪41,349" row that pays for this CC's monthly cycle).
--      NULL for bank accounts and for CCs the user hasn't configured yet.
--      The importer auto-suggests a value the first time it detects a
--      matching settlement row.
--
--   2. transaction.excluded_from_totals — when TRUE, this row is rendered in
--      lists but excluded from spending math (KPI totals, cycle banner,
--      insights cards, dashboard tiles, etc.).
--      Set on non-forex CC detail rows under the new accounting model — the
--      bank-side settlement line is the source of truth for those, and
--      counting both would double-count.
--      Forex CC details keep this FALSE — they're charged immediately by
--      the bank and have no settlement line bundling them.
--      The migration leaves all existing rows at the default (false).
--      Phase 4 (data wipe + re-upload) is what actually populates the new
--      flag correctly across the historical data.

ALTER TABLE account
  ADD COLUMN settlement_merchant_pattern text;

ALTER TABLE transaction
  ADD COLUMN excluded_from_totals boolean NOT NULL DEFAULT false;

-- Index to keep filter queries fast — most aggregation queries will WHERE
-- on excluded_from_totals = false alongside household_id + billing_month.
-- Partial index (only index the small minority of rows where the flag is true)
-- keeps the index small while still enabling fast filter on TRUE rows during
-- the validation/audit queries.
CREATE INDEX IF NOT EXISTS idx_transaction_excluded_from_totals
  ON transaction (household_id, billing_month)
  WHERE excluded_from_totals = true;
