'use server';

/**
 * Projects CRUD + transaction assignment.
 *
 * A "project" is a long-running expense bucket that lives OUTSIDE the
 * monthly cash flow — typical example: house construction. Per the
 * project's `excludeFromMonthlyTotals` flag (default true), transactions
 * tagged to it are automatically excluded from the personal / business /
 * combined dashboards and transaction views.
 *
 * Use cases:
 *   • Track a multi-year build with its own budget + cash flow
 *   • Don't pollute the regular monthly summaries with one-off ₪200K
 *     transfers to a contractor
 *   • Each project has its own page at /projects/[id]
 */

import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

async function ctx() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, userId: session.user.id, db: getDb() };
}

export interface ProjectRow {
  id:                       string;
  name:                     string;
  description:              string | null;
  color:                    string | null;
  totalBudgetIls:           string | null;
  startDate:                string | null;
  endDate:                  string | null;
  status:                   'active' | 'completed' | 'cancelled' | 'paused';
  excludeFromMonthlyTotals: boolean;
  // ── Sign-aware aggregations ──────────────────────────────────────────────
  // Expenses = sum of ABS(amount) for negative txns (money out — vendor
  //            payments, materials, etc.)
  // Income   = sum of amount for positive txns (money in — mortgage
  //            disbursements, grants, sale of materials, refunds, etc.)
  // The legacy `totalSpent` is kept as an alias of totalExpenses so old
  // callers don't break, but new code should use the explicit pair.
  totalExpenses:            number;
  totalIncome:              number;
  /** @deprecated alias of totalExpenses — kept for backward compat. */
  totalSpent:               number;
  txnCount:                 number;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const { householdId, db } = await ctx();
  const rows = await db
    .select({
      id:                       schema.projects.id,
      name:                     schema.projects.name,
      description:              schema.projects.description,
      color:                    schema.projects.color,
      totalBudgetIls:           schema.projects.totalBudgetIls,
      startDate:                schema.projects.startDate,
      endDate:                  schema.projects.endDate,
      status:                   schema.projects.status,
      excludeFromMonthlyTotals: schema.projects.excludeFromMonthlyTotals,
      // One subquery per project for the totals — fine at this scale (1-2
      // projects per household). Avoids a separate join + groupBy round-trip.
      //
      // CAREFUL: write `"project"."id"` qualified, NOT `${schema.projects.id}`.
      // Drizzle's interpolation drops the table qualifier when it deems it
      // unambiguous in the OUTER query, but inside this correlated subquery
      // the inner table `t` (transaction) ALSO has an `id` column → unqualified
      // `"id"` resolves to `t.id` and the WHERE never matches anything.
      // Sign-aware: only NEGATIVE amounts (money OUT) count as expenses.
      // POSITIVE amounts (mortgage disbursement, refunds, etc.) are
      // funding/income — see totalIncome below.
      // Both also skip rows flagged `excluded_from_totals` (loan
      // refinancing, CC settlement lines, internal corrections — see the
      // edit-transaction modal toggle).
      totalExpenses:            sql<number>`(
        SELECT COALESCE(SUM(ABS(t.amount_ils::numeric)), 0)::numeric
        FROM ${schema.transactions} t
        WHERE t.project_id = "project"."id"
          AND t.deleted_at IS NULL
          AND t.is_projected = false
          AND t.excluded_from_totals = false
          AND t.amount_ils < 0
      )`,
      totalIncome:              sql<number>`(
        SELECT COALESCE(SUM(t.amount_ils::numeric), 0)::numeric
        FROM ${schema.transactions} t
        WHERE t.project_id = "project"."id"
          AND t.deleted_at IS NULL
          AND t.is_projected = false
          AND t.excluded_from_totals = false
          AND t.amount_ils > 0
      )`,
      txnCount:                 sql<number>`(
        SELECT COUNT(*)::int FROM ${schema.transactions} t
        WHERE t.project_id = "project"."id"
          AND t.deleted_at IS NULL
          AND t.is_projected = false
      )`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.householdId, householdId))
    .orderBy(schema.projects.createdAt);

  return rows.map((r) => {
    const totalExpenses = Number(r.totalExpenses ?? 0);
    const totalIncome   = Number(r.totalIncome ?? 0);
    return {
      ...r,
      status:                   r.status as ProjectRow['status'],
      totalBudgetIls:           r.totalBudgetIls ? String(r.totalBudgetIls) : null,
      startDate:                r.startDate ? String(r.startDate) : null,
      endDate:                  r.endDate ? String(r.endDate) : null,
      totalExpenses,
      totalIncome,
      // Legacy alias — equals totalExpenses so old callers keep working.
      totalSpent:               totalExpenses,
      txnCount:                 Number(r.txnCount ?? 0),
    };
  });
}

