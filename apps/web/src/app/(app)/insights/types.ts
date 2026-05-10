/**
 * Shared types for the /insights surface.
 * Phase A: foundation for the 13 P0 insight cards + drill-stack model.
 */

/** Top-level time-window selector on /insights. */
export type InsightWindowKind = 'mtd' | '30d' | '90d' | 'custom';

export interface InsightWindow {
  kind: InsightWindowKind;
  /** Resolved start date inclusive (YYYY-MM-DD) for date-based windows. */
  dateFrom?: string;
  /** Resolved end date inclusive (YYYY-MM-DD) for date-based windows. */
  dateTo?: string;
  /** For MTD only — the active billing month YYYY-MM. */
  billingMonth?: string;
}

/** Insight ID — stable identifier used for layout / hide / publish state. */
export type InsightId =
  | 'unusual-transaction'
  | 'recurring-drift'
  | 'phantom-subscription'
  | 'recurring-lapsed'
  | 'category-trend'
  | 'category-mom-spike'
  | 'fixed-vs-variable'
  | 'untagged-transactions'
  | 'low-confidence-categorizations'
  | 'suspicious-installments'
  | 'mis-tagged-transfers'
  | 'bad-recurring-patterns';

export type InsightSection = 'risk' | 'integrity' | 'trends';

/**
 * A single level in a card's drill stack. The label is what the breadcrumb
 * crumb shows; the filterValue is the underlying ID used to scope the next
 * aggregation (e.g. categoryId for level 1, subCategoryId for level 2,
 * merchantNormalized for level 3).
 */
export interface DrillCrumb {
  label: string;
  filterValue: string;
}

/** Maximum drill depth declared per insight (informational; cards enforce). */
export const DRILL_MAX_DEPTH: Record<InsightId, number> = {
  'unusual-transaction':            0,
  'recurring-drift':                0,
  'phantom-subscription':           0,
  'recurring-lapsed':               0,
  'category-trend':                 3, // category → sub-category → merchant
  'category-mom-spike':             2, // category → sub-category
  'fixed-vs-variable':              1, // ratio → fixed-vs-variable component drill
  'untagged-transactions':          1, // count → list grouped by merchant
  'low-confidence-categorizations': 1,
  'suspicious-installments':        0,
  'mis-tagged-transfers':           0,
  'bad-recurring-patterns':         0,
};

/** Severity for risk insights — drives visual ordering in the risk section. */
export type Severity = 'low' | 'medium' | 'high';
