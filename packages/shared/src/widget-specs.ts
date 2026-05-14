/**
 * STRUCTURED WIDGET METADATA for every page in the app — single source of truth
 * for the chatbot's understanding of how each visible element is computed.
 *
 * ─── Why this exists ──────────────────────────────────────────────────────
 * The chatbot can see what's rendered on screen but cannot see the SQL/JS
 * that produced those numbers. Without this file, asking "does the income-
 * vs-expenses widget include CC details?" forces the bot to guess from the
 * rendered numbers — and it gets it wrong. This file is the contract the
 * code enforces, written in a form the chatbot can quote authoritatively.
 *
 * ─── Two consumers ────────────────────────────────────────────────────────
 *   1. The chatbot tool `get_widget_spec` reads this so the AI can answer
 *      questions like "does widget X include CC details?", "what time scope
 *      does it use?", "why is this specific number what it is?".
 *   2. Per-card info modals in the UI can render the Hebrew title + semantics
 *      directly from here, alongside the longer user-facing prose in the
 *      `INSIGHT_EXPLANATIONS` map.
 *
 * ─── How to extend (when adding a new widget or page) ─────────────────────
 *   1. Find the file that produces the widget's data (queries, page.tsx,
 *      a server action). Look at its SQL filters and math.
 *   2. Add a new entry to `WIDGET_SPECS` below with a stable `id` and the
 *      correct `pageId` from `PAGE_IDS`. Fill in every field — the chatbot
 *      uses ALL of them.
 *   3. If you need a new `pageId`, add it to the `PageId` union.
 *
 * ⚠ KEEP IN SYNC. If you change a filter, sign rule, or time scope in the
 *   underlying query, update the matching spec entry. The chatbot quotes
 *   from this file — drift will cause confidently-wrong answers.
 *
 * The `queryFunction` field names the function (and the file it lives in)
 * that produces the widget's data. Use it to navigate from spec to code.
 */

export type PageId =
  | '/'
  | '/insights'
  | '/transactions'
  | '/recurring'
  | '/installments'
  | '/savings'
  | '/projects';

export const PAGE_IDS: readonly PageId[] = [
  '/',
  '/insights',
  '/transactions',
  '/recurring',
  '/installments',
  '/savings',
  '/projects',
];

/** Human-readable label per page — used in chatbot output. */
export const PAGE_TITLES_HE: Record<PageId, string> = {
  '/': 'לוח בקרה (דף הבית)',
  '/insights': 'תובנות',
  '/transactions': 'תנועות',
  '/recurring': 'הוצאות קבועות',
  '/installments': 'תשלומים',
  '/savings': 'חיסכון ויעדים',
  '/projects': 'פרויקטים',
};

export type DataSource =
  /** Bank-account rows only (settlement lines + bank-direct charges). */
  | 'bank'
  /** Credit-card detail rows only (per-purchase data). */
  | 'cc'
  /** Both bank rows AND CC details (used by widgets that surface per-charge
   *  context regardless of which account paid). */
  | 'both'
  /** Reads a non-transaction table (recurring_pattern, installment_plan,
   *  project, saving_goal, account, category, etc.). */
  | 'other-table'
  /** UI/navigation element with no data dependency (filter pills, tabs,
   *  sort headers, view stripes). Listed for completeness so the bot can
   *  reason about page structure. */
  | 'ui-only';

export type TimeScope =
  /** Honors the page's time-window selector (MTD / 30d / 90d / custom). */
  | 'window'
  /** Pinned to the page's active billing month — does not follow the
   *  time-window selector. */
  | 'active-billing-month'
  /** Last N billing months ending at the active billing month. */
  | 'trailing-months'
  /** "Today" — date-of-month logic. */
  | 'today-relative'
  /** No time scope — reads all rows the criterion matches. */
  | 'all-time'
  /** Element doesn't have a time scope (UI / nav). */
  | 'na';

export interface WidgetSpec {
  /** Stable widget id, slug-style and namespaced by page (e.g.
   *  `home.kpi.balance`, `installments.kpi.completed`, `recurring-drift`).
   *  Used as the chatbot's lookup key. */
  id: string;
  /** Which page surfaces this widget. */
  pageId: PageId;
  /** Short Hebrew title — what the user sees in the card header. */
  titleHe: string;
  /** Short English label — for chatbot/log output. */
  titleEn: string;
  /** One-sentence semantics: what the widget answers, in plain language. */
  semantics: string;
  /** Which rows feed the math. The single most important field for
   *  answering "does this widget include CC detail transactions?". */
  dataSource: DataSource;
  /** Free-text clarification of dataSource (caveats, joins, sign filters). */
  dataSourceNotes: string;
  /** Time scope the widget operates over. */
  timeScope: TimeScope;
  /** Trailing window size (months), when relevant. */
  trailingMonths?: number;
  /** SQL filters applied beyond the standard "deleted, projected, transfer"
   *  exclusions. One bullet per filter. */
  filters: string[];
  /** Sign / aggregation rule — important for queries with sign-aware math. */
  mathRule: string;
  /** What's excluded from the result (projects, dynamic-amount patterns,
   *  null-categorized, etc.). */
  exclusions: string[];
  /** Function or file path (e.g. `getDashboardKpis` or
   *  `apps/web/src/app/(app)/page.tsx`) that produces this widget's data. */
  queryFunction: string;
  /** Other widget ids the chatbot should mention when answering about this. */
  relatedWidgets?: string[];
  /** Known issues, design tradeoffs, or recent fixes worth surfacing. */
  caveats?: string;
}

/** @deprecated Use `WidgetSpec`. Kept for legacy chatbot tool. */
export type InsightWidgetSpec = WidgetSpec;

/**
 * The standard "spending math" exclusions every spending-side query applies.
 * Listed here once so individual specs don't repeat the boilerplate.
 */
export const STANDARD_SPENDING_EXCLUSIONS = [
  'soft-deleted rows (deleted_at IS NOT NULL)',
  'forecasted / projected rows (is_projected=true)',
  'transfers between own accounts (is_transfer=true)',
  'project-tagged rows (project_id IS NOT NULL) — projects are surfaced separately on /projects',
];

