'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql, inArray, ilike, isNull } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth } from '@/lib/auth';
import { applyRules, sortRules } from '@fba/categorizer';

export interface RuleSuggestion {
  rule: {
    id: string;
    name: string | null;
    pattern: string;
    matchType: string;
    categoryId: string;
    subCategoryId: string | null;
    minAmountIls: number | null;
    maxAmountIls: number | null;
  };
  /** How well this rule matches the transaction. */
  matchType: 'exact_match' | 'partial_match' | 'same_category' | 'same_merchant_other_cat';
  /** Human-readable Hebrew explanation of the match. */
  reason: string;
  /** Resolved category names for display. */
  categoryName: string;
  subCategoryName: string | null;
}

/** Given a transaction, return existing rules that could be applied to it, ordered by relevance. */
export async function findRuleSuggestions(transactionId: string): Promise<{
  matches: RuleSuggestion[];
  similar: RuleSuggestion[];
  transaction: {
    id: string;
    merchant: string;
    merchantNormalized: string;
    amount: number;
    accountId: string;
    currentCategoryId: string | null;
    currentCategoryName: string | null;
  } | null;
}> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  const db = getDb();

  const [txn] = await db
    .select({
      id: schema.transactions.id,
      merchant: schema.transactions.merchantRaw,
      merchantNormalized: schema.transactions.merchantNormalized,
      amount: schema.transactions.amountIls,
      accountId: schema.transactions.accountId,
      categoryId: schema.transactions.categoryId,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        eq(schema.transactions.householdId, session.user.householdId),
      ),
    )
    .limit(1);
  if (!txn) return { matches: [], similar: [], transaction: null };

  const rules = await db
    .select()
    .from(schema.categoryRules)
    .where(
      and(
        eq(schema.categoryRules.householdId, session.user.householdId),
        eq(schema.categoryRules.isActive, true),
      ),
    );

  const cats = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, session.user.householdId));
  const catNameById = new Map(cats.map((c) => [c.id, c.nameHe]));

  const amountAbs = Math.abs(Number(txn.amount));

  // Run the categorizer's matchRule logic to find rules that ACTUALLY match this txn
  const matchResult = applyRules(rules as any, {
    merchantNormalized: txn.merchantNormalized,
    merchantRaw: txn.merchant,
    accountId: txn.accountId,
    amountAbs,
  });

  const matches: RuleSuggestion[] = [];
  const similar: RuleSuggestion[] = [];
  const matchedRuleIds = new Set<string>(matchResult ? [matchResult.rule.id] : []);

  if (matchResult) {
    matches.push({
      rule: ruleToView(matchResult.rule),
      matchType: 'exact_match',
      reason: `דפוס "${matchResult.rule.pattern}" תואם לבית העסק`,
      categoryName: catNameById.get(matchResult.categoryId) ?? '?',
      subCategoryName: matchResult.subCategoryId ? catNameById.get(matchResult.subCategoryId) ?? null : null,
    });
  }

  // Find rules that PARTIALLY match (pattern is a substring of merchant or vice-versa,
  // ignoring amount conditions)
  for (const r of sortRules(rules as any)) {
    if (matchedRuleIds.has(r.id)) continue;
    const lcPattern = r.pattern.toLowerCase();
    const lcMerchant = txn.merchantNormalized.toLowerCase();

    const patternInMerchant = lcMerchant.includes(lcPattern);
    const merchantInPattern = lcPattern.includes(lcMerchant);

    if (patternInMerchant || merchantInPattern) {
      matches.push({
        rule: ruleToView(r),
        matchType: 'partial_match',
        reason: patternInMerchant
          ? `דפוס "${r.pattern}" מופיע בשם בית העסק (אבל לא עומד בכל התנאים)`
          : `שם בית העסק קצר יותר מהדפוס`,
        categoryName: catNameById.get(r.categoryId) ?? '?',
        subCategoryName: r.subCategoryId ? catNameById.get(r.subCategoryId) ?? null : null,
      });
      matchedRuleIds.add(r.id);
    }
  }

  // Suggest rules for the same category as the transaction (if categorized)
  if (txn.categoryId) {
    for (const r of rules) {
      if (matchedRuleIds.has(r.id)) continue;
      if (r.categoryId === txn.categoryId) {
        similar.push({
          rule: ruleToView(r),
          matchType: 'same_category',
          reason: `כלל אחר באותה קטגוריה`,
          categoryName: catNameById.get(r.categoryId) ?? '?',
          subCategoryName: r.subCategoryId ? catNameById.get(r.subCategoryId) ?? null : null,
        });
        matchedRuleIds.add(r.id);
        if (similar.length >= 5) break;
      }
    }
  }

  const txView = {
    id: txn.id,
    merchant: txn.merchant,
    merchantNormalized: txn.merchantNormalized,
    amount: Number(txn.amount),
    accountId: txn.accountId,
    currentCategoryId: txn.categoryId,
    currentCategoryName: txn.categoryId ? catNameById.get(txn.categoryId) ?? null : null,
  };

  return { matches, similar, transaction: txView };
}

