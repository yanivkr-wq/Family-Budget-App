import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { households } from './identity';

// ----- accounts (bank or credit card) -----
export const accounts = pgTable(
  'account',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text({ enum: ['bank', 'credit_card'] }).notNull(),
    /**
     * What kind of money this account holds. Used by the Personal/Business/Combined
     * dashboard views to filter and to deduplicate transfers in the Combined view.
     * - personal: family/personal account (default)
     * - business: business / self-employed account
     * - shared: both — count in either view (rare)
     */
    purpose: text({ enum: ['personal', 'business', 'shared'] }).notNull().default('personal'),
    institution: text().notNull(), // 'hapoalim' | 'leumi' | 'discount' | 'mizrahi' | 'cal' | 'isracard' | 'max' | ...
    scraperProvider: text(), // israeli-bank-scrapers companyId; null = manual only
    encryptedCredentials: text(), // libsodium secretbox(JSON.stringify(creds)), base64
    /**
     * How money actually leaves this account.
     *  - immediate: every transaction is debited the same day (banks, debit cards)
     *  - monthly_billing: transactions accumulate and are debited together on charge_day
     *    (Israeli credit cards: typically 10/2 of each month).
     *  Forex transactions on monthly_billing accounts are an exception — they're charged immediately.
     */
    paymentSchedule: text({ enum: ['immediate', 'monthly_billing'] })
      .notNull()
      .default('immediate'),
    /** For monthly_billing accounts: the day-of-month the bank actually debits the linked bank account. */
    chargeDay: integer().notNull().default(10),
    cutoffDay: integer().notNull().default(10), // 0 = always current month (banks); 1-28 for credit cards
    accountNumberMasked: text(), // last 4 digits only — for display
    /**
     * External identifier the bank/CC issuer uses in their export files.
     * Used by the importer to AUTO-ROUTE files to the right account
     * without forcing the user to pick from a dropdown each upload.
     *
     * Examples:
     *  - CC last-4 digits: "7627" (Discount Key, Cal, Diners GooglePay)
     *  - Wallet identifier suffix: "9648" (Cal "GooglePay 9648")
     *  - Bank account number: "669-4703428" (Leumi/Discount checking)
     *
     * Matching is case/whitespace-insensitive substring against the
     * identifier the parser extracts from each file. Set once per
     * account in the admin UI.
     */
    externalKey: text(),
    currency: text().notNull().default('ILS'),
    isActive: boolean().notNull().default(true),
    lastScrapedAt: timestamp({ withTimezone: true }),
    lastScrapeStatus: text({ enum: ['ok', 'auth_failed', 'error', 'never'] })
      .notNull()
      .default('never'),
    lastScrapeError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    activeIdx: index().on(t.householdId, t.isActive),
    purposeIdx: index().on(t.householdId, t.purpose),
  }),
);

// ----- import sessions — tracks every file the user uploaded -----
//
// Why this exists:
//   1. So the user can see "I uploaded these 3 files for April" — a per-month log
//   2. So the user can REVERT a bad import (e.g., uploaded the wrong file by mistake)
//      by soft-deleting all transactions linked to that session in one click
//   3. So we can detect "you've already uploaded this same file" via file_hash
//
// Each row of `transaction` has an `import_session_id` linking back here. Reverting
// a session just sets `deleted_at` on every linked transaction and flips the session
// status to 'reverted' — no data loss, fully reversible by clearing `deleted_at`.

import { jsonb as _jsonb } from 'drizzle-orm/pg-core';
export const importSessions = pgTable(
  'import_session',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    actorUserId: uuid(),
    filename: text().notNull(),
    fileHash: text(), // sha256 of file contents
    fileSize: integer().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    sourceType: text({ enum: ['baseline', 'raw_bank', 'csv', 'legacy', 'manual'] })
      .notNull(),
    templateUsed: text(),
    billingMonths: jsonb(),
    status: text({ enum: ['committed', 'reverted', 'failed'] })
      .notNull()
      .default('committed'),
    insertedCount: integer().notNull().default(0),
    duplicateCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    createdAccounts: jsonb(),
    createdCategories: jsonb(),
    summary: jsonb(),
    committedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    revertedAt: timestamp({ withTimezone: true }),
    revertedByUserId: uuid(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId, t.committedAt),
    statusIdx: index().on(t.householdId, t.status),
    fileHashIdx: index().on(t.householdId, t.fileHash),
  }),
);

