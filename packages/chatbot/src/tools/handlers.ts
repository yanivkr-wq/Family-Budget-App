import { and, desc, eq, gte, ilike, isNull, lte, sql, inArray } from 'drizzle-orm';
import {
  type Database,
  schema,
  addMonths,
  currentBillingMonth,
  excludeHiddenProjectTxns,
} from '@fba/db';
import {
  queryTransactionsArgs,
  getCategorySummaryArgs,
  compareMonthsArgs,
  getRecurringPatternsArgs,
  getInstallmentPlansArgs,
  getAnomaliesArgs,
  findSubscriptionCandidatesArgs,
  searchMerchantsArgs,
} from './schemas';

// All handlers receive a household-scoped context. The agent layer enforces this —
// no handler accepts a raw householdId from the LLM; it's bound via closure.

export interface ToolContext {
  db: Database;
  householdId: string;
}

// Mask account names like "Bank Hapoalim — 1234" → "Account 1" for outbound LLM payloads.
function buildAccountMask(
  accounts: Array<{ id: string; name: string; accountNumberMasked: string | null }>,
): Map<string, string> {
  const mask = new Map<string, string>();
  accounts.forEach((acc, i) => mask.set(acc.id, `Account ${i + 1}`));
  return mask;
}

export async function queryTransactions(ctx: ToolContext, rawArgs: unknown) {
  const args = queryTransactionsArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const whereParts = [
    eq(schema.transactions.householdId, householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
    // Exclude txns tagged to a project hidden from monthly totals so the
    // chatbot doesn't surprise the user with a ₪200K construction
    // payment when they ask "what was my biggest expense this month?".
    excludeHiddenProjectTxns(),
  ];

  if (args.date_from) whereParts.push(gte(schema.transactions.transactionDate, args.date_from));
  if (args.date_to) whereParts.push(lte(schema.transactions.transactionDate, args.date_to));
  if (args.billing_month) whereParts.push(eq(schema.transactions.billingMonth, args.billing_month));
  if (args.category_ids?.length) {
    whereParts.push(inArray(schema.transactions.categoryId, args.category_ids));
  }
  if (args.sub_category_ids?.length) {
    whereParts.push(inArray(schema.transactions.subCategoryId, args.sub_category_ids));
  }
  if (args.account_ids?.length) {
    whereParts.push(inArray(schema.transactions.accountId, args.account_ids));
  }
  if (args.merchant_pattern) {
    whereParts.push(ilike(schema.transactions.merchantNormalized, `%${args.merchant_pattern}%`));
  }
  if (args.min_amount !== undefined) {
    whereParts.push(gte(schema.transactions.amountIls, String(args.min_amount)));
  }
  if (args.max_amount !== undefined) {
    whereParts.push(lte(schema.transactions.amountIls, String(args.max_amount)));
  }
  if (args.only_recurring) whereParts.push(eq(schema.transactions.isRecurring, true));
  if (args.only_installments) whereParts.push(eq(schema.transactions.isInstallment, true));

  const rows = await db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      billingMonth: schema.transactions.billingMonth,
      amount: schema.transactions.amountIls,
      merchant: schema.transactions.merchantNormalized,
      accountId: schema.transactions.accountId,
      categoryId: schema.transactions.categoryId,
      subCategoryId: schema.transactions.subCategoryId,
      isRecurring: schema.transactions.isRecurring,
      isInstallment: schema.transactions.isInstallment,
    })
    .from(schema.transactions)
    .where(and(...whereParts))
    .orderBy(desc(schema.transactions.transactionDate))
    .limit(args.limit);

  const accounts = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      accountNumberMasked: schema.accounts.accountNumberMasked,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, householdId));
  const mask = buildAccountMask(accounts);

  const categories = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(categories.map((c) => [c.id, c.nameHe]));

  return {
    transactions: rows.map((r) => ({
      id: r.id,
      date: r.date,
      billing_month: r.billingMonth,
      amount_ils: Number(r.amount),
      merchant: r.merchant,
      account: mask.get(r.accountId) ?? 'Unknown',
      category: r.categoryId ? catMap.get(r.categoryId) ?? null : null,
      sub_category: r.subCategoryId ? catMap.get(r.subCategoryId) ?? null : null,
      is_recurring: r.isRecurring,
      is_installment: r.isInstallment,
    })),
    count: rows.length,
    truncated: rows.length === args.limit,
  };
}

