'use server';

/**
 * Server actions for the /insights surface.
 *
 * Phase A scope:
 *   • drill-deeper fetcher for the category trend chart
 *   • mark-as-transfer pair action (used by the mis-tagged transfers card)
 *
 * Future phases add: updateLayout, updateCategoryTarget, pinInsight,
 * publishInsightToDashboard, etc.
 */

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { getCategoryTrend, type CategoryTrendBucket } from './queries';

export interface CategoryTrendDrillResult {
  buckets: CategoryTrendBucket[];
  months: string[];
  /** What level the buckets actually represent — may differ from drillPath
   *  depth when fall-through fired (e.g. asked for sub but got merchants). */
  effectiveLevel: 'category' | 'sub' | 'merchant';
}

/**
 * Fetch the category-trend buckets at a given drill level.
 * drillPath = []           → top-level categories
 * drillPath = [categoryId] → sub-categories within that category
 * drillPath = [categoryId, subId] → merchants within that sub-category
 */
export async function fetchCategoryTrendLevel(drillPath: string[]): Promise<CategoryTrendDrillResult> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return getCategoryTrend(session.user.householdId, drillPath);
}

/**
 * Mark two transactions as a transfer pair. Sets is_transfer=true and links
 * them via transfer_pair_id on both sides. Used by the "mis-tagged transfers"
 * card so the user can resolve detector misses without leaving /insights.
 *
 * Validation: both rows must belong to the user's household, must currently
 * have is_transfer=false, and must NOT already be paired. Returns a small
 * status object so the client can show a toast.
 */
export interface MarkAsTransferResult {
  ok: boolean;
  message: string;
}

export async function markPairAsTransfer(
  outId: string,
  inId: string,
): Promise<MarkAsTransferResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, message: 'Unauthorized' };
  const householdId = session.user.householdId;
  const db = getDb();

  // Fetch both rows defensively to make sure they belong to this household
  const [out, inn] = await Promise.all([
    db
      .select({
        id: schema.transactions.id,
        householdId: schema.transactions.householdId,
        isTransfer: schema.transactions.isTransfer,
        transferPairId: schema.transactions.transferPairId,
      })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, outId))
      .limit(1),
    db
      .select({
        id: schema.transactions.id,
        householdId: schema.transactions.householdId,
        isTransfer: schema.transactions.isTransfer,
        transferPairId: schema.transactions.transferPairId,
      })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, inId))
      .limit(1),
  ]);

  const o = out[0];
  const i = inn[0];
  if (!o || !i) return { ok: false, message: 'תנועה לא נמצאה' };
  if (o.householdId !== householdId || i.householdId !== householdId) {
    return { ok: false, message: 'אין הרשאה' };
  }
  if (o.isTransfer || i.isTransfer || o.transferPairId || i.transferPairId) {
    return { ok: false, message: 'אחת התנועות כבר מסומנת כהעברה' };
  }

  // Set both sides in one transaction-ish flow (Drizzle pg-postgres-js
  // doesn't expose a multi-statement tx primitive at this layer, but two
  // sequential updates are safe enough for this single-user app).
  await db
    .update(schema.transactions)
    .set({ isTransfer: true, transferPairId: inId })
    .where(and(eq(schema.transactions.id, outId), eq(schema.transactions.householdId, householdId)));
  await db
    .update(schema.transactions)
    .set({ isTransfer: true, transferPairId: outId })
    .where(and(eq(schema.transactions.id, inId), eq(schema.transactions.householdId, householdId)));

  revalidatePath('/insights');
  revalidatePath('/transactions');
  revalidatePath('/');
  return { ok: true, message: 'סומן כהעברה' };
}
