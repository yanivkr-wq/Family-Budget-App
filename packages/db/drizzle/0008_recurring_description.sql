-- Migration 0008: add `description` column to recurring_pattern
-- Lets the user separate "WHO charges them" (merchantNormalized — used as
-- the join key for the קבוע badge) from "WHAT it pays for" (description —
-- a human-readable label like "Spotify Family", "iPhone 15 Pro תשלום
-- N/24", "ביטוח דירה הראל"). Backward compatible: null = legacy rows.

ALTER TABLE "recurring_pattern" ADD COLUMN "description" text;