export async function getCategorySummary(ctx: ToolContext, rawArgs: unknown) {
  const args = getCategorySummaryArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const idCol = args.level === 'sub' ? schema.transactions.subCategoryId : schema.transactions.categoryId;

  const totals = await db
    .select({
      categoryId: idCol,
      total: sql<string>`sum(${schema.transactions.amountIls})`,
      count: sql<string>`count(*)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        eq(schema.transactions.billingMonth, args.month),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        excludeHiddenProjectTxns(),
      ),
    )
    .groupBy(idCol);

  const cats = await db
    .select({
      id: schema.categories.id,
      nameHe: schema.categories.nameHe,
      monthlyTargetIls: schema.categories.monthlyTargetIls,
      isIncome: schema.categories.isIncome,
    })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const result = totals
    .map((t) => {
      const cat = t.categoryId ? catMap.get(t.categoryId) : null;
      const total = Number(t.total);
      const target = cat?.monthlyTargetIls ? Number(cat.monthlyTargetIls) : null;
      const consumedPct = target && target > 0 ? Math.abs(total) / target : null;
      return {
        category_id: t.categoryId,
        category_name: cat?.nameHe ?? 'ללא קטגוריה',
        total_ils: total,
        count: Number(t.count),
        target_ils: target,
        consumed_pct: consumedPct,
        is_income: cat?.isIncome ?? false,
      };
    })
    .sort((a, b) => Math.abs(b.total_ils) - Math.abs(a.total_ils));

  const totalSpent = result.filter((r) => !r.is_income).reduce((sum, r) => sum + r.total_ils, 0);
  const totalIncome = result.filter((r) => r.is_income).reduce((sum, r) => sum + r.total_ils, 0);

  return {
    month: args.month,
    level: args.level,
    by_category: result,
    total_spent_ils: totalSpent,
    total_income_ils: totalIncome,
    net_ils: totalIncome + totalSpent, // expenses are already negative
  };
}

export async function compareMonths(ctx: ToolContext, rawArgs: unknown) {
  const args = compareMonthsArgs.parse(rawArgs);
  const a = await getCategorySummary(ctx, { month: args.month_a, level: 'category' });
  const b = await getCategorySummary(ctx, { month: args.month_b, level: 'category' });

  const byId = new Map<string | null, { a: number; b: number; name: string }>();
  for (const row of a.by_category) {
    byId.set(row.category_id, { a: row.total_ils, b: 0, name: row.category_name });
  }
  for (const row of b.by_category) {
    const existing = byId.get(row.category_id);
    if (existing) existing.b = row.total_ils;
    else byId.set(row.category_id, { a: 0, b: row.total_ils, name: row.category_name });
  }

  const deltas = Array.from(byId.entries())
    .map(([categoryId, { a: aa, b: bb, name }]) => ({
      category_id: categoryId,
      category_name: name,
      month_a_ils: aa,
      month_b_ils: bb,
      delta_ils: aa - bb,
      delta_pct: bb !== 0 ? (aa - bb) / Math.abs(bb) : null,
    }))
    .sort((x, y) => Math.abs(y.delta_ils) - Math.abs(x.delta_ils));

  return {
    month_a: args.month_a,
    month_b: args.month_b,
    total_a_ils: a.total_spent_ils,
    total_b_ils: b.total_spent_ils,
    total_delta_ils: a.total_spent_ils - b.total_spent_ils,
    by_category: deltas,
  };
}

export async function getRecurringPatterns(ctx: ToolContext, rawArgs: unknown) {
  const args = getRecurringPatternsArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const whereParts = [eq(schema.recurringPatterns.householdId, householdId)];
  if (args.status) whereParts.push(eq(schema.recurringPatterns.status, args.status));

  const rows = await db
    .select()
    .from(schema.recurringPatterns)
    .where(and(...whereParts))
    .orderBy(desc(schema.recurringPatterns.expectedAmountIls));

  const cats = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId));
  const catMap = new Map(cats.map((c) => [c.id, c.nameHe]));

  return {
    patterns: rows.map((r) => ({
      merchant: r.merchantNormalized,
      category: r.categoryId ? catMap.get(r.categoryId) ?? null : null,
      expected_amount_ils: Number(r.expectedAmountIls),
      tolerance_pct: r.tolerancePct,
      frequency: r.frequency,
      occurrences: r.occurrenceCount,
      first_seen_month: r.firstSeenMonth,
      last_seen_month: r.lastSeenMonth,
      status: r.status,
    })),
    count: rows.length,
  };
}

export async function getInstallmentPlans(ctx: ToolContext, rawArgs: unknown) {
  const args = getInstallmentPlansArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const whereParts = [eq(schema.installmentPlans.householdId, householdId)];
  if (args.status) whereParts.push(eq(schema.installmentPlans.status, args.status));

  const rows = await db
    .select()
    .from(schema.installmentPlans)
    .where(and(...whereParts))
    .orderBy(desc(schema.installmentPlans.startMonth));

  return {
    plans: rows.map((r) => ({
      id: r.id,
      merchant: r.merchantNormalized,
      description: r.description,
      payment_amount_ils: Number(r.paymentAmountIls),
      total_payments: r.totalPayments,
      current_payment_no: r.currentPaymentNo,
      remaining_payments: r.totalPayments ? r.totalPayments - r.currentPaymentNo : null,
      start_month: r.startMonth,
      projected_end_month: r.projectedEndMonth,
      actual_end_month: r.actualEndMonth,
      status: r.status,
    })),
    count: rows.length,
  };
}

export async function getAnomalies(ctx: ToolContext, rawArgs: unknown) {
  const args = getAnomaliesArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const whereParts = [eq(schema.anomalies.householdId, householdId)];

  const rows = await db
    .select()
    .from(schema.anomalies)
    .where(and(...whereParts))
    .orderBy(desc(schema.anomalies.createdAt))
    .limit(50);

  const filtered = rows.filter((r) => {
    if (args.date_from && r.createdAt < new Date(args.date_from)) return false;
    if (args.date_to && r.createdAt > new Date(args.date_to)) return false;
    return true;
  });

  return {
    anomalies: filtered.map((a) => ({
      id: a.id,
      year_month: a.yearMonth,
      kind: a.kind,
      severity: a.severity,
      summary: a.summaryHe,
      detail: a.detailJson,
      acknowledged: !!a.acknowledgedAt,
      created_at: a.createdAt.toISOString(),
    })),
    count: filtered.length,
  };
}

export async function getPredictedBalance(ctx: ToolContext, _rawArgs: unknown) {
  const { db, householdId } = ctx;
  const month = currentBillingMonth();

  const monthSummary = await getCategorySummary(ctx, { month, level: 'category' });

  const installments = await db
    .select({
      paymentAmount: schema.installmentPlans.paymentAmountIls,
      totalPayments: schema.installmentPlans.totalPayments,
      currentPaymentNo: schema.installmentPlans.currentPaymentNo,
    })
    .from(schema.installmentPlans)
    .where(
      and(
        eq(schema.installmentPlans.householdId, householdId),
        eq(schema.installmentPlans.status, 'active'),
      ),
    );

  const recurring = await db
    .select({
      expectedAmount: schema.recurringPatterns.expectedAmountIls,
    })
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.status, 'active'),
      ),
    );

  const recurringTotal = recurring.reduce((s, r) => s - Math.abs(Number(r.expectedAmount)), 0);
  const installmentTotal = installments.reduce(
    (s, p) => s - Math.abs(Number(p.paymentAmount)),
    0,
  );

  // Variable projection: assume the rest of the month spends at the same daily rate.
  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const variableSoFar = monthSummary.total_spent_ils - recurringTotal - installmentTotal;
  const variableProjected = dayOfMonth > 0 ? (variableSoFar / dayOfMonth) * daysLeft : 0;

  return {
    month,
    spent_so_far_ils: monthSummary.total_spent_ils,
    income_so_far_ils: monthSummary.total_income_ils,
    recurring_remaining_ils: recurringTotal,
    installments_remaining_ils: installmentTotal,
    variable_projected_remaining_ils: variableProjected,
    predicted_eom_net_ils:
      monthSummary.net_ils + recurringTotal + installmentTotal + variableProjected,
    days_left: daysLeft,
  };
}

export async function findSubscriptionCandidates(ctx: ToolContext, rawArgs: unknown) {
  const args = findSubscriptionCandidatesArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const rows = await db
    .select()
    .from(schema.recurringPatterns)
    .where(
      and(
        eq(schema.recurringPatterns.householdId, householdId),
        eq(schema.recurringPatterns.frequency, 'monthly'),
        eq(schema.recurringPatterns.status, 'active'),
        lte(schema.recurringPatterns.expectedAmountIls, String(args.max_monthly_amount)),
      ),
    )
    .orderBy(desc(schema.recurringPatterns.expectedAmountIls));

  return {
    candidates: rows.map((r) => ({
      merchant: r.merchantNormalized,
      monthly_amount_ils: Number(r.expectedAmountIls),
      occurrences: r.occurrenceCount,
      last_seen_month: r.lastSeenMonth,
    })),
    annual_cost_if_all_kept_ils: rows.reduce((s, r) => s + Number(r.expectedAmountIls) * 12, 0),
    count: rows.length,
  };
}

export async function searchMerchants(ctx: ToolContext, rawArgs: unknown) {
  const args = searchMerchantsArgs.parse(rawArgs);
  const { db, householdId } = ctx;

  const rows = await db
    .select({
      merchant: schema.transactions.merchantNormalized,
      total: sql<string>`sum(${schema.transactions.amountIls})`,
      count: sql<string>`count(*)`,
      lastDate: sql<string>`max(${schema.transactions.transactionDate})`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        ilike(schema.transactions.merchantNormalized, `%${args.query.toLowerCase()}%`),
        isNull(schema.transactions.deletedAt),
        eq(schema.transactions.isProjected, false),
        excludeHiddenProjectTxns(),
      ),
    )
    .groupBy(schema.transactions.merchantNormalized)
    .orderBy(desc(sql`count(*)`))
    .limit(args.limit);

  return {
    merchants: rows.map((r) => ({
      merchant: r.merchant,
      total_ils: Number(r.total),
      transaction_count: Number(r.count),
      last_date: r.lastDate,
    })),
    count: rows.length,
  };
}

export const TOOL_HANDLERS: Record<
  string,
  (ctx: ToolContext, args: unknown) => Promise<unknown>
> = {
  query_transactions: queryTransactions,
  get_category_summary: getCategorySummary,
  compare_months: compareMonths,
  get_recurring_patterns: getRecurringPatterns,
  get_installment_plans: getInstallmentPlans,
  get_anomalies: getAnomalies,
  get_predicted_balance: getPredictedBalance,
  find_subscription_candidates: findSubscriptionCandidates,
  search_merchants: searchMerchants,
};

// Re-export so callers can import { addMonths } via @fba/chatbot/tools.
export { addMonths };
