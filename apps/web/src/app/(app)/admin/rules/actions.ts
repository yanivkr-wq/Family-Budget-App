'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ilike, isNull, or, sql, inArray, type SQL } from 'drizzle-orm';
import { getDb, schema, normalizeMerchant } from '@fba/db';
import { auth } from '@/lib/auth';

interface RuleFormInput {
  id?: string;
  name?: string;
  description?: string;
  matchType: 'contains' | 'regex' | 'exact' | 'starts_with';
  pattern: string;
  /** Optional AND-condition: notes field must also match this pattern */
  notesPattern?: string | null;
  notesMatchType?: string | null;
  appliesToAccountId?: string | null;
  minAmountIls?: number | null;
  maxAmountIls?: number | null;
  categoryId: string;
  subCategoryId?: string | null;
  priority?: number;
  isActive?: boolean;
  /** When true, the merchant matched by this rule is ALSO registered as a
   *  recurring expense (or income) → shows up on /recurring and gets the
   *  קבוע badge in transactions. */
  markAsRecurring?: boolean;
  recurringExpectedAmount?: number | null;
  recurringFrequency?: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  recurringSign?: 'expense' | 'income';
  /** Human-readable label for the recurring expense (e.g., "Spotify Family",
   *  "השכרת דירה"). Stored alongside the merchant on /recurring. */
  recurringDescription?: string | null;
}

function parseForm(formData: FormData): RuleFormInput {
  const numOrNull = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: (formData.get('id') as string) || undefined,
    name: (formData.get('name') as string)?.trim() || undefined,
    description: (formData.get('description') as string)?.trim() || undefined,
    matchType: (formData.get('matchType') as RuleFormInput['matchType']) || 'contains',
    pattern: String(formData.get('pattern') ?? '').trim(),
    notesPattern: (formData.get('notesPattern') as string)?.trim() || null,
    notesMatchType: (formData.get('notesMatchType') as string) || 'contains',
    appliesToAccountId: (formData.get('appliesToAccountId') as string) || null,
    minAmountIls: numOrNull(formData.get('minAmountIls')),
    maxAmountIls: numOrNull(formData.get('maxAmountIls')),
    categoryId: String(formData.get('categoryId') ?? ''),
    subCategoryId: (formData.get('subCategoryId') as string) || null,
    priority: Number(formData.get('priority') ?? 100),
    isActive: formData.get('isActive') !== 'false',
    markAsRecurring: formData.get('markAsRecurring') === 'true',
    recurringExpectedAmount: numOrNull(formData.get('recurringExpectedAmount')),
    recurringFrequency: (formData.get('recurringFrequency') as RuleFormInput['recurringFrequency']) || 'monthly',
    recurringSign: (formData.get('recurringSign') as RuleFormInput['recurringSign']) || 'expense',
    recurringDescription: ((formData.get('recurringDescription') as string | null) ?? '').trim() || null,
  };
}

/**
 * Materialize a recurring expense (or income) pattern from a category-rule
 * input. Returns the count of recurring rows created.
 *
 * Strategy:
 *   • For `exact` rules → one row, merchantNormalized = rule.pattern (normalized).
 *   • For `contains` / `starts_with` / `regex` rules → query the matching
 *     transactions and create one recurring pattern PER distinct
 *     merchantNormalized found. This way "Spotify Israel Ltd" and
 *     "Spotify P10202" both get tagged קבוע by the existing recurring-join
 *     in /transactions even though they share one rule.
 *   • If no transactions yet match (fresh rule before any import) → fall
 *     back to one row using normalizeMerchant(pattern) so future imports
 *     of an EXACT-matching merchant get the badge.
 *
 * Uses ON CONFLICT DO NOTHING on the unique(householdId, merchantNormalized)
 * index so re-saves don't error and existing manual entries aren't
 * clobbered.
 */