function ruleToView(r: typeof schema.categoryRules.$inferSelect): RuleSuggestion['rule'] {
  return {
    id: r.id,
    name: r.name,
    pattern: r.pattern,
    matchType: r.matchType,
    categoryId: r.categoryId,
    subCategoryId: r.subCategoryId,
    minAmountIls: r.minAmountIls ? Number(r.minAmountIls) : null,
    maxAmountIls: r.maxAmountIls ? Number(r.maxAmountIls) : null,
  };
}

/**
 * Apply a rule's category to a single transaction. Doesn't change the rule. Doesn't
 * affect other transactions. Use this when the user wants "this rule applies to this
 * one row" — common one-off correction.
 */
export async function applyRuleToOneTransaction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const db = getDb();

  const transactionId = String(formData.get('transactionId') ?? '');
  const ruleId = String(formData.get('ruleId') ?? '');
  if (!transactionId || !ruleId) return { ok: false, error: 'Missing ids' };

  const [rule] = await db
    .select()
    .from(schema.categoryRules)
    .where(
      and(
        eq(schema.categoryRules.id, ruleId),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    )
    .limit(1);
  if (!rule) return { ok: false, error: 'Rule not found' };

  await db
    .update(schema.transactions)
    .set({
      categoryId: rule.categoryId,
      subCategoryId: rule.subCategoryId,
      appliedRuleId: ruleId,
      categorySource: 'rule',
    })
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        eq(schema.transactions.householdId, session.user.householdId),
      ),
    );

  // Bump the rule's applied counter
  await db
    .update(schema.categoryRules)
    .set({
      timesApplied: sql`${schema.categoryRules.timesApplied} + 1`,
      lastAppliedAt: new Date(),
    })
    .where(eq(schema.categoryRules.id, ruleId));

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'apply_rule',
    entityType: 'transaction',
    entityId: transactionId,
    afterJson: { ruleId, categoryId: rule.categoryId, subCategoryId: rule.subCategoryId } as object,
  });

  revalidatePath('/transactions');
  return { ok: true };
}

/** One-time category override on a single transaction (no rule involved). */
export async function setTransactionCategory(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const db = getDb();

  const transactionId = String(formData.get('transactionId') ?? '');
  const categoryId = (formData.get('categoryId') as string) || null;
  const subCategoryId = (formData.get('subCategoryId') as string) || null;
  if (!transactionId) return { ok: false, error: 'Missing transactionId' };

  await db
    .update(schema.transactions)
    .set({ categoryId, subCategoryId, appliedRuleId: null, categorySource: 'manual' })
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        eq(schema.transactions.householdId, session.user.householdId),
      ),
    );

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'set_category',
    entityType: 'transaction',
    entityId: transactionId,
    afterJson: { categoryId, subCategoryId } as object,
  });

  revalidatePath('/transactions');
  return { ok: true };
}

/** Create a brand-new rule from a specific transaction's data (pre-filled). */
export async function createRuleFromTransaction(formData: FormData): Promise<{ ok: boolean; ruleId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const db = getDb();

  const transactionId = String(formData.get('transactionId') ?? '');
  const pattern = String(formData.get('pattern') ?? '').trim();
  const matchType = String(formData.get('matchType') ?? 'contains') as 'contains' | 'exact' | 'starts_with' | 'regex';
  const categoryId = String(formData.get('categoryId') ?? '');
  const subCategoryId = (formData.get('subCategoryId') as string) || null;
  const minAmount = formData.get('minAmountIls') ? Number(formData.get('minAmountIls')) : null;
  const maxAmount = formData.get('maxAmountIls') ? Number(formData.get('maxAmountIls')) : null;
  const scopeToAccount = formData.get('scopeToAccount') === 'true';
  const applyToPast = formData.get('applyToPast') === 'true';

  if (!pattern) return { ok: false, error: 'Pattern required' };
  if (!categoryId) return { ok: false, error: 'Category required' };

  // If scoped to account, look up the txn's account
  let appliesToAccountId: string | null = null;
  if (scopeToAccount && transactionId) {
    const [txn] = await db
      .select({ accountId: schema.transactions.accountId })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.householdId, session.user.householdId),
        ),
      )
      .limit(1);
    if (txn) appliesToAccountId = txn.accountId;
  }

  const [created] = await db
    .insert(schema.categoryRules)
    .values({
      householdId: session.user.householdId,
      name: `${pattern} → קטגוריזציה`,
      pattern,
      matchType,
      categoryId,
      subCategoryId,
      appliesToAccountId,
      minAmountIls: minAmount !== null ? String(minAmount) : null,
      maxAmountIls: maxAmount !== null ? String(maxAmount) : null,
      source: 'user',
      isActive: true,
      confirmedAt: new Date(),
    })
    .returning();

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'create_from_transaction',
    entityType: 'category_rule',
    entityId: created!.id,
    afterJson: { transactionId, pattern, categoryId, subCategoryId } as object,
  });

  // Always apply to the source transaction
  if (transactionId) {
    await db
      .update(schema.transactions)
      .set({ categoryId, subCategoryId })
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.householdId, session.user.householdId),
        ),
      );
  }

  // Optional backfill — apply to all matching past transactions
  if (applyToPast) {
    const conds = [
      eq(schema.transactions.householdId, session.user.householdId),
      isNull(schema.transactions.deletedAt),
    ];
    const lcPattern = pattern.toLowerCase();
    if (matchType === 'contains') conds.push(ilike(schema.transactions.merchantNormalized, `%${lcPattern}%`));
    else if (matchType === 'starts_with') conds.push(ilike(schema.transactions.merchantNormalized, `${lcPattern}%`));
    else if (matchType === 'exact') conds.push(eq(schema.transactions.merchantNormalized, lcPattern));
    else if (matchType === 'regex') conds.push(sql`${schema.transactions.merchantRaw} ~* ${pattern}`);
    if (appliesToAccountId) conds.push(eq(schema.transactions.accountId, appliesToAccountId));
    if (minAmount !== null) conds.push(sql`abs(${schema.transactions.amountIls}::numeric) >= ${minAmount}`);
    if (maxAmount !== null) conds.push(sql`abs(${schema.transactions.amountIls}::numeric) <= ${maxAmount}`);

    const r = await db
      .update(schema.transactions)
      .set({ categoryId, subCategoryId })
      .where(and(...conds))
      .returning({ id: schema.transactions.id });

    await db
      .update(schema.categoryRules)
      .set({ timesApplied: r.length, lastAppliedAt: new Date() })
      .where(eq(schema.categoryRules.id, created!.id));
  }

  revalidatePath('/transactions');
  revalidatePath('/admin/rules');
  return { ok: true, ruleId: created!.id };
}

