'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import {
  getDb,
  schema,
  computeBillingMonth,
  normalizeMerchant,
} from '@fba/db';
import { auth } from '@/lib/auth';
import { applyRules } from '@fba/categorizer';
import { autoComputeChargeDate } from '@/lib/charge-date';

// Server actions for manual transaction CRUD. All household-scoped.
// Mutations write to audit_log; soft-deletes also push to undo_stack with 24h TTL.

interface SessionContext {
  householdId: string;
  userId: string;
}

async function requireSession(): Promise<SessionContext> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, userId: session.user.id };
}

async function getOrCreateManualAccount(
  db: ReturnType<typeof getDb>,
  householdId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.householdId, householdId),
        eq(schema.accounts.institution, 'manual'),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [acc] = await db
    .insert(schema.accounts)
    .values({
      householdId,
      name: 'ידני',
      type: 'bank',
      institution: 'manual',
      cutoffDay: 0, // manual entries always count in their actual month
      isActive: true,
    })
    .returning({ id: schema.accounts.id });
  return acc!.id;
}

export interface CreateTransactionResult {
  ok: boolean;
  error?: string;
  transactionId?: string;
}

export async function createTransaction(formData: FormData): Promise<CreateTransactionResult> {
  const ctx = await requireSession();
  const db = getDb();

  const transactionDate = String(formData.get('transactionDate') ?? '').trim();
  const chargeDateRaw = String(formData.get('chargeDate') ?? '').trim();
  const chargeDate = /^\d{4}-\d{2}-\d{2}$/.test(chargeDateRaw) ? chargeDateRaw : null;
  const merchantRaw = String(formData.get('merchantRaw') ?? '').trim();
  const amountRaw = String(formData.get('amountIls') ?? '').trim();
  const sign = String(formData.get('sign') ?? 'expense'); // 'expense' | 'income'
  const categoryId = (formData.get('categoryId') as string | null) || null;
  const subCategoryId = (formData.get('subCategoryId') as string | null) || null;
  const accountIdInput = (formData.get('accountId') as string | null) || null;
  const notes = (String(formData.get('notes') ?? '').trim()) || null;

  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    return { ok: false, error: 'תאריך לא תקין' };
  }
  if (!merchantRaw) return { ok: false, error: 'יש להזין שם בית עסק' };
  const amountNum = Number(amountRaw);
  if (!Number.isFinite(amountNum) || amountNum === 0) {
    return { ok: false, error: 'סכום לא תקין' };
  }
  const signed = sign === 'income' ? Math.abs(amountNum) : -Math.abs(amountNum);

  // Pick account
  let accountId = accountIdInput;
  if (!accountId) {
    accountId = await getOrCreateManualAccount(db, ctx.householdId);
  } else {
    // Verify account belongs to household
    const [own] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, accountId),
          eq(schema.accounts.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (!own) return { ok: false, error: 'חשבון לא נמצא' };
  }

  // Resolve cutoff for billing month + auto-compute chargeDate if not supplied
  const [acc] = await db
    .select({ cutoffDay: schema.accounts.cutoffDay })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .limit(1);
  const cutoffDay = acc?.cutoffDay ?? 10;

  // Auto-derive charge date first (needed for billing month)
  const finalChargeDate = chargeDate ?? autoComputeChargeDate(transactionDate, cutoffDay);

  // Billing month = the month when money actually leaves the bank (= charge date's month).
  // Falling back to the formula-based approach only when no charge date is available
  // (e.g., bank-direct debit with cutoffDay=0 and no explicit charge date).
  const billingMonth = finalChargeDate
    ? finalChargeDate.slice(0, 7)
    : computeBillingMonth(transactionDate, cutoffDay);

  const [inserted] = await db
    .insert(schema.transactions)
    .values({
      householdId: ctx.householdId,
      accountId,
      transactionDate,
      chargeDate: finalChargeDate,
      billingMonth,
      amountIls: String(signed),
      currency: 'ILS',
      merchantRaw,
      merchantNormalized: normalizeMerchant(merchantRaw),
      categoryId,
      subCategoryId,
      // If user picked a category during add, stamp it as manual so we have an
      // accurate source from the start (rule engine below may override to 'rule').
      categorySource: categoryId ? 'manual' : null,
      notes,
      isManual: true,
    })
    .returning();

  // ── Auto-apply rules ──────────────────────────────────────────────────────
  // Only run if the user didn't already set a category on the manual entry
  if (!categoryId) {
    const rules = await db
      .select()
      .from(schema.categoryRules)
      .where(
        and(
          eq(schema.categoryRules.householdId, ctx.householdId),
          eq(schema.categoryRules.isActive, true),
        ),
      );

    const match = applyRules(rules, {
      merchantNormalized: normalizeMerchant(merchantRaw),
      merchantRaw,
      accountId,
      amountAbs: Math.abs(signed),
      notes,
    });

    if (match) {
      await db
        .update(schema.transactions)
        .set({
          categoryId: match.categoryId,
          subCategoryId: match.subCategoryId,
          appliedRuleId: match.rule.id,
          categorySource: 'rule',
        })
        .where(eq(schema.transactions.id, inserted!.id));

      // Update rule stats
      await db
        .update(schema.categoryRules)
        .set({
          timesApplied: (match.rule.timesApplied ?? 0) + 1,
          lastAppliedAt: new Date(),
        })
        .where(eq(schema.categoryRules.id, match.rule.id));
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // Audit log
  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'create',
    entityType: 'transaction',
    entityId: inserted!.id,
    afterJson: inserted as object,
  });

  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/grid');

  return { ok: true, transactionId: inserted!.id };
}