async function createRecurringFromRule(
  db: ReturnType<typeof getDb>,
  householdId: string,
  rule: { pattern: string; matchType: string; categoryId: string },
  recurring: {
    expectedAmount: number | null;
    frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
    sign: 'expense' | 'income';
    description: string | null;
  },
): Promise<number> {
  const amount = Math.max(Number(recurring.expectedAmount ?? 0), 0);
  const signedAmount = recurring.sign === 'income' ? amount : -amount;
  const month = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  // Decide which merchantNormalized values to materialize.
  let merchantList: string[] = [];

  if (rule.matchType === 'exact') {
    // For exact-match rules with multiple parts (e.g., "spotify|netflix"),
    // materialize each part as its own recurring entry.
    merchantList = splitPatternParts(rule.pattern).map((p) => normalizeMerchant(p));
    if (merchantList.length === 0) merchantList = [normalizeMerchant(rule.pattern)];
  } else {
    // Pull distinct merchantNormalized values from existing matching txns.
    // Using the same predicates as the rules engine for consistency
    // (including pipe-separated multi-pattern support).
    const conditions = [
      eq(schema.transactions.householdId, householdId),
      isNull(schema.transactions.deletedAt),
    ];
    const patternCond = buildMerchantPatternCondition(rule.pattern, rule.matchType as 'contains' | 'starts_with' | 'exact' | 'regex');
    if (patternCond) conditions.push(patternCond);
    const rows = await db
      .selectDistinct({ m: schema.transactions.merchantNormalized })
      .from(schema.transactions)
      .where(and(...conditions))
      .limit(50); // cap — we don't want to spam /recurring with hundreds of rows
    merchantList = rows.map((r) => r.m).filter(Boolean);

    // Fallback if nothing matched (fresh rule pre-import)
    if (merchantList.length === 0) {
      merchantList = [normalizeMerchant(rule.pattern)];
    }
  }

  // Insert each one. Unique constraint takes care of dedup.
  let created = 0;
  for (const merchant of merchantList) {
    if (!merchant) continue;
    const result = await db.insert(schema.recurringPatterns).values({
      householdId,
      merchantNormalized: merchant,
      ...(recurring.description ? { description: recurring.description } : {}),
      categoryId:         rule.categoryId,
      expectedAmountIls:  String(signedAmount),
      medianAmountIls:    String(signedAmount),
      tolerancePct:       10,
      frequency:          recurring.frequency,
      occurrenceCount:    0,
      firstSeenMonth:     month,
      lastSeenMonth:      month,
      status:             'active',
    }).onConflictDoNothing().returning({ id: schema.recurringPatterns.id });
    if (result.length > 0) created++;
  }
  return created;
}

/**
 * Split a pipe-separated pattern into trimmed lowercase parts. Empty parts
 * are filtered out. Used by the multi-pattern matcher so `applyRules` and
 * the SQL preview/backfill paths agree on what a rule like
 * "חניה|חניון|חניוני" actually matches.
 */
function splitPatternParts(pattern: string): string[] {
  return pattern
    .split('|')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Build a SQL OR condition that matches when any of the pipe-separated
 * pattern parts hits, using the same matchType semantics as the engine.
 * Falls back to the single-pattern path when there's only one part.
 */
function buildMerchantPatternCondition(
  pattern: string,
  matchType: 'contains' | 'starts_with' | 'exact' | 'regex',
): SQL | undefined {
  if (matchType === 'regex') {
    return sql`${schema.transactions.merchantRaw} ~* ${pattern}`;
  }
  const parts = splitPatternParts(pattern);
  if (parts.length === 0) return undefined;
  const perPart = parts.map((p): SQL => {
    if (matchType === 'starts_with') return ilike(schema.transactions.merchantNormalized, `${p}%`);
    if (matchType === 'exact')       return eq(schema.transactions.merchantNormalized, p);
    return ilike(schema.transactions.merchantNormalized, `%${p}%`);
  });
  if (perPart.length === 1) return perPart[0]!;
  return or(...perPart);
}

/** Build a Drizzle SQL condition for a notes-pattern match. Returns null if no pattern set. */
function buildNotesCondition(
  notesPattern: string | null | undefined,
  notesMatchType: string | null | undefined,
) {
  if (!notesPattern) return null;
  const lc = notesPattern.toLowerCase();
  const mt = notesMatchType ?? 'contains';
  if (mt === 'contains') return ilike(schema.transactions.notes, `%${lc}%`);
  if (mt === 'starts_with') return ilike(schema.transactions.notes, `${lc}%`);
  if (mt === 'exact') return ilike(schema.transactions.notes, lc);
  if (mt === 'regex') return sql`${schema.transactions.notes} ~* ${notesPattern}`;
  return null;
}

export interface RulePreview {
  /** How many existing transactions this rule WOULD match */
  matchCount: number;
  /** Of those, how many already have the same category (no change) vs would change */
  alreadyMatching: number;
  wouldChange: number;
  sampleMatches: Array<{ id: string; date: string; merchant: string; amount: number; currentCategory: string | null }>;
}

/** Show the user how many transactions this rule would affect, before they save it. */
export async function previewRule(formData: FormData): Promise<RulePreview> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  const db = getDb();
  const r = parseForm(formData);

  if (!r.pattern || !r.categoryId) {
    return { matchCount: 0, alreadyMatching: 0, wouldChange: 0, sampleMatches: [] };
  }

  const conditions = [
    eq(schema.transactions.householdId, session.user.householdId),
    isNull(schema.transactions.deletedAt),
    eq(schema.transactions.isProjected, false),
  ];

  // Pattern match (supports pipe-separated multi-patterns)
  const patternCond = buildMerchantPatternCondition(r.pattern, r.matchType);
  if (patternCond) conditions.push(patternCond);

  if (r.appliesToAccountId) {
    conditions.push(eq(schema.transactions.accountId, r.appliesToAccountId));
  }

  if (r.minAmountIls !== null) {
    conditions.push(sql`abs(${schema.transactions.amountIls}::numeric) >= ${r.minAmountIls}`);
  }
  if (r.maxAmountIls !== null) {
    conditions.push(sql`abs(${schema.transactions.amountIls}::numeric) <= ${r.maxAmountIls}`);
  }

  const notesCond = buildNotesCondition(r.notesPattern, r.notesMatchType);
  if (notesCond) conditions.push(notesCond);

  const rows = await db
    .select({
      id: schema.transactions.id,
      date: schema.transactions.transactionDate,
      merchant: schema.transactions.merchantRaw,
      amount: schema.transactions.amountIls,
      currentCategoryId: schema.transactions.categoryId,
    })
    .from(schema.transactions)
    .where(and(...conditions))
    .limit(500);

  const cats = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, session.user.householdId));
  const catNameById = new Map(cats.map((c) => [c.id, c.nameHe]));

  const alreadyMatching = rows.filter((row) => row.currentCategoryId === r.categoryId).length;
  return {
    matchCount: rows.length,
    alreadyMatching,
    wouldChange: rows.length - alreadyMatching,
    sampleMatches: rows.slice(0, 8).map((row) => ({
      id: row.id,
      date: row.date,
      merchant: row.merchant,
      amount: Number(row.amount),
      currentCategory: row.currentCategoryId ? catNameById.get(row.currentCategoryId) ?? null : null,
    })),
  };
}