// ----- projects (e.g., home construction, vacation, kid's wedding) -----
export const projects = pgTable(
  'project',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(), // e.g., "בניית בית"
    description: text(),
    color: text(), // hex
    icon: text(),
    totalBudgetIls: numeric({ precision: 12, scale: 2 }),
    startDate: date(),
    endDate: date(),
    status: text({ enum: ['active', 'completed', 'cancelled', 'paused'] })
      .notNull()
      .default('active'),
    /** When true, exclude project transactions from default monthly summaries. */
    excludeFromMonthlyTotals: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    statusIdx: index().on(t.householdId, t.status),
  }),
);

// ----- categories (hierarchical) -----
export const categories = pgTable(
  'category',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    nameHe: text().notNull(),
    nameEn: text(),
    parentId: uuid().references((): any => categories.id, { onDelete: 'cascade' }),
    icon: text(), // lucide icon name
    color: text(), // hex
    monthlyTargetIls: numeric({ precision: 10, scale: 2 }), // null for sub-categories or untargeted
    sortOrder: integer().notNull().default(0),
    isIncome: boolean().notNull().default(false),
    isArchived: boolean().notNull().default(false),
    /** When true, transactions tagged with this category count toward the monthly savings rate. */
    isSavings: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    parentIdx: index().on(t.parentId),
  }),
);

// ----- installment plans -----
export const installmentPlans = pgTable(
  'installment_plan',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    merchantNormalized: text().notNull(),
    description: text(),
    totalPayments: integer(), // null = unknown
    paymentAmountIls: numeric({ precision: 10, scale: 2 }).notNull(),
    currentPaymentNo: integer().notNull().default(1),
    startMonth: text().notNull(), // 'YYYY-MM'
    projectedEndMonth: text(), // 'YYYY-MM'
    actualEndMonth: text(),
    status: text({ enum: ['active', 'complete', 'cancelled'] })
      .notNull()
      .default('active'),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    statusIdx: index().on(t.householdId, t.status),
  }),
);

