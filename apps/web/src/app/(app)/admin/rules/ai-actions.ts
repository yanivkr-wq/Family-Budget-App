'use server';

/**
 * AI-powered batch categorization for uncategorized transactions.
 *
 * Flow:
 *   1. Gather all transactions for the household where category_id IS NULL.
 *   2. Group by merchant_normalized — we only need ONE classification per
 *      unique merchant, then we backfill all matching transactions.
 *   3. Send the unique merchants + the household's category list to Claude
 *      Haiku (one round trip) for classification.
 *   4. For each high-confidence result (≥ 0.6), create a category_rule
 *      (matchType=exact) so future imports auto-apply, then update all
 *      matching uncategorized transactions.
 *   5. Return a per-merchant summary the UI can display.
 *
 * Why a separate action (not run-on-import): import is fast and synchronous;
 * Claude calls take 5-15s. Running it inline would slow every import. Better
 * to import first (rules engine catches what it knows), then run this action
 * once to fill the rest. The new rules persist so subsequent imports of the
 * SAME merchants land categorized without another LLM call.
 */

import { auth } from '@/lib/auth';
import { getDb, schema, normalizeMerchant } from '@fba/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { CategorizerBatchClient } from '@fba/categorizer';

export interface AiTagSummary {
  merchantNormalized: string;
  categoryId:         string | null;
  categoryNameHe:     string | null;
  confidence:         number;
  reasoning:          string;
  txnCount:           number;     // how many transactions this merchant has
  applied:            boolean;    // false when confidence below threshold
}

export interface AiTagResult {
  ok:                 boolean;
  uniqueMerchants:    number;
  totalUncategorized: number;
  rulesCreated:       number;
  rowsCategorized:    number;
  results:            AiTagSummary[];
  /** Total tokens consumed (rough — single call, single completion). */
  tokensIn:           number;
  tokensOut:          number;
  durationMs:         number;
  message?:           string;
}

const CONFIDENCE_THRESHOLD = 0.6;
const MAX_MERCHANTS_PER_BATCH = 80; // keeps a single Claude call under ~4K output tokens

