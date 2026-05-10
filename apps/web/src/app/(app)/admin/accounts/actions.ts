'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, count } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth } from '@/lib/auth';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return session.user;
}

function parseAccountForm(formData: FormData) {
  const numOrDefault = (key: string, def: number): number => {
    const v = Number(formData.get(key));
    return Number.isFinite(v) && v >= 0 ? v : def;
  };
  const paymentSchedule = String(formData.get('paymentSchedule') ?? 'immediate');
  const isMonthly = paymentSchedule === 'monthly_billing';

  // Opening balance can be negative (overdraft) so we don't apply the >=0 guard.
  const obRaw = formData.get('openingBalanceIls');
  const obNum = obRaw === null || obRaw === '' ? 0 : Number(obRaw);
  const openingBalanceIls = Number.isFinite(obNum) ? obNum : 0;

  // openingBalanceAsOf may be empty (NULL semantics) — empty string ⇒ null.
  const obAsOfRaw = String(formData.get('openingBalanceAsOf') ?? '').trim();
  const openingBalanceAsOf = obAsOfRaw || null;

  return {
    name: String(formData.get('name') ?? '').trim(),
    type: String(formData.get('type') ?? 'bank') as 'bank' | 'credit_card',
    purpose: String(formData.get('purpose') ?? 'personal') as 'personal' | 'business' | 'shared',
    institution: String(formData.get('institution') ?? '').trim(),
    accountNumberMasked: String(formData.get('accountNumberMasked') ?? '').trim() || null,
    externalKey: String(formData.get('externalKey') ?? '').trim() || null,
    paymentSchedule: paymentSchedule as 'immediate' | 'monthly_billing',
    cutoffDay: isMonthly ? numOrDefault('cutoffDay', 10) : 0,
    chargeDay: isMonthly ? numOrDefault('chargeDay', 10) : 0,
    isActive: formData.get('isActive') !== 'false',
    currency: String(formData.get('currency') ?? 'ILS').trim() || 'ILS',
    openingBalanceIls,
    openingBalanceAsOf,
  };
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function createAccount(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; accountId?: string }> {
  const user = await requireSession();
  const db = getDb();
  const f = parseAccountForm(formData);

  if (!f.name) return { ok: false, error: 'שם חשבון הוא שדה חובה' };
  if (!f.institution) return { ok: false, error: 'מוסד / בנק הוא שדה חובה' };

  const [created] = await db
    .insert(schema.accounts)
    .values({
      householdId: user.householdId,
      name: f.name,
      type: f.type,
      purpose: f.purpose,
      institution: f.institution,
      accountNumberMasked: f.accountNumberMasked,
      externalKey: f.externalKey,
      paymentSchedule: f.paymentSchedule,
      cutoffDay: f.cutoffDay,
      chargeDay: f.chargeDay,
      isActive: f.isActive,
      currency: f.currency,
      openingBalanceIls: String(f.openingBalanceIls),
      openingBalanceAsOf: f.openingBalanceAsOf,
    })
    .returning({ id: schema.accounts.id });

  await db.insert(schema.auditLog).values({
    householdId: user.householdId,
    actorUserId: user.id,
    action: 'create',
    entityType: 'account',
    entityId: created!.id,
    afterJson: { name: f.name, institution: f.institution } as object,
  });

  revalidatePath('/admin/accounts');
  revalidatePath('/');
  return { ok: true, accountId: created!.id };
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function updateAccount(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'חסר מזהה' };

  const f = parseAccountForm(formData);
  if (!f.name) return { ok: false, error: 'שם חשבון הוא שדה חובה' };
  if (!f.institution) return { ok: false, error: 'מוסד / בנק הוא שדה חובה' };

  const [existing] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), eq(schema.accounts.householdId, user.householdId)))
    .limit(1);
  if (!existing) return { ok: false, error: 'חשבון לא נמצא' };

  await db
    .update(schema.accounts)
    .set({
      name: f.name,
      type: f.type,
      purpose: f.purpose,
      institution: f.institution,
      accountNumberMasked: f.accountNumberMasked,
      externalKey: f.externalKey,
      paymentSchedule: f.paymentSchedule,
      cutoffDay: f.cutoffDay,
      chargeDay: f.chargeDay,
      isActive: f.isActive,
      currency: f.currency,
      openingBalanceIls: String(f.openingBalanceIls),
      openingBalanceAsOf: f.openingBalanceAsOf,
    })
    .where(eq(schema.accounts.id, id));

  await db.insert(schema.auditLog).values({
    householdId: user.householdId,
    actorUserId: user.id,
    action: 'update',
    entityType: 'account',
    entityId: id,
    afterJson: { name: f.name, institution: f.institution } as object,
  });

  revalidatePath('/admin/accounts');
  revalidatePath('/');
  revalidatePath('/transactions');
  return { ok: true };
}