export async function createRule(formData: FormData): Promise<{ ok: boolean; ruleId?: string; error?: string; recurringCreated?: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const db = getDb();
  const r = parseForm(formData);
  const applyToPast = formData.get('applyToPast') === 'true';

  if (!r.pattern) return { ok: false, error: 'דפוס חיפוש לא יכול להיות ריק' };
  if (!r.categoryId) return { ok: false, error: 'יש לבחור קטגוריה' };

  const [created] = await db
    .insert(schema.categoryRules)
    .values({
      householdId: session.user.householdId,
      name: r.name ?? r.pattern,
      description: r.description,
      priority: r.priority ?? 100,
      matchType: r.matchType,
      pattern: r.pattern,
      notesPattern: r.notesPattern,
      notesMatchType: r.notesPattern ? (r.notesMatchType ?? 'contains') : null,
      appliesToAccountId: r.appliesToAccountId,
      minAmountIls: r.minAmountIls !== null ? String(r.minAmountIls) : null,
      maxAmountIls: r.maxAmountIls !== null ? String(r.maxAmountIls) : null,
      categoryId: r.categoryId,
      subCategoryId: r.subCategoryId,
      source: 'user',
      isActive: r.isActive !== false,
      confirmedAt: new Date(),
    })
    .returning();

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'create',
    entityType: 'category_rule',
    entityId: created!.id,
    afterJson: created as object,
  });

  // Optionally backfill: apply this rule to existing matching transactions
  if (applyToPast) {
    await applyRuleToPastTransactions(created!.id);
  }

  // Optionally also register the matching merchant(s) as recurring expenses
  let recurringCreated = 0;
  if (r.markAsRecurring) {
    recurringCreated = await createRecurringFromRule(
      db,
      session.user.householdId,
      { pattern: r.pattern, matchType: r.matchType, categoryId: r.categoryId },
      {
        expectedAmount: r.recurringExpectedAmount ?? 0,
        frequency: r.recurringFrequency ?? 'monthly',
        sign: r.recurringSign ?? 'expense',
        description: r.recurringDescription ?? null,
      },
    );
    revalidatePath('/recurring');
  }

  revalidatePath('/admin/rules');
  revalidatePath('/transactions');
  return { ok: true, ruleId: created!.id, recurringCreated };
}

