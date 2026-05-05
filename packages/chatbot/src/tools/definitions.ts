import type Anthropic from '@anthropic-ai/sdk';

// Tool definitions sent to Claude. Schemas mirror the Zod definitions in schemas.ts —
// keep these in sync.
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'query_transactions',
    description:
      'List transactions matching filters. Use for "show me my X" or "list transactions where Y" questions. Returns up to 200 rows. Soft-deleted and projected (future installment) rows are excluded by default.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD inclusive' },
        date_to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
        billing_month: { type: 'string', description: 'YYYY-MM (uses billing-month, not transaction date)' },
        category_ids: { type: 'array', items: { type: 'string' } },
        sub_category_ids: { type: 'array', items: { type: 'string' } },
        account_ids: { type: 'array', items: { type: 'string' } },
        merchant_pattern: {
          type: 'string',
          description: 'Substring match against normalized merchant name (case-insensitive)',
        },
        min_amount: { type: 'number', description: 'Inclusive minimum (negative = expense)' },
        max_amount: { type: 'number', description: 'Inclusive maximum' },
        only_recurring: { type: 'boolean' },
        only_installments: { type: 'boolean' },
        limit: { type: 'number', description: 'Default 50, max 200' },
      },
    },
  },
  {
    name: 'get_category_summary',
    description:
      'Totals + budget vs actual for a given month, grouped by category or sub-category. Use this for "how much did we spend on X" or "show me budget status" questions.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM' },
        level: {
          type: 'string',
          enum: ['category', 'sub'],
          description: 'Group by top-level category or by sub-category',
        },
      },
      required: ['month'],
    },
  },
  {
    name: 'compare_months',
    description:
      'Compute month-over-month deltas by category. Use for "how does this month compare to last month" type questions.',
    input_schema: {
      type: 'object',
      properties: {
        month_a: { type: 'string', description: 'First month YYYY-MM (later)' },
        month_b: { type: 'string', description: 'Second month YYYY-MM (earlier)' },
      },
      required: ['month_a', 'month_b'],
    },
  },
  {
    name: 'get_recurring_patterns',
    description:
      'List auto-detected recurring (fixed) charges with their expected amount and tolerance. Useful for fixed-vs-variable analysis.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'ended'] },
      },
    },
  },
  {
    name: 'get_installment_plans',
    description:
      'List installment plans (e.g. iPhone 4/10) with progress and remaining payments. Use for "when does the iPhone end" questions.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'complete', 'cancelled'] },
      },
    },
  },
  {
    name: 'get_anomalies',
    description:
      'Return flagged anomalies (overspend, recurring jump, income drop, unusual merchant) within a date range.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_predicted_balance',
    description:
      'Current month-end balance prediction with breakdown of recurring, installments, and projected variable spend.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_subscription_candidates',
    description:
      'Heuristic: list small recurring monthly charges that look like subscriptions the user might want to review.',
    input_schema: {
      type: 'object',
      properties: {
        max_monthly_amount: { type: 'number', description: 'Default 200 ILS' },
      },
    },
  },
  {
    name: 'search_merchants',
    description:
      'Fuzzy search by merchant name. Returns distinct merchants with totals and counts so the agent can locate which exact merchant the user means.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, max 50' },
      },
      required: ['query'],
    },
  },
];

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];
