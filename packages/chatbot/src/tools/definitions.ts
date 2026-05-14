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
  {
    name: 'get_widget_spec',
    description:
      'Authoritative metadata about every visible element on the app\'s pages — the contract the code enforces. Use this whenever the user asks how a widget/card/table/summary on any page works, what data source it pulls from (bank rows vs CC details vs other tables), what filters it applies, what time scope, what math rule, what gets excluded, or why a specific number is displayed. Quoting from the spec lets you answer with certainty instead of guessing from the rendered numbers. ' +
      '\n\nUsage modes:\n' +
      '- No arguments → returns the full list of widgets across every page (id + page + Hebrew/English title). Useful to discover what exists.\n' +
      '- `page_id` only (e.g. "/", "/insights", "/transactions", "/recurring", "/installments", "/savings", "/projects") → returns the list scoped to one page. Use this when the user asks about "the dashboard" or "the transactions page" generally.\n' +
      '- `widget_id` → returns the full structured spec for one widget: pageId, dataSource, dataSourceNotes, timeScope, filters[], mathRule, exclusions[], caveats, relatedWidgets[], queryFunction. THIS is what you quote to answer "does it include CC details" / "what time scope" / "how is the number computed" questions.\n' +
      '\nKnown page ids: /, /insights, /transactions, /recurring, /installments, /savings, /projects.\n' +
      'Common widget ids (non-exhaustive): home.kpi.spent-so-far, home.kpi.income, home.kpi.balance, home.kpi.cumulative-balance, home.charge-bar.already-charged, transactions.banner.current-cycle, transactions.controls.cc-view-toggle, recurring.kpi.monthly-expense, installments.kpi.completed-count, savings.monthly-rate.deposited, projects.detail.budget-progress-bar, hero-kpi, income-vs-expenses, recurring-drift, cc-settlement-mismatch. (Call without widget_id to see the full list.)',
    input_schema: {
      type: 'object',
      properties: {
        widget_id: {
          type: 'string',
          description: 'Optional stable widget id. Pass to fetch one widget\'s full spec.',
        },
        page_id: {
          type: 'string',
          description: 'Optional page filter for the list mode. Ignored when widget_id is set.',
        },
      },
    },
  },
];

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];