export interface UpdateTransactionInput {
  id: string;
  transactionDate: string;
  chargeDate: string | null;
  merchantRaw: string;
  amountIls: number; // signed
  accountId: string;
  categoryId: string | null;
  subCategoryId: string | null;
  notes: string | null;
}

export async function updateTransaction(
  input: UpdateTransactionInput,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSession();
  const db = getDb();

  // Validate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)) {
    return { ok: false, error: 'תאריך לא תקין' };
  }
  if (!input.merchantRaw.trim()) return { ok: false, error: 'יש להזין שם בית עסק' };
  if (!Number.isFinite(input.amountIls) || input.amountIls === 0) {
    return { ok: false, error: 'סכום לא תקין' };
  }

  // Fetch existing
  const [existing] = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.id, input.id),
        eq(schema.transactions.householdId, ctx.householdId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: 'תנועה לא נמצאה' };
  if (existing.deletedAt) return { ok: false, error: 'תנועה מחוקה' };

  // Verify the account belongs to household
  const [acc] = await db
    .select({
      id: schema.accounts.id,
      cutoffDay: schema.accounts.cutoffDay,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.id, input.accountId),
        eq(schema.accounts.householdId, ctx.householdId),
      ),
    )
    .limit(1);
  if (!acc) return { ok: false, error: 'חשבון לא נמצא' };

  // If categoryId is set, validate; same for subCategoryId
  if (input.categoryId) {
    const [c] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, input.categoryId),
          eq(schema.categories.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (!c) return { ok: false, error: 'קטגוריה לא נמצאה' };
  }
  if (input.subCategoryId) {
    const [c] = await db
      .select({ id: schema.categories.id, parentId: schema.categories.parentId })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, input.subCategoryId),
          eq(schema.categories.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (!c) return { ok: false, error: 'תת-קטגוריה לא נמצאה' };
    // sub must belong to selected parent (if both provided)
    if (input.categoryId && c.parentId !== input.categoryId) {
      return { ok: false, error: 'תת-קטגוריה אינה תואמת לקטגוריה' };
    }
  }

  const cutoffDay = acc.cutoffDay ?? 10;

  // Auto-derive charge date first (needed for billing month)
  const finalChargeDate = input.chargeDate ?? autoComputeChargeDate(input.transactionDate, cutoffDay);

  // Same logic as createTransaction: billing month comes from the charge date's month
  const billingMonth = finalChargeDate
    ? finalChargeDate.slice(0, 7)
    : computeBillingMonth(input.transactionDate, cutoffDay);

  const [updated] = await db
    .update(schema.transactions)
    .set({
      transactionDate: input.transactionDate,
      chargeDate: finalChargeDate,
      billingMonth,
      merchantRaw: input.merchantRaw.trim(),
      merchantNormalized: normalizeMerchant(input.merchantRaw.trim()),
      amountIls: String(input.amountIls),
      accountId: input.accountId,
      categoryId: input.categoryId,
      subCategoryId: input.subCategoryId,
      notes: input.notes?.trim() || null,
      // Only wipe rule attribution when the user actively changed the category.
      // If the category is unchanged we preserve the existing source + ruleId so
      // the ⚡ indicator survives a save-without-change.
      ...(input.categoryId !== existing.categoryId
        ? { appliedRuleId: null, categorySource: input.categoryId ? 'manual' : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.transactions.id, input.id))
    .returning();

  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'update',
    entityType: 'transaction',
    entityId: input.id,
    beforeJson: existing as object,
    afterJson: updated as object,
  });

  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/grid');

  return { ok: true };
}

export async function deleteTransaction(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSession();
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.id, id),
        eq(schema.transactions.householdId, ctx.householdId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: 'תנועה לא נמצאה' };
  if (existing.deletedAt) return { ok: false, error: 'תנועה כבר נמחקה' };

  const now = new Date();
  await db
    .update(schema.transactions)
    .set({ deletedAt: now })
    .where(eq(schema.transactions.id, id));

  // Audit log
  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'delete',
    entityType: 'transaction',
    entityId: id,
    beforeJson: existing as object,
    afterJson: { ...existing, deletedAt: now } as object,
  });

  // Undo stack entry — 24h TTL
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(schema.undoStack).values({
    householdId: ctx.householdId,
    userId: ctx.userId,
    action: 'transaction.delete',
    payload: { transactionId: id },
    expiresAt,
  });

  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/grid');

  return { ok: true };
}

export async function restoreTransaction(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSession();
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.id, id),
        eq(schema.transactions.householdId, ctx.householdId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: 'תנועה לא נמצאה' };

  await db
    .update(schema.transactions)
    .set({ deletedAt: null })
    .where(eq(schema.transactions.id, id));

  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'restore',
    entityType: 'transaction',
    entityId: id,
    beforeJson: existing as object,
  });

  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/grid');

  return { ok: true };
}
