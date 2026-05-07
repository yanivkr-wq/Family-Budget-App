/**
 * Helper: SQL fragment that excludes transactions tagged to projects
 * with `excludeFromMonthlyTotals = true`.
 *
 * Lives in @fba/db so both apps/web and packages/chatbot can share it.
 *
 * Semantics (each row matches when):
 *   • transaction.projectId IS NULL                              → keep
 *   • transaction.includeInMonthlyOverride = true                → keep (per-row override)
 *   • transaction.projectId → project.excludeFromMonthlyTotals=true → DROP
 *   • transaction.projectId → project.excludeFromMonthlyTotals=false → keep
 *
 * The per-row override (`includeInMonthlyOverride=true`) lets the user
 * model the capex/opex split: a ₪200K transfer to the contractor stays
 * project-only, but a ₪400 lamp purchase that's also part of the build
 * can be flagged to count toward this month's spending too.
 *
 * Returns a Drizzle SQL expression suitable for passing to `and(...)`.
 */

import { sql } from 'drizzle-orm';
import { transactions, projects } from '../schema/finance';

export function excludeHiddenProjectTxns() {
  return sql`(
    ${transactions.projectId} IS NULL
    OR ${transactions.includeInMonthlyOverride} = true
    OR NOT EXISTS (
      SELECT 1 FROM ${projects} p
      WHERE p.id = ${transactions.projectId}
        AND p.exclude_from_monthly_totals = true
    )
  )`;
}
