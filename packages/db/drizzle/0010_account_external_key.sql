-- Migration 0010: external_key on account for file→account auto-detection.
-- Lets the user configure each account ONCE with the identifier their bank
-- ships in the export (CC last-4 like "7627", or full account number like
-- "669-4703428"). On import, if the user doesn't pick an account, the
-- importer extracts the same identifier from the file and routes to the
-- matching account automatically.
--
-- Plain text — no constraint on format because bank identifiers vary.
-- The matcher does case/whitespace-insensitive substring comparison so
-- minor formatting differences ("669-4703428" vs "6694703428") still pair.

ALTER TABLE "account" ADD COLUMN "external_key" text;

-- Help the matcher: case-insensitive index for fast lookup.
CREATE INDEX "account_external_key_idx" ON "account" (lower("external_key"));