export async function updateRule(formData: FormData): Promise<{ ok: boolean; error?: string; recurringCreated?: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };
  const db = getDb();
  const r = parseForm(formData);
  if (!r.id) return { ok: false, error: 'missing id' };

  await db
    .update(schema.categoryRules)
    .set({
      name: r.name,
      description: r.description,
      priority: r.priority ?? 100,
      matchType: r.matchType,
      pattern: r.pattern,
      notesPattern: r.notesPattern ?? null,
      notesMatchType: r.notesPattern ? (r.notesMatchType ?? 'contains') : null,
      appliesToAccountId: r.appliesToAccountId,
      minAmountIls: r.minAmountIls !== null ? String(r.minAmountIls) : null,
      maxAmountIls: r.maxAmountIls !== null ? String(r.maxAmountIls) : null,
      categoryId: r.categoryId,
      subCategoryId: r.subCategoryId,
      isActive: r.isActive !== false,
    })
    .where(
      and(
        eq(schema.categoryRules.id, r.id),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    );

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'update',
    entityType: 'category_rule',
    entityId: r.id,
  });

  // If the user re-checked "סמן כקבוע" on edit, materialize the recurring
  // pattern(s). ON CONFLICT DO NOTHING means existing entries aren't
  // touched — only new merchants are added.
  let recurringCreated = 0;
  if (r.markAsRecurring) {
    recurringCreated = await createRecurringFromRule(
      db,
      session.user.householdId,
      { pattern: r.pattern, matchType: r.matchType, categoryId: r.categoryId },
      {
        expectedAmount: r.recurringExpectedAmount ?? 0,
        frequency: r.recurringFrequency ?? 'monthly',
        sign: r.recurringSign ?? 'expense',
        description: r.recurringDescription ?? null,
      },
    );
    revalidatePath('/recurring');
  }

  revalidatePath('/admin/rules');
  return { ok: true, recurringCreated };
}

export async function deleteRule(formData: FormData): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false };
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false };

  await db
    .delete(schema.categoryRules)
    .where(
      and(
        eq(schema.categoryRules.id, id),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    );

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'delete',
    entityType: 'category_rule',
    entityId: id,
  });

  revalidatePath('/admin/rules');
  return { ok: true };
}

export async function bulkDeleteRules(formData: FormData): Promise<{ ok: boolean; deleted: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, deleted: 0 };
  const ids = (formData.getAll('ids') as string[]).filter(Boolean);
  if (ids.length === 0) return { ok: true, deleted: 0 };

  const db = getDb();
  const r = await db
    .delete(schema.categoryRules)
    .where(
      and(
        inArray(schema.categoryRules.id, ids),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    )
    .returning({ id: schema.categoryRules.id });

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'bulk_delete',
    entityType: 'category_rule',
    afterJson: { ids: r.map((x) => x.id) } as object,
  });

  revalidatePath('/admin/rules');
  return { ok: true, deleted: r.length };
}

export async function bulkToggleRules(formData: FormData): Promise<{ ok: boolean; updated: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, updated: 0 };
  const ids = (formData.getAll('ids') as string[]).filter(Boolean);
  const enable = formData.get('enable') === 'true';
  if (ids.length === 0) return { ok: true, updated: 0 };

  const db = getDb();
  const r = await db
    .update(schema.categoryRules)
    .set({ isActive: enable })
    .where(
      and(
        inArray(schema.categoryRules.id, ids),
        eq(schema.categoryRules.householdId, session.user.householdId),
      ),
    )
    .returning({ id: schema.categoryRules.id });

  revalidatePath('/admin/rules');
  return { ok: true, updated: r.length };
}

/** Apply a rule to all existing matching transactions (backfill). */
export async function applyRuleToPastTransactions(ruleId: string): Promise<{ ok: boolean; updated: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, updated: 0 };
  const db = getDb();

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

  const conditions = [
    eq(schema.transactions.householdId, session.user.householdId),
    isNull(schema.transactions.deletedAt),
  ];
  const patternCond = buildMerchantPatternCondition(rule.pattern, rule.matchType as 'contains' | 'starts_with' | 'exact' | 'regex');
  if (patternCond) conditions.push(patternCond);
  if (rule.appliesToAccountId) {
    conditions.push(eq(schema.transactions.accountId, rule.appliesToAccountId));
  }
  if (rule.minAmountIls !== null) {
    conditions.push(sql`abs(${schema.transactions.amountIls}::numeric) >= ${Number(rule.minAmountIls)}`);
  }
  if (rule.maxAmountIls !== null) {
    conditions.push(sql`abs(${schema.transactions.amountIls}::numeric) <= ${Number(rule.maxAmountIls)}`);
  }
  const backfillNotesCond = buildNotesCondition(rule.notesPattern, rule.notesMatchType);
  if (backfillNotesCond) conditions.push(backfillNotesCond);

  const updated = await db
    .update(schema.transactions)
    .set({
      categoryId: rule.categoryId,
      subCategoryId: rule.subCategoryId,
      // Stamp attribution so the ⚡ badge appears on backfilled transactions too
      appliedRuleId: rule.id,
      categorySource: 'rule',
    })
    .where(and(...conditions))
    .returning({ id: schema.transactions.id });

  await db
    .update(schema.categoryRules)
    .set({ timesApplied: sql`${schema.categoryRules.timesApplied} + ${updated.length}`, lastAppliedAt: new Date() })
    .where(eq(schema.categoryRules.id, ruleId));

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'apply_rule_to_past',
    entityType: 'category_rule',
    entityId: ruleId,
    afterJson: { updatedCount: updated.length } as object,
  });

  revalidatePath('/admin/rules');
  revalidatePath('/transactions');
  return { ok: true, updated: updated.length };
}