interface ProjectFormInput {
  name:                     string;
  description:              string | null;
  color:                    string | null;
  totalBudgetIls:           number | null;
  startDate:                string | null;
  endDate:                  string | null;
  status:                   ProjectRow['status'];
  excludeFromMonthlyTotals: boolean;
}

function parseProjectForm(fd: FormData): ProjectFormInput {
  const num = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const n = Number(String(v).replace(/,/g, '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    name:           String(fd.get('name') ?? '').trim(),
    description:    (String(fd.get('description') ?? '').trim()) || null,
    color:          (String(fd.get('color') ?? '').trim()) || null,
    totalBudgetIls: num(fd.get('totalBudgetIls')),
    startDate:      (String(fd.get('startDate') ?? '').trim()) || null,
    endDate:        (String(fd.get('endDate') ?? '').trim()) || null,
    status:         (fd.get('status') as ProjectRow['status']) ?? 'active',
    excludeFromMonthlyTotals: fd.get('excludeFromMonthlyTotals') !== 'false',
  };
}

export async function createProject(fd: FormData): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const { householdId, db } = await ctx();
    const f = parseProjectForm(fd);
    if (!f.name) return { ok: false, error: 'שם הפרויקט הוא שדה חובה' };
    const [created] = await db.insert(schema.projects).values({
      householdId,
      name:            f.name,
      description:     f.description,
      color:           f.color,
      totalBudgetIls:  f.totalBudgetIls !== null ? String(f.totalBudgetIls) : null,
      startDate:       f.startDate,
      endDate:         f.endDate,
      status:          f.status,
      excludeFromMonthlyTotals: f.excludeFromMonthlyTotals,
    }).returning();
    revalidatePath('/projects');
    revalidatePath('/'); // dashboard re-fetches account/totals lists
    return { ok: true, id: created!.id };
  } catch (e) {
    console.error('createProject', e);
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}

export async function updateProject(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await ctx();
    const id = String(fd.get('id') ?? '');
    if (!id) return { ok: false, error: 'missing id' };
    const f = parseProjectForm(fd);
    if (!f.name) return { ok: false, error: 'שם הפרויקט הוא שדה חובה' };
    await db.update(schema.projects).set({
      name:            f.name,
      description:     f.description,
      color:           f.color,
      totalBudgetIls:  f.totalBudgetIls !== null ? String(f.totalBudgetIls) : null,
      startDate:       f.startDate,
      endDate:         f.endDate,
      status:          f.status,
      excludeFromMonthlyTotals: f.excludeFromMonthlyTotals,
      updatedAt:       new Date(),
    }).where(and(
      eq(schema.projects.id, id),
      eq(schema.projects.householdId, householdId),
    ));
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    revalidatePath('/');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    console.error('updateProject', e);
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}

export async function deleteProject(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await ctx();
    // Unassign transactions first so they fall back into normal cash flow.
    await db.update(schema.transactions).set({ projectId: null }).where(and(
      eq(schema.transactions.householdId, householdId),
      eq(schema.transactions.projectId, id),
    ));
    await db.delete(schema.projects).where(and(
      eq(schema.projects.id, id),
      eq(schema.projects.householdId, householdId),
    ));
    revalidatePath('/projects');
    revalidatePath('/');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    console.error('deleteProject', e);
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}

/**
 * Tag one or more transactions with a project. Pass projectId=null to
 * remove an existing tag (revert to normal cash flow). Used by the
 * per-row button on /transactions and the bulk-action bar.
 */
export async function assignTransactionsToProject(
  transactionIds: string[],
  projectId: string | null,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const { householdId, db } = await ctx();
    if (transactionIds.length === 0) return { ok: true, updated: 0 };
    if (projectId) {
      // Verify the project belongs to this household.
      const [p] = await db.select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(
          eq(schema.projects.id, projectId),
          eq(schema.projects.householdId, householdId),
        ))
        .limit(1);
      if (!p) return { ok: false, updated: 0, error: 'project not found' };
    }
    const r = await db.update(schema.transactions)
      .set({ projectId })
      .where(and(
        eq(schema.transactions.householdId, householdId),
        inArray(schema.transactions.id, transactionIds),
        isNull(schema.transactions.deletedAt),
      ))
      .returning({ id: schema.transactions.id });
    revalidatePath('/');
    revalidatePath('/transactions');
    revalidatePath('/projects');
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true, updated: r.length };
  } catch (e) {
    console.error('assignTransactionsToProject', e);
    return { ok: false, updated: 0, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}
