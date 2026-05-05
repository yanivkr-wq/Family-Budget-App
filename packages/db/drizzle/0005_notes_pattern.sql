-- Migration 0005: add notes_pattern and notes_match_type to category_rule
-- These columns allow rules to require a secondary AND-condition on the transaction's notes field.
-- null notes_pattern = no notes check (backward compatible).

ALTER TABLE "category_rule" ADD COLUMN "notes_pattern" text;
ALTER TABLE "category_rule" ADD COLUMN "notes_match_type" text DEFAULT 'contains';