// ----- transactions -----
export const transactions = pgTable(
  'transaction',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    externalId: text(), // provider-issued unique id; null for manual
    transactionDate: date().notNull(), // when the user spent
    postedDate: date(), // when the issuer cleared it on their side
    /**
     * When the money actually leaves the user's bank account. For immediate-schedule
     * accounts this equals transactionDate. For monthly-billing credit cards, it's the
     * cycle's chargeDay. For forex on a monthly-billing card it's the transactionDate.
     * Used by the dashboard to compute "available cash this month" accurately.
     */
    chargeDate: date(),
    billingMonth: text().notNull(), // 'YYYY-MM' — computed from chargeDate (or transactionDate for immediate accounts)
    amountIls: numeric({ precision: 10, scale: 2 }).notNull(), // negative = expense, positive = income
    currency: text().notNull().default('ILS'),
    originalAmount: numeric({ precision: 10, scale: 2 }), // for foreign currency
    originalCurrency: text(),
    merchantRaw: text().notNull(),
    merchantNormalized: text().notNull(),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    subCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    installmentPlanId: uuid().references(() => installmentPlans.id, { onDelete: 'set null' }),
    /**
     * Project this transaction belongs to (e.g., "Home construction"). When set, the
     * transaction is excluded from default monthly-summary views so big project costs
     * don't drown out regular spending.
     */
    projectId: uuid().references((): any => projects.id, { onDelete: 'set null' }),
    /**
     * The import session that created this transaction. When the user reverts a session,
     * we soft-delete every transaction with this import_session_id in one query.
     */
    importSessionId: uuid().references((): any => importSessions.id, { onDelete: 'set null' }),
    isRecurring: boolean().notNull().default(false),
    isInstallment: boolean().notNull().default(false),
    isProjected: boolean().notNull().default(false), // true = future projection (template row, not actually paid)
    /**
     * True when this transaction represents a transfer between two of the user's own
     * accounts (e.g., business → personal salary). Excluded from Combined-view income
     * totals so the same money isn't counted twice.
     */
    isTransfer: boolean().notNull().default(false),
    /** Links the two sides of a transfer (out from one account, in to another). */
    transferPairId: uuid().references((): any => transactions.id, { onDelete: 'set null' }),
    isManual: boolean().notNull().default(false),
    notes: text(),
    /**
     * Which category_rule last set the category on this transaction. NULL means the
     * category was set manually by the user (or not set at all).
     * Used to show the "auto-categorized" badge on the transactions list.
     */
    appliedRuleId: uuid().references((): any => categoryRules.id, { onDelete: 'set null' }),
    /**
     * How the category was assigned:
     *  'rule'   – matched a category_rule automatically
     *  'llm'    – Claude Haiku suggested it (LLM fallback)
     *  'manual' – user set it explicitly via the UI
     */
    /**
     * How this transaction got its category. Drives the badge in the UI:
     *   • 'rule'             — user-defined category_rule (with applied_rule_id)
     *   • 'bank_hint'        — bank's own ענף column → mapped to household category
     *   • 'merchant_keyword' — merchant name keyword scan against the same map
     *   • 'tagged_export'    — file already carried an exact category name (custom Excel)
     *   • 'llm'              — Claude classified it
     *   • 'manual'           — user picked the category in the UI
     * Plain text column — adding new values does NOT require a migration.
     */
    categorySource: text({ enum: ['rule', 'llm', 'manual', 'bank_hint', 'merchant_keyword', 'tagged_export'] }),
    rawSource: jsonb(), // raw scraped object for debugging
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    accountDateIdx: index().on(t.accountId, t.transactionDate),
    billingMonthIdx: index().on(t.householdId, t.billingMonth),
    // Hot dashboard path: household + billingMonth + not-deleted + not-projected
    billingMonthActiveIdx: index().on(t.householdId, t.billingMonth, t.isProjected),
    // Charge-date breakdown queries on the dashboard
    chargeDateIdx: index().on(t.householdId, t.chargeDate),
    categoryIdx: index().on(t.householdId, t.categoryId),
    merchantIdx: index().on(t.householdId, t.merchantNormalized),
    projectIdx: index().on(t.householdId, t.projectId),
    transferIdx: index().on(t.householdId, t.isTransfer),
    importSessionIdx: index().on(t.importSessionId),
    externalIdUnique: unique().on(t.accountId, t.externalId),
    deletedIdx: index().on(t.deletedAt),
  }),
);

// ----- recurring patterns (auto-detected) -----
export const recurringPatterns = pgTable(
  'recurring_pattern',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    merchantNormalized: text().notNull(),
    /** Human-readable label for what's actually being paid for. The
     *  merchantNormalized identifies WHO is charging (used as the join key
     *  for the קבוע badge); description identifies WHAT — e.g. merchant =
     *  "פייבוקס", description = "השכרת דירה אורית מילוא". Optional. */
    description: text(),
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    /**
     * How to interpret the amount fields:
     *   'fixed'   — expectedAmountIls is THE expected charge each cycle
     *               (small drift OK via tolerancePct)
     *   'range'   — expectedAmountIls = midpoint, min/max define the band
     *               (use for things that bounce within a known range, like
     *                a 194-197₪ insurance premium)
     *   'dynamic' — no fixed amount; whatever the actual charge is wins
     *               (use for variable bills like electricity / water)
     */
    amountMode: text({ enum: ['fixed', 'range', 'dynamic'] })
      .notNull()
      .default('fixed'),
    expectedAmountIls: numeric({ precision: 10, scale: 2 }).notNull(),
    medianAmountIls: numeric({ precision: 10, scale: 2 }).notNull(),
    /** Lower bound for 'range' mode (inclusive). Null otherwise. */
    minAmountIls: numeric({ precision: 10, scale: 2 }),
    /** Upper bound for 'range' mode (inclusive). Null otherwise. */
    maxAmountIls: numeric({ precision: 10, scale: 2 }),
    tolerancePct: integer().notNull().default(10),
    frequency: text({ enum: ['monthly', 'bimonthly', 'quarterly', 'yearly'] })
      .notNull()
      .default('monthly'),
    occurrenceCount: integer().notNull().default(0),
    firstSeenMonth: text().notNull(),
    lastSeenMonth: text().notNull(),
    status: text({ enum: ['active', 'paused', 'ended'] })
      .notNull()
      .default('active'),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    merchantUnique: unique().on(t.householdId, t.merchantNormalized),
  }),
);

