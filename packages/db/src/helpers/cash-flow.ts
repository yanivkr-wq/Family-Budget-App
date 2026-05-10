/**
 * Settlement-basis accounting helpers.
 *
 * These are THE seam through which every spending / income / net query in
 * the app passes. Centralized here so the rules below are stated once and
 * the entire app (web + chatbot tools + scripts) stays in lockstep.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *
 * Source of truth for monthly totals = the row that reflects what the BANK
 * actually moved. For non-forex credit-card spending, that's the monthly
 * settlement line on the bank account ("דיינרס קלוב-י -₪41,349.42 on 10/04").
 * The detail rows on the CC account are kept (categorized, displayed, used
 * for recurring/installment/forecasting/category-breakdown logic) but
 * EXCLUDED from totals, because the settlement line already covers them.
 *
 * Foreign-currency CC purchases are an exception — the bank charges them
 * immediately and separately (not bundled into the monthly settlement). So
 * forex CC details ARE counted, and they have no excluded_from_totals flag.
 *
 * Two transactions that both result in "don't count toward totals" but are
 * semantically distinct:
 *   • is_transfer = TRUE         → cross-account transfer (same money,
 *                                  different account). Excluded from totals.
 *   • excluded_from_totals = TRUE → CC detail row covered by a settlement
 *                                   line. Excluded from totals.
 *
 * ── How to use ──────────────────────────────────────────────────────────────
 *
 *   import { cashFlowBaseConditions, expensesAmountExpr, incomeAmountExpr }
 *     from '@fba/db';
 *
 *   db.select({
 *     month: schema.transactions.billingMonth,
 *     expenses: expensesAmountExpr(),
 *     income: incomeAmountExpr(),
 *   })
 *   .from(schema.transactions)
 *   .leftJoin(schema.categories, ...)
 *   .where(and(
 *     eq(schema.transactions.householdId, householdId),
 *     ...cashFlowBaseConditions(),
 *     // your window filter, etc.
 *   ));
 *
 * Sign-aware math is built into the SQL expressions so the answer is
 * immune to the "positive amount in non-income category" bug — only
 * negative amounts count as expenses; only positive amounts in income
 * categories count as income.
 */

import { isNull, eq, sql } from 'drizzle-orm';
import { transactions, categories, accounts } from '../schema/finance';

/**
 * The set of base conditions every spending-math query must apply.
 * Returns an array of conditions you spread into `and(...)`.
 *
 * Excludes:
 *   • Soft-deleted rows
 *   • Future projected installments (synthetic, not real money yet)
 *   • Cross-account transfers (same money, different account)
 *   • CC detail rows covered by a settlement line (settlement-basis flag)
 *
 * Does NOT exclude project transactions — that's a per-surface choice.
 * /insights uses a STRICT project filter (excludeAllProjectTxns()) on top
 * of these. The dashboard uses excludeHiddenProjectTxns() (per-project flag).
 */
export function cashFlowBaseConditions() {
  return [
    isNull(transactions.deletedAt),
    eq(transactions.isProjected, false),
    eq(transactions.isTransfer, false),
    eq(transactions.excludedFromTotals, false),
  ];
}

/**
 * SQL expression for "expenses" — sum of |negative amounts|.
 *
 * Wraps in coalesce so empty groups return 0 (not NULL). Returns a numeric
 * expression you can use as a select column or in a HAVING clause.
 *
 * Why amount < 0 only: a CC refund on an expense category is a POSITIVE
 * amount; we don't want to count it as an expense. The Refunds card surfaces
 * those separately.
 */
export function expensesAmountExpr() {
  return sql<string>`coalesce(sum(case when ${transactions.amountIls} < 0 then abs(${transactions.amountIls}) else 0 end), 0)`;
}

/**
 * SQL expression for "income" — sum of POSITIVE amounts in income categories.
 *
 * Why both signs and category: positive amounts in NON-income categories
 * are typically refunds, transfers, or unmarked moves. Including them in
 * income would over-state. The Refunds card and Mis-tagged Transfers card
 * surface those separately so the user can resolve them.
 *
 * REQUIRES the query to LEFT JOIN schema.categories on
 * schema.transactions.categoryId = schema.categories.id.
 */
export function incomeAmountExpr() {
  return sql<string>`coalesce(sum(case when ${transactions.amountIls} > 0 and ${categories.isIncome} = true then ${transactions.amountIls} else 0 end), 0)`;
}

/**
 * SQL expression for "credits" — POSITIVE amounts in NON-income categories
 * (the bucket the Refunds card draws from). Lets a single query report
 * expenses + income + credits in one round-trip when needed.
 */
export function creditsAmountExpr() {
  return sql<string>`coalesce(sum(case when ${transactions.amountIls} > 0 and (${categories.isIncome} IS NULL or ${categories.isIncome} = false) then ${transactions.amountIls} else 0 end), 0)`;
}

/**
 * Convenience: all three amounts in one expression set, for callers that
 * want to pass them through ` .select({...})`.
 */
export function cashFlowAmountColumns() {
  return {
    expenses: expensesAmountExpr(),
    income: incomeAmountExpr(),
    credits: creditsAmountExpr(),
  };
}

/**
 * Hardcoded fallback patterns the importer uses to detect CC settlement
 * lines on bank-account files. Mirrored from import/actions.ts
 * CC_SETTLEMENT_PATTERNS so we can spot the same rows at query time without
 * a dedicated boolean flag on the row.
 *
 * Phase 6 uses this to power the /transactions "פירוט אשראי" toggle: when
 * the user wants to see CC details (instead of settlement-only mode), we
 * also need to HIDE the bank-side settlement lines so they don't overlap
 * visually with the CC details. This SQL fragment matches those lines.
 *
 * NOTE: also unioned with each CC account's user-configured
 * settlement_merchant_pattern. The fallback list catches CCs that haven't
 * been configured yet.
 */
const CC_SETTLEMENT_FALLBACK_PATTERNS = [
  '%כ.א.ל%', '%כאל%',
  '%דיינרס%', '%דינרס%',
  '%ויזה%חיוב%', '%ויזה%ק.ש.ר%',
  '%מסטרקרד%', '%מאסטרקרד%', '%מאסטר%כרט%',
  '%ישראכרט%',
  '%מקס%איט%', '%ממקס%',
  '%לאומי%קארד%',
  '%amex%', '%AMEX%',
];

/**
 * SQL expression that returns TRUE for rows that look like CC settlement
 * lines on a bank account. Used by /transactions to hide them when the
 * user is in "details mode" (showing the CC details instead).
 *
 * This is a heuristic — it relies on bank account type AND merchant-name
 * matching. False positives are rare (the patterns are very specific to
 * CC issuer names). For perfect accuracy we'd add an explicit boolean
 * flag on the row at import time; doing it at query time is good enough
 * for the toggle UX.
 *
 * REQUIRES the query to JOIN schema.accounts on
 * schema.transactions.accountId = schema.accounts.id.
 */
export function isSettlementLineExpr() {
  // Build a single SQL fragment via raw sql tag so the return type is the
  // concrete SQL<unknown> drizzle expects (and() / or() can return undefined,
  // which trips up callers that wrap us in not(...)).
  const ilikeClauses = CC_SETTLEMENT_FALLBACK_PATTERNS
    .map((p) => sql`${transactions.merchantNormalized} ILIKE ${p}`);
  const orJoined = sql.join(ilikeClauses, sql.raw(' OR '));
  return sql`(${accounts.type} = 'bank' AND (${orJoined}))`;
}
