'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ilike, isNull, or, sql, inArray } from 'drizzle-orm';
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
}

function parseForm(formData: FormData): RuleFormInput {
  const numOrNull = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
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
  };
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

  // Pattern match
  const lcPattern = r.pattern.toLowerCase();
  if (r.matchType === 'contains') {
    conditions.push(ilike(schema.transactions.merchantNormalized, `%${lcPattern}%`));
  } else if (r.matchType === 'starts_with') {
    conditions.push(ilike(schema.transactions.merchantNormalized, `${lcPattern}%`));
  } else if (r.matchType === 'exact') {
    conditions.push(eq(schema.transactions.merchantNormalized, lcPattern));
  } else if (r.matchType === 'regex') {
    conditions.push(sql`${schema.transactions.merchantRaw} ~* ${r.pattern}`);
  }

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

export async function createRule(formData: FormData): Promise<{ ok: boolean; ruleId?: string; error?: string }> {
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

  revalidatePath('/admin/rules');
  revalidatePath('/transactions');
  return { ok: true, ruleId: created!.id };
}

export async function updateRule(formData: FormData): Promise<{ ok: boolean; error?: string }> {
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

  revalidatePath('/admin/rules');
  return { ok: true };
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
  const lcPattern = rule.pattern.toLowerCase();
  if (rule.matchType === 'contains') {
    conditions.push(ilike(schema.transactions.merchantNormalized, `%${lcPattern}%`));
  } else if (rule.matchType === 'starts_with') {
    conditions.push(ilike(schema.transactions.merchantNormalized, `${lcPattern}%`));
  } else if (rule.matchType === 'exact') {
    conditions.push(eq(schema.transactions.merchantNormalized, lcPattern));
  } else if (rule.matchType === 'regex') {
    conditions.push(sql`${schema.transactions.merchantRaw} ~* ${rule.pattern}`);
  }
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