// ----- categorization rules -----
export const categoryRules = pgTable(
  'category_rule',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Human-readable name (auto-generated from pattern if not provided). */
    name: text(),
    /** Optional longer description of why this rule exists. */
    description: text(),
    priority: integer().notNull().default(100), // lower = higher priority
    matchType: text({ enum: ['contains', 'regex', 'exact', 'starts_with'] })
      .notNull()
      .default('contains'),
    pattern: text().notNull(),
    /**
     * Optional secondary AND-condition: the transaction's `notes` field must ALSO match this pattern.
     * null = no notes condition (rule applies regardless of notes).
     * Example: merchant contains "paybox" AND notes contains "אורית מילוא" → set pattern="paybox", notesPattern="אורית מילוא"
     */
    notesPattern: text(),
    /** Match type for notesPattern (only relevant when notesPattern is set). Defaults to 'contains'. */
    notesMatchType: text().default('contains'),
    appliesToAccountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }), // null = all accounts
    /** Conditional: only apply if amount is at least this much (absolute value). null = no minimum. */
    minAmountIls: numeric({ precision: 10, scale: 2 }),
    /** Conditional: only apply if amount is at most this much (absolute value). null = no maximum. */
    maxAmountIls: numeric({ precision: 10, scale: 2 }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    subCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    source: text({ enum: ['user', 'llm_confirmed', 'pending'] })
      .notNull()
      .default('user'),
    isActive: boolean().notNull().default(true),
    timesApplied: integer().notNull().default(0),
    /** Last time this rule actually fired against a transaction. */
    lastAppliedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp({ withTimezone: true }),
  },
  (t) => ({
    householdIdx: index().on(t.householdId, t.isActive, t.priority),
    sourceIdx: index().on(t.householdId, t.source),
  }),
);

// ----- saving goals -----
export const savingGoals = pgTable(
  'saving_goal',
  {
    id: uuid().defaultRandom().primaryKey(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text().notNull(), // e.g., "קרן חירום", "רכב", "כללי"
    description: text(),
    icon: text(), // lucide icon name
    color: text(), // hex
    /** Total savings target for this goal (null = open-ended / no fixed target). */
    targetAmountIls: numeric({ precision: 12, scale: 2 }),
    /** Current amount saved toward this goal — updated manually by the user. */
    currentAmountIls: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
    /** Monthly contribution target for this specific goal (used for ETA calculation). */
    monthlyContributionIls: numeric({ precision: 10, scale: 2 }),
    targetDate: date(), // 'YYYY-MM-DD' — when you want to reach the target
    status: text({ enum: ['active', 'paused', 'completed'] }).notNull().default('active'),
    priority: integer().notNull().default(0), // lower = higher priority in list
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    householdIdx: index().on(t.householdId),
    statusIdx: index().on(t.householdId, t.status),
  }),
);

// ----- relations -----
export const accountsRelations = relations(accounts, ({ many, one }) => ({
  household: one(households, { fields: [accounts.householdId], references: [households.id] }),
  transactions: many(transactions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  household: one(households, { fields: [categories.householdId], references: [households.id] }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'children',
  }),
  children: many(categories, { relationName: 'children' }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  household: one(households, { fields: [transactions.householdId], references: [households.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
    relationName: 'txn_category',
  }),
  subCategory: one(categories, {
    fields: [transactions.subCategoryId],
    references: [categories.id],
    relationName: 'txn_sub_category',
  }),
  installmentPlan: one(installmentPlans, {
    fields: [transactions.installmentPlanId],
    references: [installmentPlans.id],
  }),
}));

export const installmentPlansRelations = relations(installmentPlans, ({ many, one }) => ({
  household: one(households, {
    fields: [installmentPlans.householdId],
    references: [households.id],
  }),
  account: one(accounts, { fields: [installmentPlans.accountId], references: [accounts.id] }),
  transactions: many(transactions),
}));