// ─── delete ───────────────────────────────────────────────────────────────────

export async function deleteAccount(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; txnCount?: number }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  const force = formData.get('force') === 'true'; // bypass the txn-count guard

  if (!id) return { ok: false, error: 'חסר מזהה' };

  // Guard: don't silently wipe an account that owns transactions
  const countRows = await db
    .select({ n: count(schema.transactions.id) })
    .from(schema.transactions)
    .where(
      and(eq(schema.transactions.accountId, id), eq(schema.transactions.householdId, user.householdId)),
    );
  const txnCount = countRows[0]?.n ?? 0;

  if (txnCount > 0 && !force) {
    return { ok: false, error: 'יש תנועות לחשבון', txnCount };
  }

  await db
    .delete(schema.accounts)
    .where(and(eq(schema.accounts.id, id), eq(schema.accounts.householdId, user.householdId)));

  await db.insert(schema.auditLog).values({
    householdId: user.householdId,
    actorUserId: user.id,
    action: 'delete',
    entityType: 'account',
    entityId: id,
  });

  revalidatePath('/admin/accounts');
  revalidatePath('/');
  return { ok: true };
}

// ─── toggle active ────────────────────────────────────────────────────────────

export async function toggleAccountActive(
  formData: FormData,
): Promise<{ ok: boolean }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  const isActive = formData.get('isActive') === 'true';

  await db
    .update(schema.accounts)
    .set({ isActive })
    .where(and(eq(schema.accounts.id, id), eq(schema.accounts.householdId, user.householdId)));

  revalidatePath('/admin/accounts');
  return { ok: true };
}

// ─── bulk actions ─────────────────────────────────────────────────────────────

export async function bulkToggleAccountsActive(
  formData: FormData,
): Promise<{ ok: boolean; updated: number }> {
  const user = await requireSession();
  const ids = (formData.getAll('ids') as string[]).filter(Boolean);
  const isActive = formData.get('isActive') === 'true';
  if (ids.length === 0) return { ok: true, updated: 0 };

  const db = getDb();
  const rows = await db
    .update(schema.accounts)
    .set({ isActive })
    .where(
      and(
        inArray(schema.accounts.id, ids),
        eq(schema.accounts.householdId, user.householdId),
      ),
    )
    .returning({ id: schema.accounts.id });

  revalidatePath('/admin/accounts');
  return { ok: true, updated: rows.length };
}

// ─── legacy helpers kept for backwards compat ────────────────────────────────

export async function setAccountPurpose(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  const purpose = String(formData.get('purpose') ?? '');
  if (!['personal', 'business', 'shared'].includes(purpose)) {
    return { ok: false, error: 'Invalid purpose' };
  }
  await db
    .update(schema.accounts)
    .set({ purpose: purpose as 'personal' | 'business' | 'shared' })
    .where(and(eq(schema.accounts.id, id), eq(schema.accounts.householdId, user.householdId)));

  await db.insert(schema.auditLog).values({
    householdId: user.householdId,
    actorUserId: user.id,
    action: 'update',
    entityType: 'account',
    entityId: id,
    afterJson: { purpose } as object,
  });

  revalidatePath('/admin/accounts');
  revalidatePath('/');
  return { ok: true };
}

export async function setAccountType(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  const type = String(formData.get('type') ?? '');
  if (!['bank', 'credit_card'].includes(type)) {
    return { ok: false, error: 'Invalid type' };
  }
  await db
    .update(schema.accounts)
    .set({ type: type as 'bank' | 'credit_card' })
    .where(and(eq(schema.accounts.id, id), eq(schema.accounts.householdId, user.householdId)));

  revalidatePath('/admin/accounts');
  revalidatePath('/');
  return { ok: true };
}