export async function runAiCategorization(): Promise<AiTagResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false, uniqueMerchants: 0, totalUncategorized: 0, rulesCreated: 0,
      rowsCategorized: 0, results: [], tokensIn: 0, tokensOut: 0, durationMs: 0,
      message: 'unauthorized',
    };
  }
  const householdId = session.user.householdId;
  const db = getDb();

  // ── Pull uncategorized transactions, grouped by merchant_normalized ──────
  type Row = { merchantNormalized: string; txnCount: number; sampleAmount: number };
  const rows = await db
    .select({
      merchantNormalized: schema.transactions.merchantNormalized,
      txnCount:           sql<number>`count(*)::int`,
      sampleAmount:       sql<number>`avg(${schema.transactions.amountIls})::float`,
    })
    .from(schema.transactions)
    .where(and(
      eq(schema.transactions.householdId, householdId),
      isNull(schema.transactions.categoryId),
      isNull(schema.transactions.deletedAt),
    ))
    .groupBy(schema.transactions.merchantNormalized) as Row[];

  if (rows.length === 0) {
    return {
      ok: true, uniqueMerchants: 0, totalUncategorized: 0, rulesCreated: 0,
      rowsCategorized: 0, results: [], tokensIn: 0, tokensOut: 0, durationMs: 0,
      message: 'אין תנועות ללא קטגוריה',
    };
  }

  const totalUncategorized = rows.reduce((s, r) => s + r.txnCount, 0);

  // ── Pull the category list (only top-level expense + income categories) ──
  const cats = await db
    .select({
      id:        schema.categories.id,
      nameHe:    schema.categories.nameHe,
      nameEn:    schema.categories.nameEn,
      isIncome:  schema.categories.isIncome,
    })
    .from(schema.categories)
    .where(and(
      eq(schema.categories.householdId, householdId),
      isNull(schema.categories.parentId),
    ));

  const categoriesForLlm = cats.map((c) => ({
    id: c.id,
    nameHe: c.nameHe,
    nameEn: c.nameEn ?? null,
    isIncome: c.isIncome,
  }));

  // ── Trim to MAX merchants per call. If the user has more, we batch — but
  // for the v1 personal-app scale this is rarely exceeded. ────────────────
  const trimmed = rows.slice(0, MAX_MERCHANTS_PER_BATCH);

  let client: CategorizerBatchClient;
  try {
    client = new CategorizerBatchClient();
  } catch (err) {
    return {
      ok: false, uniqueMerchants: 0, totalUncategorized, rulesCreated: 0,
      rowsCategorized: 0, results: [], tokensIn: 0, tokensOut: 0, durationMs: 0,
      message: err instanceof Error ? err.message : 'cannot reach categorizer',
    };
  }

  let llmResp: Awaited<ReturnType<CategorizerBatchClient['categorizeMany']>>;
  try {
    llmResp = await client.categorizeMany(
      trimmed.map((r) => ({ merchantNormalized: r.merchantNormalized, sampleAmounts: [r.sampleAmount] })),
      categoriesForLlm,
    );
  } catch (err) {
    return {
      ok: false, uniqueMerchants: trimmed.length, totalUncategorized, rulesCreated: 0,
      rowsCategorized: 0, results: [], tokensIn: 0, tokensOut: 0, durationMs: 0,
      message: err instanceof Error ? `Claude error: ${err.message}` : 'Claude error',
    };
  }

  // ── Validate categoryIds against the household's actual categories
  // (the model occasionally hallucinates IDs despite the schema). ─────────
  const validCategoryIds = new Set(cats.map((c) => c.id));
  const catMap = new Map(cats.map((c) => [c.id, c.nameHe]));

  const summary: AiTagSummary[] = [];
  let rulesCreated = 0;
  let rowsCategorized = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const row = trimmed[i]!;
    const llm = llmResp.results[i];
    const isApplicable =
      !!llm &&
      llm.categoryId !== null &&
      validCategoryIds.has(llm.categoryId) &&
      llm.confidence >= CONFIDENCE_THRESHOLD;

    summary.push({
      merchantNormalized: row.merchantNormalized,
      categoryId:         llm?.categoryId ?? null,
      categoryNameHe:     llm?.categoryId && catMap.has(llm.categoryId) ? catMap.get(llm.categoryId)! : null,
      confidence:         llm?.confidence ?? 0,
      reasoning:          llm?.reasoning ?? '',
      txnCount:           row.txnCount,
      applied:            isApplicable,
    });

    if (!isApplicable) continue;

    // Create a category_rule so future imports auto-apply. Using exact match
    // on the normalized merchant for high precision; the user can edit later.
    const ruleResult = await db.insert(schema.categoryRules).values({
      householdId,
      name:         `AI: ${row.merchantNormalized}`,
      description:  `Auto-created by Claude — ${llm!.reasoning.slice(0, 200)}`,
      priority:     500, // lower than user rules (default 100), higher than nothing
      matchType:    'exact',
      pattern:      row.merchantNormalized,
      categoryId:   llm!.categoryId!,
      ...(llm!.subCategoryId ? { subCategoryId: llm!.subCategoryId } : {}),
      isActive:     true,
      source:       'llm_confirmed',
    }).onConflictDoNothing().returning({ id: schema.categoryRules.id });

    if (ruleResult.length > 0) rulesCreated++;

    // Backfill all uncategorized transactions for this merchant.
    const updateResult = await db
      .update(schema.transactions)
      .set({
        categoryId:     llm!.categoryId!,
        subCategoryId:  llm!.subCategoryId ?? null,
        categorySource: 'llm',
        ...(ruleResult[0]?.id ? { appliedRuleId: ruleResult[0].id } : {}),
      })
      .where(and(
        eq(schema.transactions.householdId, householdId),
        eq(schema.transactions.merchantNormalized, row.merchantNormalized),
        isNull(schema.transactions.categoryId),
        isNull(schema.transactions.deletedAt),
      ))
      .returning({ id: schema.transactions.id });

    rowsCategorized += updateResult.length;
  }

  // Audit trail
  await db.insert(schema.auditLog).values({
    householdId,
    actorUserId: session.user.id,
    action: 'ai_categorize',
    entityType: 'transaction',
    afterJson: {
      uniqueMerchants: trimmed.length,
      totalUncategorized,
      rulesCreated,
      rowsCategorized,
      tokensIn:  llmResp.tokensIn,
      tokensOut: llmResp.tokensOut,
      durationMs: llmResp.durationMs,
    } as object,
  });

  revalidatePath('/transactions');
  revalidatePath('/admin/rules');

  return {
    ok: true,
    uniqueMerchants: trimmed.length,
    totalUncategorized,
    rulesCreated,
    rowsCategorized,
    results: summary.sort((a, b) => b.txnCount - a.txnCount),
    tokensIn:  llmResp.tokensIn,
    tokensOut: llmResp.tokensOut,
    durationMs: llmResp.durationMs,
  };
}

// Helper kept here so linter doesn't complain about unused import in the
// build (used only by the inArray fallback path if we add manual review later).
void inArray;
void normalizeMerchant;
