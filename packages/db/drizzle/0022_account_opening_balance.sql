-- Cumulative balance feature.
--
-- Adds two columns to the `account` table that together act as an "anchor"
-- for computing the account's cumulative balance at any point in time:
--   - opening_balance_ils:    the known balance at a known date
--   - opening_balance_as_of:  the date that balance was true (nullable)
--
-- The dashboard's new "יתרה מצטברת בפועל" KPI computes:
--   balance(account, asOfDate) =
--     opening_balance_ils
--   + SUM(amount_ils) FROM transactions
--       WHERE account_id = account.id
--         AND deleted_at IS NULL
--         AND is_projected = false
--         AND excluded_from_totals = false
--         AND charge_date <= asOfDate
--         AND (opening_balance_as_of IS NULL OR charge_date >= opening_balance_as_of)
--
-- See infra/README.md or apps/web/src/app/(app)/page.tsx for usage.

ALTER TABLE "account" ADD COLUMN "opening_balance_ils" numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "account" ADD COLUMN "opening_balance_as_of" date;