export const WIDGET_SPECS: WidgetSpec[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // /insights — 23 widgets
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Hero KPI strip ─────────────────────────────────────────────────────
  {
    id: 'hero-kpi',
    pageId: '/insights',
    titleHe: 'סיכום פיננסי (הכנסות / הוצאות / מאזן / שיעור חיסכון)',
    titleEn: 'Hero KPI strip',
    semantics: 'Top-of-page summary tiles: total income, total expenses, net (income − expenses), and savings rate for the active time window. Each tile shows a % delta vs the previous comparable window.',
    dataSource: 'bank',
    dataSourceNotes: 'BANK ROWS ONLY (accounts.type = bank). Enforced structurally in SQL — CC detail rows are explicitly excluded so forex purchases that happen to have excluded_from_totals=false don\'t double-count on top of the bank-side settlement line that already bundles them.',
    timeScope: 'window',
    filters: [
      'accounts.type = bank',
      'excluded_from_totals = false (belt-and-suspenders alongside the bank filter)',
      'honors page time-window selector (MTD / 30d / 90d / custom)',
    ],
    mathRule: 'Sign-aware. expenses = SUM(|amount|) WHERE amount<0. income = SUM(amount) WHERE amount>0 AND category.is_income=true. Positive amounts in non-income categories (refunds, unmarked transfers) are IGNORED here — they are surfaced separately by the refunds card and the mis-tagged-transfers card.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getDashboardKpis',
    relatedWidgets: ['income-vs-expenses', 'narrative-summary'],
  },

  // ─── Narrative summary ──────────────────────────────────────────────────
  {
    id: 'narrative-summary',
    pageId: '/insights',
    titleHe: 'סיכום החודש שלך (סיפור)',
    titleEn: 'Narrative summary',
    semantics: 'Deterministic 2-4 bullet narrative composed from the same query results the other cards show. No LLM generation — facts come straight from finding arrays. Reports net cash flow, top MoM spike, top recurring drift, phantom subscriptions, top outlier, lapsed recurrings, untagged-count nudge.',
    dataSource: 'other-table',
    dataSourceNotes: 'No SQL of its own — this is a pure composition layer over the outputs of other queries. Net-cash-flow bullet borrows from getIncomeVsExpenses (bank-only). Other bullets borrow from finding arrays of other cards (which carry their own data sources — see those specs). When the user asks "where does this number come from", look up the underlying card by name and read ITS spec.',
    timeScope: 'active-billing-month',
    filters: ['matches the active-billing-month bucket from getIncomeVsExpenses; falls back to the most recent bucket with data and labels the bullet/subtitle with that explicit month'],
    mathRule: 'No aggregation of its own — just picks bullets from query results sorted by rough severity, caps at 4 lines.',
    exclusions: ['NA — composed from other cards\' outputs'],
    queryFunction: 'apps/web/src/components/insights/narrative-summary.tsx',
    relatedWidgets: ['hero-kpi', 'income-vs-expenses', 'category-mom-spike', 'recurring-drift', 'phantom-subscription', 'unusual-transaction', 'recurring-lapsed'],
    caveats: 'Subtitle labels which month the narrative is about. If the active cycle has no data yet (just opened), bullets reference the most recent month with data explicitly (e.g. "בחודש 2026-05 ..." instead of "החודש ...").',
  },

  // ─── Income vs Expenses (last 6 months) ─────────────────────────────────
  {
    id: 'income-vs-expenses',
    pageId: '/insights',
    titleHe: 'הכנסות מול הוצאות',
    titleEn: 'Income vs Expenses (last 6 months)',
    semantics: '6-month grouped bar chart: income and expenses per billing month, grouped side-by-side. Shows the trend of net cash flow at a glance.',
    dataSource: 'bank',
    dataSourceNotes: 'BANK ROWS ONLY (accounts.type = bank), same rule as the Hero KPI strip. Per-bucket month is grouped by transactions.billing_month. CC detail rows are EXCLUDED — settlement lines already bundle them.',
    timeScope: 'trailing-months',
    trailingMonths: 6,
    filters: [
      'accounts.type = bank',
      'excluded_from_totals = false',
      'billing_month >= activeMonth − 5',
      'billing_month <= activeMonth',
    ],
    mathRule: 'Same sign-aware rule as Hero KPI. expenses positive, income positive, net = income − expenses (signed).',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getIncomeVsExpenses',
    relatedWidgets: ['hero-kpi', 'net-cash-flow', 'narrative-summary'],
  },

  // ─── Net cash flow ──────────────────────────────────────────────────────
  {
    id: 'net-cash-flow',
    pageId: '/insights',
    titleHe: 'תזרים נטו חודשי',
    titleEn: 'Net cash flow per month',
    semantics: 'Last 6 billing months, signed net (income − expenses) per month. Wrapper over getIncomeVsExpenses — same data, simpler shape.',
    dataSource: 'bank',
    dataSourceNotes: 'Inherits getIncomeVsExpenses — bank rows only.',
    timeScope: 'trailing-months',
    trailingMonths: 6,
    filters: ['inherited from getIncomeVsExpenses'],
    mathRule: 'netIls = income − expenses, signed.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getNetCashFlow',
    relatedWidgets: ['income-vs-expenses', 'hero-kpi'],
  },

  // ─── Unusual transactions (z-score outliers) ────────────────────────────
  {
    id: 'unusual-transaction',
    pageId: '/insights',
    titleHe: 'תנועות חריגות',
    titleEn: 'Unusual transactions (z-score outliers)',
    semantics: 'Transactions whose amount is unusually large/small for that merchant compared to its trailing 6-month history. Surfaces "did I just pay 3x the usual at this merchant?".',
    dataSource: 'both',
    dataSourceNotes: 'Reads transaction rows directly (any account type). The baseline is per-merchant aggregated over trailing 6 months. Uses standard spending filters but does NOT exclude CC details — the per-merchant view benefits from per-charge data.',
    timeScope: 'window',
    filters: [
      'honors page time-window selector for candidate rows',
      'baseline: trailing 6 months from anchor month',
      'requires merchant history of ≥3 transactions with stddev > 0',
    ],
    mathRule: 'For each merchant: z = (|amount| − mean) / stddev. Flag when |z| ≥ 2.5.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getUnusualTransactions',
  },

  // ─── Recurring drift ────────────────────────────────────────────────────
  {
    id: 'recurring-drift',
    pageId: '/insights',
    titleHe: 'הוצאות קבועות שעלו / ירדו במחיר',
    titleEn: 'Recurring drift',
    semantics: 'Active recurring patterns where the latest charge\'s magnitude deviates from the pattern\'s expected amount by more than its tolerance + 10pp buffer. Surfaces silent price increases on subscriptions / bills.',
    dataSource: 'cc',
    dataSourceNotes: 'Reads the recurring_pattern table for the list. For each pattern, reads the latest CC detail row matching the merchant (excluded_from_totals=true IS intentionally allowed here — CC details have the per-charge amount that matches expected). Filters latest row to SAME SIGN as expected (avoids comparing a refund against a charge pattern).',
    timeScope: 'today-relative',
    filters: [
      'recurring_pattern.status = active',
      'recurring_pattern.amount_mode != dynamic',
      'latest charge: same sign as expected_amount_ils',
      'latest charge: not transfer, not projected, not project-tagged',
    ],
    mathRule: 'Drift in MAGNITUDE: expected = |pattern.expected_amount_ils|, actual = |latest.amount_ils|. diffPct = (actual − expected) / expected × 100. Flag when |diffPct| ≥ pattern.tolerance_pct + 10pp.',
    exclusions: [
      'dynamic-amount patterns (no expected to compare against)',
      'patterns without any recent transaction at the matching sign',
    ],
    queryFunction: 'getRecurringDrift',
    caveats: 'Earlier version had a sign-mismatch bug that flagged 100% of patterns at ~200% drift. Fixed by abs-on-both-sides + same-sign-as-expected filter.',
    relatedWidgets: ['phantom-subscription', 'recurring-lapsed'],
  },

  // ─── Phantom subscription ───────────────────────────────────────────────
  {
    id: 'phantom-subscription',
    pageId: '/insights',
    titleHe: 'מנויי פנטום',
    titleEn: 'Phantom subscriptions',
    semantics: 'Monthly recurring patterns at merchants where no NON-recurring purchase has been seen in 90+ days. Suggests "you\'re still paying, but not using".',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern (active, monthly) and joins to last non-recurring transaction at the same merchant.',
    timeScope: 'today-relative',
    filters: ['status=active', 'frequency=monthly', 'last non-recurring activity ≥90 days ago OR none'],
    mathRule: 'Last activity = MAX(transaction_date) WHERE merchant matches AND is_recurring=false AND deleted_at IS NULL. Days-since calculated against today (Israel time).',
    exclusions: ['patterns at merchants where the user only ever has the subscription itself (e.g. insurance) — may produce false positives, requires user judgment'],
    queryFunction: 'getPhantomSubscriptions',
    relatedWidgets: ['recurring-drift', 'expiring-subscriptions'],
  },

  // ─── Expiring subscriptions ─────────────────────────────────────────────
  {
    id: 'expiring-subscriptions',
    pageId: '/insights',
    titleHe: 'מנויים שמסתיימים בקרוב',
    titleEn: 'Expiring subscriptions',
    semantics: 'Recurring patterns with subscription_end_date in the next 30 days (or up to 7 days past). Surfaces cancel-now-or-renew decisions.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern with subscription_end_date set. Calendar-time comparison against "today".',
    timeScope: 'today-relative',
    filters: ['subscription_end_date IS NOT NULL', 'end_date within [today − 7d, today + 30d]'],
    mathRule: 'Days-until = (end_date − today). Also computes effective cancel deadline = end_date − cancel_notice_days.',
    exclusions: ['open-ended subscriptions (no end_date set)'],
    queryFunction: 'getExpiringSubscriptions',
    relatedWidgets: ['phantom-subscription', 'recurring-drift'],
  },

  // ─── Recurring lapsed ───────────────────────────────────────────────────
  {
    id: 'recurring-lapsed',
    pageId: '/insights',
    titleHe: 'חיובים קבועים שלא הופיעו',
    titleEn: 'Lapsed recurring charges',
    semantics: 'Active monthly recurring patterns that should have charged this billing month but haven\'t. Surfaces "subscription cancelled without you knowing" or "card expired".',
    dataSource: 'cc',
    dataSourceNotes: 'For each active monthly pattern, checks for a transaction in the active billing month matching the merchant.',
    timeScope: 'active-billing-month',
    filters: ['status=active', 'frequency=monthly', 'no transaction in active billing month at matching merchant', 'today > median day-of-month from last 6 charges'],
    mathRule: 'Median expected-charge day = median(day(transaction_date)) over last 6 charges. Lapsed if today.day > that median AND no charge yet this cycle.',
    exclusions: ['non-monthly patterns', 'patterns with < 3 historical charges (can\'t compute median reliably)'],
    queryFunction: 'getLapsedRecurring',
    caveats: 'Will show nothing in the first week of a cycle — by design.',
  },

  // ─── Category trend (drill-down) ────────────────────────────────────────
  {
    id: 'category-trend',
    pageId: '/insights',
    titleHe: 'מגמת הוצאות לפי קטגוריה',
    titleEn: 'Category trend (drilldown)',
    semantics: 'Last 4 billing months of spending per top-level category, with drill-down: top category → sub-category → merchant. The "story" of how money moved over time.',
    dataSource: 'bank',
    dataSourceNotes: 'Uses standard spending filters (excluded_from_totals=false) which de-facto behaves as bank-only for properly-imported data. The per-merchant drill level naturally surfaces CC details via merchant_normalized.',
    timeScope: 'trailing-months',
    trailingMonths: 4,
    filters: [
      'excluded_from_totals = false',
      'amount_ils < 0 (expenses only — sign-aware)',
      'billing_month >= anchor − 3 AND <= anchor',
    ],
    mathRule: 'sum(|amount|) WHERE amount<0, grouped by category × month. Drilldown depths: 0=categories, 1=sub-cats, 2=merchants. Fall-through: drill into a category with no sub-tagged rows → silently groups by merchant.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getCategoryTrend',
    relatedWidgets: ['category-mom-spike', 'category-by-charge-date'],
  },

  // ─── Category MoM spike ─────────────────────────────────────────────────
  {
    id: 'category-mom-spike',
    pageId: '/insights',
    titleHe: 'קפיצות חודשיות בקטגוריה',
    titleEn: 'Category month-over-month spike',
    semantics: 'Top-level categories where this month\'s spend is materially higher than the trailing 3-month median. Surfaces one-off events or trend starts.',
    dataSource: 'bank',
    dataSourceNotes: 'Same standard spending filters as the trend card. Effectively bank-only via excluded_from_totals=false.',
    timeScope: 'trailing-months',
    trailingMonths: 4,
    filters: [
      'excluded_from_totals = false',
      'sign-aware: only amount<0 counts as spending',
      'spike threshold: ≥30% over trailing-3-month median AND absolute Δ ≥ ₪200',
    ],
    mathRule: 'pctOver = (thisMonth − trailingMedian) / trailingMedian × 100. Flag when pctOver ≥ 30 AND (thisMonth − trailingMedian) ≥ 200.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getCategoryMomSpike',
    relatedWidgets: ['category-trend'],
  },

  // ─── Fixed vs variable ──────────────────────────────────────────────────
  {
    id: 'fixed-vs-variable',
    pageId: '/insights',
    titleHe: 'הוצאות קבועות מול משתנות',
    titleEn: 'Fixed vs variable spend',
    semantics: '6-month split between FIXED (is_recurring=true OR is_installment=true) and VARIABLE (everything else) spending. The hero number is the fixed % of last month\'s total spend.',
    dataSource: 'bank',
    dataSourceNotes: 'Standard spending filters (excluded_from_totals=false). Bank-only de-facto.',
    timeScope: 'trailing-months',
    trailingMonths: 6,
    filters: ['excluded_from_totals = false', 'sign-aware: only amount<0 counts'],
    mathRule: 'For each month: fixed = sum(|amt|) WHERE is_recurring=true OR is_installment=true. variable = sum(|amt|) of the rest. fixedPct = fixed / (fixed + variable) × 100.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getFixedVsVariable',
    relatedWidgets: ['recurring-drift'],
  },

  // ─── Category by charge date ────────────────────────────────────────────
  {
    id: 'category-by-charge-date',
    pageId: '/insights',
    titleHe: 'הוצאות לפי קטגוריה — מועד חיוב',
    titleEn: 'Category by charge date (cash-out view)',
    semantics: 'Per-category breakdown of what hit the bank account THIS CYCLE — billing-month basis. Answers "where did the money actually go this billing cycle?".',
    dataSource: 'bank',
    dataSourceNotes: 'Uses billing_month equality + excluded_from_totals=false (bank-only de-facto). Falls back to the most recent month with data and labels the resolved month explicitly.',
    timeScope: 'active-billing-month',
    filters: ['billing_month = activeMonth (with fallback)', 'excluded_from_totals = false'],
    mathRule: 'sum(|amt|) WHERE amount<0, grouped by category_id.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getCategoryByChargeDate',
    relatedWidgets: ['category-by-txn-date', 'category-trend'],
  },

  // ─── Category by transaction date ───────────────────────────────────────
  {
    id: 'category-by-txn-date',
    pageId: '/insights',
    titleHe: 'הוצאות לפי קטגוריה — מועד עסקה',
    titleEn: 'Category by transaction date (buying view)',
    semantics: 'Per-category breakdown of what was BOUGHT this calendar month — transaction-date basis. Differs from the charge-date view when CC purchases span the cutoff: e.g. buying May 5 with a card whose cutoff is the 10th → charge view sees it in May, txn view sees it in May too; but a May 11 purchase shows up in June charge view, May txn view.',
    dataSource: 'cc',
    dataSourceNotes: 'INVERSE of category-by-charge-date: INCLUDES CC detail rows (they have the real transaction_date), EXCLUDES bank-side settlement lines (would double-count). Sign-aware. Falls back to most recent month with data.',
    timeScope: 'active-billing-month',
    filters: [
      'transaction_date in [calMonth-01, calMonth-lastDay]',
      'NOT a settlement line (isSettlementLineExpr — heuristic on bank-account merchant names)',
    ],
    mathRule: 'sum(|amt|) WHERE amount<0, grouped by category_id. Same shape as charge-date view but opposite filter intent — buying behavior, not cash-out.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getCategoryByTxnDate',
    relatedWidgets: ['category-by-charge-date'],
    caveats: 'Charge-view and txn-view of the same month will show DIFFERENT numbers by design.',
  },

  // ─── Refunds and credits ────────────────────────────────────────────────
  {
    id: 'refunds-and-credits',
    pageId: '/insights',
    titleHe: 'החזרים וזיכויים',
    titleEn: 'Refunds & credits (found money)',
    semantics: 'Positive-amount transactions that landed in an EXPENSE category (or no category). Surfaces refunds, cashback, voided charges — money coming back that you might miss when scanning the expense list.',
    dataSource: 'both',
    dataSourceNotes: 'Reads transactions with amount > 0 across all accounts. Filters out income categories in JS so null-categorized positives stay surfaced (they\'re probably uncategorized refunds).',
    timeScope: 'window',
    filters: ['amount_ils >= 0.01', 'category.is_income = false OR category IS NULL', 'honors time window'],
    mathRule: 'Sort by amount DESC, top 20.',
    exclusions: ['transfers (is_transfer=true)', 'income-tagged positives (those are income, not refunds)'],
    queryFunction: 'getRefundsAndCredits',
  },

  // ─── Foreign currency exposure ──────────────────────────────────────────
  {
    id: 'foreign-currency',
    pageId: '/insights',
    titleHe: 'מטבעות זרים',
    titleEn: 'Foreign currency exposure',
    semantics: 'Aggregates per-currency: count, original-currency sum, ILS sum, and top 3 merchants per currency. Pure visibility into "how much do I spend in USD/EUR?".',
    dataSource: 'cc',
    dataSourceNotes: 'Reads rows where original_currency is not null AND != ILS. These are typically CC forex charges (claude.ai subscription, AWS, etc.). Bank-direct rows are never forex.',
    timeScope: 'window',
    filters: ['original_currency IS NOT NULL AND != ILS', 'honors time window'],
    mathRule: 'sum(|original|) per currency, sum(|ils|) per currency.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getForeignCurrencyExposure',
  },

  // ─── Project burn rate ──────────────────────────────────────────────────
  {
    id: 'project-burn-rate',
    pageId: '/insights',
    titleHe: 'קצב שריפת תקציב בפרויקטים',
    titleEn: 'Project burn rate',
    semantics: 'For each active project: total budget, spent so far, remaining, % consumed, avg monthly burn over last 3 months, months-to-budget at current pace.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads project table for the list and sums transactions tagged to each project_id. Unlike other /insights cards (which strictly EXCLUDE projects), this card is the ONE EXCEPTION — projects are its subject.',
    timeScope: 'trailing-months',
    trailingMonths: 3,
    filters: ['project.status = active', 'project_id matches the project being summed'],
    mathRule: 'totalSpent = sum(|amt|) all-time for this project. monthlyBurn = sum(|amt|) over trailing 3 billing months / 3. monthsToBudget = remaining / monthlyBurn.',
    exclusions: ['inactive (status != active) projects'],
    queryFunction: 'getProjectBurnRate',
  },

  // ─── Untagged transactions ──────────────────────────────────────────────
  {
    id: 'untagged-transactions',
    pageId: '/insights',
    titleHe: 'תנועות ללא קטגוריה',
    titleEn: 'Untagged transactions',
    semantics: 'Count + sum + top merchants for transactions in the time window with NO category assigned. Data-integrity widget.',
    dataSource: 'both',
    dataSourceNotes: 'Counts ALL rows in window with category_id IS NULL. Doesn\'t filter by account type because untagged is a data-quality concern across all accounts.',
    timeScope: 'window',
    filters: ['category_id IS NULL', 'honors time window'],
    mathRule: 'COUNT(*) + SUM(|amount|) + top 5 merchants by count.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getUntaggedTransactions',
  },

  // ─── Low confidence categorizations ─────────────────────────────────────
  {
    id: 'low-confidence-categorizations',
    pageId: '/insights',
    titleHe: 'קטלוג בביטחון נמוך',
    titleEn: 'Low-confidence categorizations',
    semantics: 'Count + sum of transactions auto-categorized with confidence < 0.7. Suggests review to either confirm or recategorize.',
    dataSource: 'both',
    dataSourceNotes: 'Reads categorization_log to find low-confidence assignments. Filters to rows still matching their original assignment (user hasn\'t already corrected them).',
    timeScope: 'window',
    filters: ['confidence < 0.7', 'still using auto-assigned category'],
    mathRule: 'COUNT and SUM.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'getLowConfidenceCategorizations',
  },

  // ─── Suspicious installments ────────────────────────────────────────────
  {
    id: 'suspicious-installments',
    pageId: '/insights',
    titleHe: 'תשלומים חשודים',
    titleEn: 'Suspicious installment plans',
    semantics: 'Installment plans where reality doesn\'t match the plan: payments overflow past projected end, missing cycles, or amount drift.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads installment_plan rows and joins to their linked transactions. Cross-checks counts and amounts.',
    timeScope: 'all-time',
    filters: ['status = active'],
    mathRule: 'Three reason types: overflow (current_payment_no > total_payments), missing_cycle (gap in expected charge months), amount_drift (charge amount ≠ payment_amount_ils by > 5%).',
    exclusions: ['cancelled or complete plans'],
    queryFunction: 'getSuspiciousInstallments',
  },

  // ─── Mis-tagged transfers ───────────────────────────────────────────────
  {
    id: 'mis-tagged-transfers',
    pageId: '/insights',
    titleHe: 'העברות לא מסומנות',
    titleEn: 'Mis-tagged transfer candidates',
    semantics: 'Heuristic: pairs of opposite-sign same-magnitude transactions on different accounts within a few days — look like transfers between own accounts but weren\'t marked is_transfer=true.',
    dataSource: 'both',
    dataSourceNotes: 'Joins transactions to themselves on amount magnitude and proximity in date.',
    timeScope: 'all-time',
    filters: ['both rows have is_transfer=false', 'opposite signs', '|amount_a| ≈ |amount_b| within 5%', 'date_diff ≤ 4 days', 'different accounts'],
    mathRule: 'Pair-matching heuristic; surfaces up to 20 candidate pairs.',
    exclusions: ['already-paired transactions'],
    queryFunction: 'getMisTaggedTransferCandidates',
  },

  // ─── Bad recurring patterns ─────────────────────────────────────────────
  {
    id: 'bad-recurring-patterns',
    pageId: '/insights',
    titleHe: 'תבניות חוזרות בעייתיות',
    titleEn: 'Bad recurring patterns',
    semantics: 'Active recurring patterns where the recent charge history has ≥2 violations of their tolerance band. Suggests the expected amount is wrong or the pattern shouldn\'t be recurring.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern + last 6 transactions per pattern\'s merchant.',
    timeScope: 'all-time',
    filters: ['status = active', '≥3 recent charges available'],
    mathRule: 'For each of the last 6 charges: violation = |charge − expected| / expected > tolerance_pct/100. Flag pattern if violations ≥ 2.',
    exclusions: ['inactive patterns', 'patterns with < 3 historical charges'],
    queryFunction: 'getBadRecurringPatterns',
  },

  // ─── CC settlement reconciliation ───────────────────────────────────────
  {
    id: 'cc-settlement-mismatch',
    pageId: '/insights',
    titleHe: 'התאמת חיובי אשראי',
    titleEn: 'CC settlement reconciliation',
    semantics: 'Per-CC, per-billing-month: compares the bank-side settlement line (what bank paid the CC company) against the SUM of CC detail rows (what was actually charged on the card). Surfaces import gaps or unbundled charges.',
    dataSource: 'both',
    dataSourceNotes: 'CC details: reads CC-account transactions (non-forex only — forex isn\'t bundled in the settlement). Settlement: reads bank-account rows matching the CC issuer\'s merchant pattern (heuristic).',
    timeScope: 'all-time',
    filters: [
      'CC side: account.type=credit_card, non-forex, deleted_at IS NULL, is_projected=false',
      'Settlement side: account.type=bank, merchant matches CC issuer pattern, amount < 0',
    ],
    mathRule: 'CRITICAL: details total = ABS(SUM(amount)), NOT SUM(ABS(amount)). The two differ when refunds exist — abs-then-sum double-counts every refund (the refund got "subtracted" from settlement but "added" to abs(details)). Gap = details_net − settlement_total. Tolerance ₪10.',
    exclusions: ['cycles with gap < ₪10 (rounding/timing noise)', 'forex transactions on CC (settled separately)'],
    queryFunction: 'getCcSettlementMismatches',
    caveats: 'A "down arrow" gap (settlement > details) usually means missing CC detail rows. An "up arrow" gap (details > settlement) could be a normal in-progress cycle (bank hasn\'t paid yet) OR missing settlement row.',
  },

  // ─── Data quality strip ─────────────────────────────────────────────────
  {
    id: 'data-quality',
    pageId: '/insights',
    titleHe: 'אמינות נתונים',
    titleEn: 'Data quality strip',
    semantics: 'Top-of-page banner aggregating all data-integrity findings: worst-stale account, untagged count, low-confidence count, suspicious installments, unpaired transfers, bad recurring patterns.',
    dataSource: 'other-table',
    dataSourceNotes: 'Aggregates several data-integrity queries. Worst-stale = max(today − last_import_per_account).',
    timeScope: 'window',
    filters: ['Stale threshold: 14 days since last import'],
    mathRule: 'hasIssues = anything > 0.',
    exclusions: ['inactive accounts'],
    queryFunction: 'getDataQualitySummary',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // / (home dashboard) — KPIs, charge-date bar, recurring/savings/projects
  //                     widgets, recent-transactions strip, warnings
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'home.view-tabs',
    pageId: '/',
    titleHe: 'תצוגות חשבון (משולב / אישי / עסקי / משק בית)',
    titleEn: 'View tabs (account-purpose filter)',
    semantics: 'Four toggles that scope the entire dashboard to a subset of accounts based on each account\'s purpose tag. Combined = all accounts; Personal = account_purpose=personal; Business = account_purpose=business; Household = all accounts AND includes hidden-project transactions.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads accounts table; the view tag is applied as an account_id filter to every other widget on the page.',
    timeScope: 'na',
    filters: ['account_purpose IN (personal|business|null) depending on the active tab'],
    mathRule: 'View determines `accountFilter` array passed into every spending query on the page.',
    exclusions: ['Household view re-includes project rows that are otherwise excluded'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx (view resolution)',
    relatedWidgets: ['home.kpi.spent-so-far', 'home.kpi.income', 'home.kpi.balance'],
  },
  {
    id: 'home.month-switcher',
    pageId: '/',
    titleHe: 'מעבר בין חודשי חיוב',
    titleEn: 'Billing-month switcher',
    semantics: 'Previous/next month navigation + label. Sticky via fba_month cookie so the user resumes on the month they were last viewing. Defaults to activeBillingMonth(10).',
    dataSource: 'ui-only',
    dataSourceNotes: 'Active month resolution: URL ?month=YYYY-MM > fba_month cookie > activeBillingMonth(10).',
    timeScope: 'active-billing-month',
    filters: [],
    mathRule: 'Month string YYYY-MM passed to every query as the cycle anchor.',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
  },
  {
    id: 'home.kpi.spent-so-far',
    pageId: '/',
    titleHe: 'הוצאות עד עכשיו',
    titleEn: 'Spent so far (this billing cycle)',
    semantics: 'Cumulative expenses in the active billing month, charged or pending — what has hit OR will hit the bank account this cycle. In combined AND household views, shows a sub-caption "אישי X · עסקי Y" (household additionally adds "· פרויקטים Z") so the user can validate the total = sum of the per-bucket parts.',
    dataSource: 'both',
    dataSourceNotes: 'Reads all transactions in the household with the standard filters (no account-type filter). In practice this is dominated by bank rows because non-forex CC details are flagged excluded_from_totals=true. Forex CC charges keep excluded_from_totals=false and ARE counted (they hit the bank immediately, not bundled in the monthly settlement). The breakdown bucketing uses CASE WHEN: project_id IS NOT NULL → projects bucket; else account.purpose. Combined view excludes project rows upstream so the projects bucket stays empty; household view includes them.',
    timeScope: 'active-billing-month',
    filters: [
      'billing_month = activeMonth',
      'excluded_from_totals = false  (keeps CC details out, except forex)',
      'is_transfer = false',
      'view filter (account_purpose) applied via account_id IN (...) for personal/business; combined+household have no account filter',
      'hidden-project rows excluded unless household view',
    ],
    mathRule: 'SUM(|amount|) WHERE amount < 0. Per-bucket breakdown (combined + household views): GROUP BY (CASE WHEN project_id IS NOT NULL THEN \'projects\' ELSE accounts.purpose END) with the same SUM rule. Caption renders as "אישי X · עסקי Y · פרויקטים Z · אחר W" (projects/other only when nonzero).',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx (cashFlowSumsRow for total, cashFlowByPurposeRows for breakdown caption)',
    relatedWidgets: ['home.kpi.income', 'home.kpi.balance', 'home.kpi.projected-eom', 'home.charge-bar.already-charged'],
    caveats: 'Caption breakdown shows in combined + household views so users can verify the sum visually. Personal+Business+Projects+Other should equal the main figure exactly (rounding aside) — if not, that\'s a real bug to investigate. Combined view will show projects=0 because project rows are filtered upstream; household view splits them out separately.',
  },
  {
    id: 'home.kpi.income',
    pageId: '/',
    titleHe: 'הכנסות',
    titleEn: 'Income (this billing cycle)',
    semantics: 'Total income in the active billing cycle. In combined + household views shows a sub-caption "אישי X · עסקי Y" (household additionally adds "· פרויקטים Z" when projects had any income inflows) so the user can verify the total = sum of the per-bucket parts.',
    dataSource: 'both',
    dataSourceNotes: 'Same filter set as Spent-so-far — no account-type restriction. Sign-based detection: any positive amount counts (no category.is_income gate here, unlike the /insights Hero KPI). The looser sign-only rule keeps untagged positives visible on the dashboard. Caption breakdown uses the same CASE WHEN bucketing as spent-so-far: projects → projects bucket, else account.purpose.',
    timeScope: 'active-billing-month',
    filters: [
      'billing_month = activeMonth',
      'amount > 0',
      'is_transfer = false',
      'excluded_from_totals = false',
      'view filter applied for personal/business; none for combined+household',
    ],
    mathRule: 'SUM(amount) WHERE amount > 0. Per-bucket breakdown (combined + household): GROUP BY (CASE WHEN project_id IS NOT NULL THEN \'projects\' ELSE accounts.purpose END) with the same rule.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx (cashFlowSumsRow + cashFlowByPurposeRows)',
    caveats: 'Differs from /insights Hero KPI income (which additionally requires category.is_income=true). Home is sign-based; insights is sign-AND-categorized. Combined/household caption breakdown should sum to the main figure exactly.',
    relatedWidgets: ['home.warning.suspicious-income'],
  },
  {
    id: 'home.kpi.balance',
    pageId: '/',
    titleHe: 'מאזן החודש',
    titleEn: 'Net balance (income − expenses) this cycle',
    semantics: 'Signed net for the active cycle. Positive = surplus, negative = deficit. In combined + household views shows a sub-caption "אישי X · עסקי Y" (household additionally adds "· פרויקטים Z") with the signed per-bucket balance so the user can see which side of the household is net-positive or net-negative.',
    dataSource: 'both',
    dataSourceNotes: 'Algebraic: totalIncome + totalSpent (totalSpent is the signed negative sum). Same filters as the two tiles it derives from. Per-bucket breakdown reuses cashFlowByPurposeRows: per bucket, balance = SUM(positive amounts) + SUM(negative amounts) — i.e. signed net for that bucket alone.',
    timeScope: 'active-billing-month',
    filters: ['inherited from home.kpi.income + home.kpi.spent-so-far'],
    mathRule: 'income − expenses (signed). Per-bucket breakdown (combined + household): per bucket, balance = income + spent (signed). Same bucketing rule as spent/income tiles.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.kpi.income', 'home.kpi.spent-so-far'],
    caveats: 'Combined/household caption breakdown should satisfy: personal + business + projects + other = main balance figure exactly.',
  },
  {
    id: 'home.kpi.cumulative-balance',
    pageId: '/',
    titleHe: 'יתרה מצטברת בפועל',
    titleEn: 'Cumulative bank balance through end-of-cycle',
    semantics: 'Total money in bank accounts as of the end of the active cycle. Opening balance plus all net transactions through end-of-month.',
    dataSource: 'bank',
    dataSourceNotes: 'BANK ACCOUNTS ONLY. Unlike the spending tiles, this INCLUDES is_transfer=true rows because transfers move actual money between bank accounts. Excludes excludedFromTotals rows.',
    timeScope: 'active-billing-month',
    filters: [
      'accounts.type = bank',
      'transaction_date ≤ end-of-cycle date',
      'excluded_from_totals = false',
      'is_transfer INCLUDED (deliberate — transfers affect cash position)',
    ],
    mathRule: 'opening_balance_ils + SUM(amount) of all bank txns through end-of-month.',
    exclusions: ['credit-card accounts (their balance is debt, not cash)'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.kpi.projected-eom'],
  },
  {
    id: 'home.kpi.projected-eom',
    pageId: '/',
    titleHe: 'מאזן צפוי עד סוף חודש',
    titleEn: 'Projected end-of-month balance',
    semantics: 'Linear extrapolation of where the bank balance will land at month-end based on current burn rate. Falls back to current balance when there\'s not enough data to extrapolate.',
    dataSource: 'bank',
    dataSourceNotes: 'Daily-average extrapolation from elapsed days in cycle.',
    timeScope: 'active-billing-month',
    filters: ['requires day-of-cycle ≥ 5 AND transactions-so-far ≥ 3 to extrapolate; otherwise shows current balance'],
    mathRule: 'remaining_days × daily_avg_spend, where daily_avg_spend = spent_so_far / elapsed_days.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    caveats: 'Linear extrapolation — won\'t catch big one-off charges. The card explicitly disables the projection in past/future months and shows just the actual balance.',
  },
  {
    id: 'home.kpi.recurring-monthly',
    pageId: '/',
    titleHe: 'הוצאות קבועות חודשיות',
    titleEn: 'Active recurring monthly expense',
    semantics: 'Sum of expected monthly outflow from all active recurring patterns, frequency-normalized.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern (not transactions). Same normalization rule as /recurring page Monthly Expense tile.',
    timeScope: 'today-relative',
    filters: ['status=active', 'expected_amount_ils < 0', 'subscription_end_date IS NULL OR > today'],
    mathRule: 'SUM(|expected_amount_ils| × monthly_factor), where factor = 1 (monthly), 0.5 (bimonthly), 1/3 (quarterly), 1/12 (yearly).',
    exclusions: ['dynamic-amount patterns (contribute 0)', 'expired subscriptions'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx (loadRecurringForMonth)',
    relatedWidgets: ['recurring.kpi.monthly-expense'],
  },
  {
    id: 'home.charge-bar.already-charged',
    pageId: '/',
    titleHe: 'כבר חויב',
    titleEn: 'Already-charged segment of the charge-date bar',
    semantics: 'Portion of this cycle\'s spending whose charge_date is ≤ today (money already left the bank).',
    dataSource: 'bank',
    dataSourceNotes: 'Bank-only. Splits the cycle by charge_date relative to today.',
    timeScope: 'active-billing-month',
    filters: ['charge_date ≤ today OR charge_date IS NULL', 'same base filters as home.kpi.spent-so-far'],
    mathRule: 'SUM(|amount|) WHERE amount < 0 AND (charge_date ≤ today OR charge_date IS NULL).',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.charge-bar.pending-charge'],
  },
  {
    id: 'home.charge-bar.pending-charge',
    pageId: '/',
    titleHe: 'עוד יחויב',
    titleEn: 'Pending-charge segment of the charge-date bar',
    semantics: 'Portion of this cycle\'s spending whose charge_date is after today (money will leave the bank later this cycle).',
    dataSource: 'bank',
    dataSourceNotes: 'Bank-only. Complement of the already-charged segment.',
    timeScope: 'active-billing-month',
    filters: ['charge_date > today', 'same base filters as home.kpi.spent-so-far'],
    mathRule: 'SUM(|amount|) WHERE amount < 0 AND charge_date > today.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.charge-bar.already-charged'],
  },
  {
    id: 'home.insights.widget',
    pageId: '/',
    titleHe: 'תובנות AI',
    titleEn: 'AI Insights widget (mini)',
    semantics: 'Compact panel showing 2-5 deterministic insights (no LLM generation) chosen from the same query results that power /insights cards: narrative, budget warnings, recurring drift, etc.',
    dataSource: 'other-table',
    dataSourceNotes: 'Composes findings from multiple /insights queries. Doesn\'t do its own aggregation — pulls from finding arrays.',
    timeScope: 'active-billing-month',
    filters: ['varies by source insight'],
    mathRule: 'Severity-sorted bullets, capped at 5.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx (InsightsWidget)',
    relatedWidgets: ['narrative-summary'],
  },
  {
    id: 'home.budget.donut',
    pageId: '/',
    titleHe: 'הוצאות לפי קטגוריה (דונאט)',
    titleEn: 'Category donut chart',
    semantics: 'Pie/donut visualization of spending per top-level expense category for the active cycle.',
    dataSource: 'bank',
    dataSourceNotes: 'Same filter set as Spent-so-far. Bank-only. Groups by top-level category_id.',
    timeScope: 'active-billing-month',
    filters: ['inherited from home.kpi.spent-so-far'],
    mathRule: 'SUM(|amount|) WHERE amount < 0, grouped by parent category. Zero-spend categories hidden unless they have a monthly_target_ils set.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.budget.bars', 'category-by-charge-date'],
  },
  {
    id: 'home.budget.bars',
    pageId: '/',
    titleHe: 'מד התקדמות מול תקציב',
    titleEn: 'Category budget progress bars',
    semantics: 'Horizontal bars per top-level category showing actual spend / target. Color zones: ≥100% destructive, ≥80% warning, otherwise the category\'s own color. Categories without a target render relative bars sized by maxActual.',
    dataSource: 'bank',
    dataSourceNotes: 'Per-category sums from same source as the donut. Targets come from categories.monthly_target_ils.',
    timeScope: 'active-billing-month',
    filters: ['inherited from home.kpi.spent-so-far'],
    mathRule: 'pct = actual / target × 100 (capped at 100% visually) when target > 0; else actual / max(actuals) scaled.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.budget.donut'],
  },
  {
    id: 'home.recurring.top5',
    pageId: '/',
    titleHe: '5 הוצאות הקבועות הגדולות',
    titleEn: 'Top 5 recurring expenses',
    semantics: 'Sorted list of the five largest active monthly recurring expenses with merchant + category badge + amount.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern table.',
    timeScope: 'today-relative',
    filters: ['status=active', 'expected_amount_ils < 0'],
    mathRule: 'ORDER BY |expected_amount_ils| DESC, LIMIT 5.',
    exclusions: ['paused/ended patterns', 'expired subscriptions'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.kpi.recurring-monthly'],
  },
  {
    id: 'home.savings.box',
    pageId: '/',
    titleHe: 'חיסכון ויעדים (תקציר בלוח הבקרה)',
    titleEn: 'Savings summary box',
    semantics: 'Per-goal progress bars showing current / target plus an overall total footer.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads saving_goals table.',
    timeScope: 'all-time',
    filters: ['saving_goals.status = active'],
    mathRule: 'Per goal: current_amount_ils / target_amount_ils (capped 100%) when target set; bar colored by goal.color.',
    exclusions: ['paused / completed goals (in their own sections on /savings)'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['savings.monthly-rate.deposited'],
  },
  {
    id: 'home.projects.box',
    pageId: '/',
    titleHe: 'פרויקטים פעילים (תקציר)',
    titleEn: 'Active projects summary',
    semantics: 'Per-project cards showing name + status + cumulative spend + budget progress bar (when budget set).',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads projects table and aggregates linked transactions (all-time).',
    timeScope: 'all-time',
    filters: ['projects.status = active'],
    mathRule: 'totalSpent = SUM(|amount|) over all transactions tagged to the project. Budget pct = totalSpent / total_budget_ils × 100 when budget set.',
    exclusions: ['paused/completed projects (visible on /projects)'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx (getProjectsSummary)',
    relatedWidgets: ['projects.kpi.active-count', 'project-burn-rate'],
  },
  {
    id: 'home.txns.section',
    pageId: '/',
    titleHe: 'תנועות החודש (20 אחרונות)',
    titleEn: 'Recent transactions strip',
    semantics: 'Collapsible panel with the 20 most recent transactions of the active cycle plus a sign-tone subtotal bar. Server prefers month-wide totals so the bar matches the KPI strip.',
    dataSource: 'bank',
    dataSourceNotes: 'Same base filters as Spent-so-far. The visible LIST is capped at 20 rows by transaction_date DESC; the SUBTOTAL bar uses month totals (not just the 20 visible).',
    timeScope: 'active-billing-month',
    filters: ['billing_month = activeMonth', 'accounts.type = bank', 'is_transfer = false', 'excluded_from_totals = false'],
    mathRule: 'List = ORDER BY transaction_date DESC LIMIT 20. Subtotal = month-wide SUM split by sign.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['home.kpi.spent-so-far', 'home.kpi.income'],
  },
  {
    id: 'home.warning.suspicious-income',
    pageId: '/',
    titleHe: 'אזהרה: הכנסות חשודות בקטגוריות הוצאה',
    titleEn: 'Suspicious-income banner',
    semantics: 'Warning banner shown when ≥₪1,000 of positive amounts landed in EXPENSE categories — usually unflagged transfers between accounts.',
    dataSource: 'bank',
    dataSourceNotes: 'Detects positives in non-income categories — same signal the /insights mis-tagged-transfers card uses.',
    timeScope: 'active-billing-month',
    filters: ['amount ≥ 1000', 'category.is_income = false'],
    mathRule: 'SUM(amount) WHERE amount > 0 AND category in expense categories ≥ ₪1,000 triggers the banner.',
    exclusions: ['transactions already flagged is_transfer=true'],
    queryFunction: 'apps/web/src/app/(app)/page.tsx',
    relatedWidgets: ['mis-tagged-transfers'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // /transactions — full transaction table + filters + cycle banners
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'transactions.banner.current-cycle',
    pageId: '/transactions',
    titleHe: 'באנר מחזור נוכחי (חויב / יחויב)',
    titleEn: 'Current-cycle banner',
    semantics: 'Top banner showing this cycle\'s charge status (charged ✓ or pending ⏱) plus expenses, income, and transaction count. Updates the moment any row in the cycle is edited.',
    dataSource: 'bank',
    dataSourceNotes: 'Server-computed totals over the active billing-month bank rows. Excludes transfers and excluded_from_totals.',
    timeScope: 'active-billing-month',
    filters: [
      'billing_month = activeMonth',
      'accounts.type = bank',
      'is_transfer = false',
      'excluded_from_totals = false',
      'view filter applied via account_id IN (...)',
    ],
    mathRule: 'expenses = SUM(|amount|) WHERE amount<0. income = SUM(amount) WHERE amount>0. count = COUNT(*).',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/transactions/page.tsx',
  },
  {
    id: 'transactions.banner.next-cycle',
    pageId: '/transactions',
    titleHe: 'באנר חיוב הבא',
    titleEn: 'Next-cycle banner',
    semantics: 'Banner showing post-cutoff purchases that will land in the NEXT cycle\'s charge. Only renders if there are any rows in the post-cutoff window.',
    dataSource: 'bank',
    dataSourceNotes: 'Rows in the current calendar month whose transaction_date > cycle_charge_date.',
    timeScope: 'active-billing-month',
    filters: ['transaction_date > cycle_charge_date in this calendar month', 'same row-level filters as current-cycle banner'],
    mathRule: 'Same shape as the current banner; only difference is the date predicate.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/transactions/page.tsx',
  },
  {
    id: 'transactions.table.main',
    pageId: '/transactions',
    titleHe: 'טבלת תנועות',
    titleEn: 'Transactions table',
    semantics: 'The full transactions list for the active calendar month, grouped by transaction_date. Each row has date, merchant + badges, category, account, amount, and per-row actions.',
    dataSource: 'both',
    dataSourceNotes: 'Reads ALL transactions in the month by default (both bank rows and CC details). The `ccView` toggle decides which kind is HIDDEN — settlement mode hides excluded_from_totals=true CC details; details mode hides settlement lines (via isSettlementLineExpr heuristic). The cycle banner totals always use the canonical (excluded=false) set so they don\'t change when the user toggles ccView.',
    timeScope: 'active-billing-month',
    filters: [
      'transaction_date in [first-of-cycle, last-of-cycle]',
      'view filter (account_purpose) applied',
      'deleted_at IS NULL',
      'is_projected = false unless explicitly shown',
    ],
    mathRule: 'No aggregation — direct row render.',
    exclusions: ['soft-deleted', 'is_projected (unless toggled)', 'is_transfer (unless showTransfers toggled on)'],
    queryFunction: 'apps/web/src/app/(app)/transactions/page.tsx',
    relatedWidgets: ['transactions.controls.cc-view-toggle', 'transactions.controls.show-transfers-toggle'],
  },
  {
    id: 'transactions.controls.cc-view-toggle',
    pageId: '/transactions',
    titleHe: 'תצוגה: חיוב מצרפי / פירוט אשראי',
    titleEn: 'CC settlement vs detail toggle',
    semantics: 'Switches the table between two visually-different but mathematically-equivalent views: SETTLEMENT (default) hides CC details so each cycle shows a single bank-side line per card; DETAILS hides settlement lines and shows the underlying per-purchase rows.',
    dataSource: 'ui-only',
    dataSourceNotes: 'Pure render-side filter on the already-fetched row set. Cycle banner totals do not change between modes (math invariant).',
    timeScope: 'na',
    filters: ['SETTLEMENT mode: hide excluded_from_totals=true', 'DETAILS mode: hide rows matching isSettlementLineExpr heuristic'],
    mathRule: 'No math change — render-only.',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/transactions/page.tsx',
    caveats: 'A badge "(N hidden)" shows how many rows the OPPOSITE mode would surface.',
  },
  {
    id: 'transactions.controls.show-transfers-toggle',
    pageId: '/transactions',
    titleHe: 'הצג העברות בין חשבונות',
    titleEn: 'Show inter-account transfers',
    semantics: 'When OFF (default), is_transfer=true rows are hidden from the table and excluded from the banner totals. When ON, they appear in the table and the banner shows a "+N transfers (₪Y moved between accounts)" line.',
    dataSource: 'ui-only',
    dataSourceNotes: 'Affects both the visible list and the banner totals.',
    timeScope: 'na',
    filters: ['default: is_transfer = false. when ON: include is_transfer rows'],
    mathRule: 'Transfers are NEVER counted in expense/income totals — only listed as a separate count when toggled on.',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/transactions/page.tsx',
  },
  {
    id: 'transactions.section.date-subtotal',
    pageId: '/transactions',
    titleHe: 'סיכום יומי בכותרת תאריך',
    titleEn: 'Per-date inline subtotal',
    semantics: 'Below each transaction-date header, a single line summarizing the day: "Expenses: ₪X · Income: ₪Y · Recurring: ₪Z · Installments: ₪W".',
    dataSource: 'both',
    dataSourceNotes: 'Computed CLIENT-SIDE over the rows the page already fetched. Doesn\'t run its own SQL — it just groups+sums the already-filtered transactions array. The filtering (transfers excluded, excluded_from_totals=false, view account scope) happens upstream in transactions/page.tsx; see the cycle-banner spec for the canonical filter set.',
    timeScope: 'active-billing-month',
    filters: ['inherited from cycle banner'],
    mathRule: 'Per-date SUM split by sign + is_recurring + is_installment.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/transactions/transactions-list.tsx',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // /recurring — tiles + table for recurring patterns
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'recurring.kpi.monthly-expense',
    pageId: '/recurring',
    titleHe: 'הוצאות קבועות חודשיות',
    titleEn: 'Monthly recurring expense (frequency-normalized)',
    semantics: 'Sum of expected monthly outflow from all active expense patterns, normalized so non-monthly frequencies amortize to a per-month equivalent.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern table. Does NOT read transactions.',
    timeScope: 'today-relative',
    filters: [
      'status = active',
      'expected_amount_ils < 0',
      'subscription_end_date IS NULL OR > today (Israel time)',
    ],
    mathRule: 'SUM(|expected_amount_ils| × monthly_factor). Factors: monthly = 1, bimonthly = 1/2, quarterly = 1/3, yearly = 1/12.',
    exclusions: ['dynamic-amount patterns (contribute 0)', 'expired subscriptions', 'paused/ended patterns'],
    queryFunction: 'apps/web/src/app/(app)/recurring/page.tsx',
    caveats: 'Recent fix: non-monthly frequencies were previously DROPPED entirely. Now they amortize. Also: expired-end-date patterns are no longer counted.',
    relatedWidgets: ['home.kpi.recurring-monthly'],
  },
  {
    id: 'recurring.kpi.monthly-income',
    pageId: '/recurring',
    titleHe: 'הכנסות קבועות חודשיות',
    titleEn: 'Monthly recurring income (frequency-normalized)',
    semantics: 'Same as recurring monthly expense but for positive expected amounts.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads recurring_pattern.',
    timeScope: 'today-relative',
    filters: ['status = active', 'expected_amount_ils > 0', 'not expired'],
    mathRule: 'SUM(expected_amount_ils × monthly_factor).',
    exclusions: ['dynamic, expired'],
    queryFunction: 'apps/web/src/app/(app)/recurring/page.tsx',
  },
  {
    id: 'recurring.kpi.net-flow',
    pageId: '/recurring',
    titleHe: 'תזרים נטו צפוי',
    titleEn: 'Expected monthly net flow',
    semantics: 'Income − expense from recurring patterns.',
    dataSource: 'other-table',
    dataSourceNotes: 'Algebraic derivation from the two preceding tiles.',
    timeScope: 'today-relative',
    filters: ['inherited'],
    mathRule: 'monthlyIncome − monthlyExpense (signed).',
    exclusions: ['dynamic, expired'],
    queryFunction: 'apps/web/src/app/(app)/recurring/page.tsx',
  },
  {
    id: 'recurring.kpi.active-count',
    pageId: '/recurring',
    titleHe: 'תבניות פעילות',
    titleEn: 'Active patterns count',
    semantics: 'Count of non-expired active patterns.',
    dataSource: 'other-table',
    dataSourceNotes: 'COUNT over the same filtered set as the expense/income tiles. Has a sub-caption showing how many dynamic-amount patterns are present (they\'re active but contribute 0 to sums).',
    timeScope: 'today-relative',
    filters: ['status = active', 'not expired'],
    mathRule: 'COUNT(*).',
    exclusions: ['expired subscriptions'],
    queryFunction: 'apps/web/src/app/(app)/recurring/page.tsx',
  },
  {
    id: 'recurring.table.action.batch-reminders',
    pageId: '/recurring',
    titleHe: 'צור התראות לכולם',
    titleEn: 'Bulk-create reminders',
    semantics: 'Creates smart notification tasks for every active pattern that doesn\'t already have one. Schedule depends on whether the pattern has an end-date (long lead time for cancel decisions) vs not (short lead time for don\'t-forget-to-pay).',
    dataSource: 'other-table',
    dataSourceNotes: 'Writes to notification_task table (linked to recurring_pattern_id).',
    timeScope: 'today-relative',
    filters: ['status = active', 'has no pending notification_task already'],
    mathRule: 'Per-pattern schedule chosen by `buildNotificationSeed`.',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/recurring/actions.ts',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // /installments — tiles + table for installment plans
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'installments.kpi.monthly-commitment',
    pageId: '/installments',
    titleHe: 'הוצאה חודשית פעילה',
    titleEn: 'Active monthly installment commitment',
    semantics: 'Sum of payment amounts across all plans that are still being paid this month.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads installment_plan. "Active" uses derivedStatus, not raw DB status — see the derivation note.',
    timeScope: 'today-relative',
    filters: ['derivedStatus = active'],
    mathRule: 'SUM(|payment_amount_ils|).',
    exclusions: ['completed plans (DB OR derived)', 'cancelled plans'],
    queryFunction: 'apps/web/src/app/(app)/installments/page.tsx',
    caveats: 'derivedStatus: if status=active AND current_payment_no >= total_payments → "complete". Prevents fully-paid plans from inflating this tile while their DB row is still active.',
  },
  {
    id: 'installments.kpi.total-remaining',
    pageId: '/installments',
    titleHe: 'סה״כ נותר לתשלום',
    titleEn: 'Total remaining payments value',
    semantics: 'Sum of remaining payment value across all active plans.',
    dataSource: 'other-table',
    dataSourceNotes: 'Per-plan remaining count × payment amount.',
    timeScope: 'today-relative',
    filters: ['derivedStatus = active'],
    mathRule: 'Per plan: rem = MAX(0, total_payments − current_payment_no). totalRemaining = SUM(rem × |payment_amount_ils|).',
    exclusions: ['completed, cancelled'],
    queryFunction: 'apps/web/src/app/(app)/installments/page.tsx',
  },
  {
    id: 'installments.kpi.completed-count',
    pageId: '/installments',
    titleHe: 'הושלמו',
    titleEn: 'Completed plans count',
    semantics: 'Count of plans that have either explicit status=complete OR are fully paid (currentPaymentNo >= totalPayments).',
    dataSource: 'other-table',
    dataSourceNotes: 'Uses derivedStatus so plans whose DB status hasn\'t been updated but are factually finished still get counted.',
    timeScope: 'today-relative',
    filters: ['derivedStatus = complete'],
    mathRule: 'COUNT(*).',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/installments/page.tsx',
    caveats: 'Recent fix: previously counted strict DB status only, so plans paid in full via the edit modal (not the advance-payment button) were missed. Self-heals: the next edit/update flips the DB status to complete automatically.',
  },
  {
    id: 'installments.kpi.soonest-end-month',
    pageId: '/installments',
    titleHe: 'הסתיימות קרובה',
    titleEn: 'Soonest upcoming end month',
    semantics: 'Earliest projected end month among active plans, restricted to months that haven\'t already passed.',
    dataSource: 'other-table',
    dataSourceNotes: 'Filters out plans whose projected_end_month < current YYYY-MM (Israel time).',
    timeScope: 'today-relative',
    filters: ['derivedStatus = active', 'projected_end_month >= current YYYY-MM'],
    mathRule: 'MIN(projected_end_month) over the filtered set, or null if no upcoming end.',
    exclusions: ['plans with no projected end', 'stuck plans whose projected end already passed (they\'d hide the truly-upcoming one)'],
    queryFunction: 'apps/web/src/app/(app)/installments/page.tsx',
    caveats: 'Recent fix: was showing past months for stuck active plans. Now excludes past dates so the tile reads as "next plan to finish".',
  },
  {
    id: 'installments.table.derived-status-badge',
    pageId: '/installments',
    titleHe: 'תג סטטוס (נגזר)',
    titleEn: 'Per-row derived status badge',
    semantics: 'Status pill in the table — uses derivedStatus, not raw DB status, so a fully-paid plan reads as "complete" even before someone updates the DB row.',
    dataSource: 'other-table',
    dataSourceNotes: 'Same derivation as the completed-count tile.',
    timeScope: 'today-relative',
    filters: ['per row'],
    mathRule: 'derivedStatus = (status=cancelled ? cancelled : status=complete ? complete : isFullyPaid(p) ? complete : active).',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/installments/page.tsx',
  },
  {
    id: 'installments.action.advance-payment',
    pageId: '/installments',
    titleHe: 'סמן תשלום כבוצע',
    titleEn: 'Advance-payment action',
    semantics: 'Increments current_payment_no by 1. When the new value reaches total_payments, the plan auto-completes (status flipped, actual_end_month stamped).',
    dataSource: 'other-table',
    dataSourceNotes: 'Writes to installment_plan.',
    timeScope: 'today-relative',
    filters: ['plan must be status=active and not yet fully paid'],
    mathRule: 'newNo = current + 1. isComplete = newNo >= total_payments (>=, not >). Auto-flip status to complete + stamp actual_end_month if isComplete.',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/installments/actions.ts',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // /savings — monthly rate + per-goal progress
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'savings.monthly-rate.deposited',
    pageId: '/savings',
    titleHe: 'חיסכון החודש',
    titleEn: 'Deposited into savings this cycle',
    semantics: 'Sum of transactions tagged to savings-category-flagged categories in the active billing month.',
    dataSource: 'both',
    dataSourceNotes: 'Reads transactions filtered to category IDs where category.is_savings=true. No account-type filter — savings deposits could come from any account (bank → savings transfer, CC reward → savings, etc.). The category tag is what classifies them as savings. In practice the user\'s savings transactions are bank-initiated, but the spec deliberately doesn\'t lock to bank-only because that would break if the user ever tagged a CC reward redemption as savings.',
    timeScope: 'active-billing-month',
    filters: [
      'billing_month = activeMonth',
      'category_id IN (savings categories)',
      'is_projected = false',
      'deleted_at IS NULL',
      'hidden-project rows excluded',
    ],
    mathRule: 'ABS(SUM(amount_ils)). The abs handles whichever sign convention the user picks for savings transactions (positive or negative).',
    exclusions: ['hidden-project rows', 'soft-deleted rows', 'is_projected rows'],
    queryFunction: 'apps/web/src/app/(app)/savings/page.tsx',
  },
  {
    id: 'savings.monthly-rate.target',
    pageId: '/savings',
    titleHe: 'יעד חודשי לחיסכון',
    titleEn: 'Monthly savings target',
    semantics: 'Sum of monthly_target_ils across all savings categories.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads the categories table where is_savings = true.',
    timeScope: 'all-time',
    filters: ['categories.is_savings = true'],
    mathRule: 'SUM(monthly_target_ils).',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/savings/page.tsx',
  },
  {
    id: 'savings.monthly-rate.percentage',
    pageId: '/savings',
    titleHe: '% מהיעד החודשי',
    titleEn: 'Monthly rate percentage',
    semantics: 'Deposited / target × 100 (capped 100% visually). Color zones for tone.',
    dataSource: 'both',
    dataSourceNotes: 'Derives from the two preceding tiles — inherits the category-based filtering of monthly-rate.deposited.',
    timeScope: 'active-billing-month',
    filters: ['inherited'],
    mathRule: '(deposited / target) × 100. ≥100% → success tone.',
    exclusions: STANDARD_SPENDING_EXCLUSIONS,
    queryFunction: 'apps/web/src/app/(app)/savings/page.tsx',
  },
  {
    id: 'savings.goal.eta-months',
    pageId: '/savings',
    titleHe: 'ETA לחודשים עד יעד',
    titleEn: 'Months-to-target ETA per goal',
    semantics: 'How many months until each goal reaches its target at the current monthly contribution rate.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads saving_goals table.',
    timeScope: 'all-time',
    filters: ['target_amount_ils IS NOT NULL', 'monthly_contribution_ils > 0'],
    mathRule: 'CEIL((target_amount_ils − current_amount_ils) / monthly_contribution_ils).',
    exclusions: ['goals with no target or no monthly contribution (returns null)'],
    queryFunction: 'apps/web/src/app/(app)/savings/client.tsx',
  },
  {
    id: 'savings.goal.totals',
    pageId: '/savings',
    titleHe: 'סיכום חסכון (פעיל)',
    titleEn: 'Active goals totals',
    semantics: 'Bottom strip aggregating current and target sums across all active goals.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads saving_goals filtered to status=active.',
    timeScope: 'all-time',
    filters: ['status = active'],
    mathRule: 'totalCurrent = SUM(current_amount_ils). totalTarget = SUM(target_amount_ils) WHERE status != completed.',
    exclusions: ['paused / completed goals'],
    queryFunction: 'apps/web/src/app/(app)/savings/client.tsx',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // /projects — KPIs + per-project breakdown
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: 'projects.kpi.active-count',
    pageId: '/projects',
    titleHe: 'פרויקטים פעילים',
    titleEn: 'Active projects count',
    semantics: 'Count of projects with status=active.',
    dataSource: 'other-table',
    dataSourceNotes: 'Reads projects table.',
    timeScope: 'all-time',
    filters: ['status = active'],
    mathRule: 'COUNT(*).',
    exclusions: ['paused, completed, cancelled'],
    queryFunction: 'apps/web/src/app/(app)/projects/actions.ts',
  },
  {
    id: 'projects.kpi.total-expenses',
    pageId: '/projects',
    titleHe: 'סך הוצאות (פרויקטים)',
    titleEn: 'Total project expenses (all-time)',
    semantics: 'Sum of all expenses across all projects, all-time.',
    dataSource: 'both',
    dataSourceNotes: 'Reads transactions tagged to any project_id. Sign-aware. Unlike /insights and the home dashboard, projects pages DELIBERATELY include project-tagged rows (they are the subject).',
    timeScope: 'all-time',
    filters: [
      'project_id IS NOT NULL',
      'amount < 0',
      'excluded_from_totals = false',
      'deleted_at IS NULL',
      'is_projected = false',
    ],
    mathRule: 'SUM(|amount|).',
    exclusions: ['deleted, projected'],
    queryFunction: 'apps/web/src/app/(app)/projects/actions.ts',
  },
  {
    id: 'projects.kpi.total-income',
    pageId: '/projects',
    titleHe: 'סך מימון / הכנסות',
    titleEn: 'Total project income / funding',
    semantics: 'Sum of positive amounts tagged to projects — typically partner contributions, refunds, sales income.',
    dataSource: 'both',
    dataSourceNotes: 'Mirrors the expenses tile with amount > 0.',
    timeScope: 'all-time',
    filters: ['project_id IS NOT NULL', 'amount > 0', 'excluded_from_totals = false'],
    mathRule: 'SUM(amount) WHERE amount > 0.',
    exclusions: ['deleted, projected'],
    queryFunction: 'apps/web/src/app/(app)/projects/actions.ts',
  },
  {
    id: 'projects.kpi.net-out-of-pocket',
    pageId: '/projects',
    titleHe: 'נטו מהכיס',
    titleEn: 'Net out-of-pocket across projects',
    semantics: 'Expenses − income. Positive means you funded it; negative means projects net-earned.',
    dataSource: 'both',
    dataSourceNotes: 'Algebraic derivation.',
    timeScope: 'all-time',
    filters: ['inherited'],
    mathRule: 'totalExpenses − totalIncome (signed).',
    exclusions: [],
    queryFunction: 'apps/web/src/app/(app)/projects/actions.ts',
  },
  {
    id: 'projects.detail.budget-progress-bar',
    pageId: '/projects',
    titleHe: 'התקדמות תקציב פרויקט',
    titleEn: 'Project budget progress bar',
    semantics: 'Per-project bar showing actual expenses / total_budget_ils × 100. Tone destructive at ≥100%, warning at ≥80%.',
    dataSource: 'both',
    dataSourceNotes: 'Combines project.total_budget_ils with summed expenses.',
    timeScope: 'all-time',
    filters: ['total_budget_ils > 0'],
    mathRule: '(totalExpenses / total_budget_ils) × 100, capped visually at 100%.',
    exclusions: ['projects with no budget set'],
    queryFunction: 'apps/web/src/app/(app)/projects/[id]/page.tsx',
    relatedWidgets: ['project-burn-rate'],
  },
  {
    id: 'projects.detail.expenses-by-category',
    pageId: '/projects',
    titleHe: 'הוצאות לפי קטגוריה (פרויקט יחיד)',
    titleEn: 'Per-project expenses by category donut',
    semantics: 'Donut chart of how a single project\'s spending breaks down by category.',
    dataSource: 'both',
    dataSourceNotes: 'Project-scoped, sign-aware.',
    timeScope: 'all-time',
    filters: ['project_id = currentProject', 'amount < 0', 'excluded_from_totals = false'],
    mathRule: 'GROUP BY category_id, SUM(|amount|), ORDER BY DESC.',
    exclusions: ['deleted, projected'],
    queryFunction: 'apps/web/src/app/(app)/projects/[id]/page.tsx',
  },
];

/** Index by id for O(1) lookup. */
export const WIDGET_SPECS_BY_ID: Record<string, WidgetSpec> =
  Object.fromEntries(WIDGET_SPECS.map((s) => [s.id, s]));

/** Get a single widget spec by id, or null if no match. */
export function getWidgetSpec(id: string): WidgetSpec | null {
  return WIDGET_SPECS_BY_ID[id] ?? null;
}

/** Compact summary list — id + page + Hebrew title only. Optionally filter
 *  to a single page. Used by the chatbot tool when no specific widget id is
 *  requested so the LLM has a menu to pick from. */
export function listWidgets(
  opts?: { pageId?: PageId },
): Array<Pick<WidgetSpec, 'id' | 'pageId' | 'titleHe' | 'titleEn'>> {
  const filtered = opts?.pageId
    ? WIDGET_SPECS.filter((s) => s.pageId === opts.pageId)
    : WIDGET_SPECS;
  return filtered.map((s) => ({ id: s.id, pageId: s.pageId, titleHe: s.titleHe, titleEn: s.titleEn }));
}

// ─── Legacy aliases (kept for older callers; new code should use the
//    page-aware exports above) ──────────────────────────────────────────
/** @deprecated Use `WIDGET_SPECS` and filter by pageId. */
export const INSIGHT_WIDGET_SPECS = WIDGET_SPECS.filter((s) => s.pageId === '/insights');
/** @deprecated Use `WIDGET_SPECS_BY_ID`. */
export const INSIGHT_WIDGET_SPECS_BY_ID = WIDGET_SPECS_BY_ID;
/** @deprecated Use `getWidgetSpec`. */
export function getInsightWidgetSpec(id: string): WidgetSpec | null {
  return getWidgetSpec(id);
}
/** @deprecated Use `listWidgets({ pageId: '/insights' })`. */
export function listInsightWidgets(): Array<Pick<WidgetSpec, 'id' | 'titleHe' | 'titleEn'>> {
  return listWidgets({ pageId: '/insights' }).map(({ id, titleHe, titleEn }) => ({ id, titleHe, titleEn }));
}