/** Bulk apply a rule to multiple transactions at once. */
export async function bulkApplyRule(formData: FormData): Promise<{ ok: boolean; updated: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, updated: 0 };
  const db = getDb();

  const ruleId = String(formData.get('ruleId') ?? '');
  const ids = (formData.getAll('transactionIds') as string[]).filter(Boolean);
  if (!ruleId || ids.length === 0) return { ok: false, updated: 0 };

  const [rule] = await db
    .select()
    .from(schema.categoryRules)
    .where(
      and(
        eq(schema.categoryRules.id, ruleId),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    )
    .limit(1);
  if (!rule) return { ok: false, updated: 0 };

  const updated = await db
    .update(schema.transactions)
    .set({
      categoryId: rule.categoryId,
      subCategoryId: rule.subCategoryId,
      appliedRuleId: ruleId,
      categorySource: 'rule',
    })
    .where(
      and(
        eq(schema.transactions.householdId, session.user.householdId),
        inArray(schema.transactions.id, ids),
      ),
    )
    .returning({ id: schema.transactions.id });

  await db
    .update(schema.categoryRules)
    .set({
      timesApplied: sql`${schema.categoryRules.timesApplied} + ${updated.length}`,
      lastAppliedAt: new Date(),
    })
    .where(eq(schema.categoryRules.id, ruleId));

  revalidatePath('/transactions');
  return { ok: true, updated: updated.length };
}

/** Bulk manually set a category on multiple transactions (clears any rule attribution). */
export async function bulkSetCategory(formData: FormData): Promise<{ ok: boolean; updated: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, updated: 0 };
  const db = getDb();

  const categoryId = (formData.get('categoryId') as string) || null;
  const subCategoryId = (formData.get('subCategoryId') as string) || null;
  const ids = (formData.getAll('transactionIds') as string[]).filter(Boolean);
  if (ids.length === 0) return { ok: true, updated: 0 };

  const updated = await db
    .update(schema.transactions)
    .set({
      categoryId,
      subCategoryId,
      appliedRuleId: null,
      categorySource: categoryId ? 'manual' : null,
    })
    .where(
      and(
        eq(schema.transactions.householdId, session.user.householdId),
        inArray(schema.transactions.id, ids),
      ),
    )
    .returning({ id: schema.transactions.id });

  revalidatePath('/transactions');
  return { ok: true, updated: updated.length };
}

/** Bulk soft-delete multiple transactions at once. */
export async function bulkDeleteTransactions(formData: FormData): Promise<{ ok: boolean; deleted: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, deleted: 0 };
  const db = getDb();

  const ids = (formData.getAll('transactionIds') as string[]).filter(Boolean);
  if (ids.length === 0) return { ok: true, deleted: 0 };

  const r = await db
    .update(schema.transactions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.transactions.householdId, session.user.householdId),
        inArray(schema.transactions.id, ids),
        isNull(schema.transactions.deletedAt),
      ),
    )
    .returning({ id: schema.transactions.id });

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'bulk_delete',
    entityType: 'transaction',
    afterJson: { ids: r.map((x) => x.id) } as object,
  });

  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/grid');
  return { ok: true, deleted: r.length };
}
