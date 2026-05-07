'use server';

import { auth } from '@/lib/auth';
import { getDb, schema, addMonths } from '@fba/db';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function requireHousehold() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  return { householdId: session.user.householdId, db: getDb() };
}

function parseForm(fd: FormData) {
  const merchant      = String(fd.get('merchantNormalized') ?? '').trim();
  const description   = String(fd.get('description')       ?? '').trim() || null;
  const amount        = parseFloat(String(fd.get('paymentAmountIls') ?? '0'));
  const totalRaw      = fd.get('totalPayments');
  const totalPayments = totalRaw && String(totalRaw).trim() !== '' ? parseInt(String(totalRaw)) : null;
  const currentNo     = parseInt(String(fd.get('currentPaymentNo') ?? '1'));
  const startMonth    = String(fd.get('startMonth') ?? '').trim();  // YYYY-MM
  const accountId     = String(fd.get('accountId') ?? '').trim() || null;
  const status        = (String(fd.get('status') ?? 'active')) as 'active' | 'complete' | 'cancelled';
  const notes         = String(fd.get('notes')     ?? '').trim() || null;

  return { merchant, description, amount, totalPayments, currentNo, startMonth, accountId, status, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

export async function createInstallmentPlan(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const { merchant, description, amount, totalPayments, currentNo, startMonth, accountId, status, notes } = parseForm(fd);

    if (!merchant)    return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return { ok: false, error: 'חודש התחלה לא תקין (YYYY-MM)' };
    if (isNaN(amount) || amount <= 0) return { ok: false, error: 'סכום תשלום חייב להיות חיובי' };
    if (totalPayments !== null && isNaN(totalPayments)) return { ok: false, error: 'מספר תשלומים לא תקין' };
    if (currentNo < 1 || (totalPayments !== null && currentNo > totalPayments)) {
      return { ok: false, error: 'מספר תשלום נוכחי לא תקין' };
    }

    const projectedEndMonth = totalPayments ? addMonths(startMonth, totalPayments - 1) : null;

    await db.insert(schema.installmentPlans).values({
      householdId,
      ...(accountId ? { accountId } : {}),
      merchantNormalized: merchant,
      ...(description ? { description } : {}),
      ...(totalPayments !== null ? { totalPayments } : {}),
      paymentAmountIls: String(amount),
      currentPaymentNo: currentNo,
      startMonth,
      ...(projectedEndMonth ? { projectedEndMonth } : {}),
      status,
      ...(notes ? { notes } : {}),
    });

    revalidatePath('/installments');
    return { ok: true };
  } catch (e) {
    console.error('createInstallmentPlan', e);
    return { ok: false, error: 'שגיאה ביצירת תוכנית תשלומים' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export async function updateInstallmentPlan(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const id = String(fd.get('id') ?? '').trim();
    if (!id) return { ok: false, error: 'מזהה תוכנית חסר' };

    const { merchant, description, amount, totalPayments, currentNo, startMonth, accountId, status, notes } = parseForm(fd);

    if (!merchant)    return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return { ok: false, error: 'חודש התחלה לא תקין (YYYY-MM)' };
    if (isNaN(amount) || amount <= 0) return { ok: false, error: 'סכום תשלום חייב להיות חיובי' };
    if (currentNo < 1 || (totalPayments !== null && currentNo > totalPayments)) {
      return { ok: false, error: 'מספר תשלום נוכחי לא תקין' };
    }

    const projectedEndMonth = totalPayments ? addMonths(startMonth, totalPayments - 1) : null;
    const actualEndMonth    = status === 'complete' ? (new Date().toISOString().slice(0, 7)) : null;

    await db
      .update(schema.installmentPlans)
      .set({
        merchantNormalized: merchant,
        description:        description ?? null,
        totalPayments:      totalPayments ?? null,
        paymentAmountIls:   String(amount),
        currentPaymentNo:   currentNo,
        startMonth,
        projectedEndMonth:  projectedEndMonth ?? null,
        actualEndMonth:     actualEndMonth ?? null,
        accountId:          accountId ?? null,
        status,
        notes:              notes ?? null,
      })
      .where(and(
        eq(schema.installmentPlans.id, id),
        eq(schema.installmentPlans.householdId, householdId),
      ));

    revalidatePath('/installments');
    return { ok: true };
  } catch (e) {
    console.error('updateInstallmentPlan', e);
    return { ok: false, error: 'שגיאה בעדכון תוכנית תשלומים' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (single)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteInstallmentPlan(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();

    // Unlink any real transactions that reference this plan (keep the transactions)
    await db
      .update(schema.transactions)
      .set({ installmentPlanId: null })
      .where(and(
        eq(schema.transactions.installmentPlanId, id),
        eq(schema.transactions.householdId, householdId),
      ));

    await db
      .delete(schema.installmentPlans)
      .where(and(
        eq(schema.installmentPlans.id, id),
        eq(schema.installmentPlans.householdId, householdId),
      ));

    revalidatePath('/installments');
    return { ok: true };
  } catch (e) {
    console.error('deleteInstallmentPlan', e);
    return { ok: false, error: 'שגיאה במחיקת תוכנית תשלומים' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK DELETE
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkDeleteInstallmentPlans(fd: FormData): Promise<{ ok: boolean; error?: string; deleted?: number }> {
  try {
    const { householdId, db } = await requireHousehold();
    const ids = fd.getAll('ids').map(String).filter(Boolean);
    if (ids.length === 0) return { ok: false, error: 'לא נבחרו תוכניות' };

    // Unlink transactions
    await db
      .update(schema.transactions)
      .set({ installmentPlanId: null })
      .where(and(
        inArray(schema.transactions.installmentPlanId, ids),
        eq(schema.transactions.householdId, householdId),
      ));

    await db
      .delete(schema.installmentPlans)
      .where(and(
        inArray(schema.installmentPlans.id, ids),
        eq(schema.installmentPlans.householdId, householdId),
      ));

    revalidatePath('/installments');
    return { ok: true, deleted: ids.length };
  } catch (e) {
    console.error('bulkDeleteInstallmentPlans', e);
    return { ok: false, error: 'שגיאה במחיקה מרובה' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK STATUS UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkUpdateStatus(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const ids    = fd.getAll('ids').map(String).filter(Boolean);
    const status = String(fd.get('status') ?? '') as 'active' | 'complete' | 'cancelled';

    if (ids.length === 0) return { ok: false, error: 'לא נבחרו תוכניות' };
    if (!['active', 'complete', 'cancelled'].includes(status)) return { ok: false, error: 'סטטוס לא תקין' };

    const actualEndMonth = status === 'complete' ? new Date().toISOString().slice(0, 7) : null;

    await db
      .update(schema.installmentPlans)
      .set({ status, ...(actualEndMonth ? { actualEndMonth } : { actualEndMonth: null }) })
      .where(and(
        inArray(schema.installmentPlans.id, ids),
        eq(schema.installmentPlans.householdId, householdId),
      ));

    revalidatePath('/installments');
    return { ok: true };
  } catch (e) {
    console.error('bulkUpdateStatus', e);
    return { ok: false, error: 'שגיאה בעדכון סטטוס' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVANCE PAYMENT (increment currentPaymentNo by 1)
// ─────────────────────────────────────────────────────────────────────────────

export async function advancePayment(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();

    const [plan] = await db
      .select()
      .from(schema.installmentPlans)
      .where(and(
        eq(schema.installmentPlans.id, id),
        eq(schema.installmentPlans.householdId, householdId),
      ))
      .limit(1);

    if (!plan) return { ok: false, error: 'תוכנית לא נמצאה' };

    const newNo = plan.currentPaymentNo + 1;
    // currentPaymentNo represents payments paid so far. When newNo equals
    // totalPayments we've just recorded the LAST payment → plan is complete.
    // (Earlier this used `>` which only triggered if the user advanced past
    // the total — but the UI's advance button is hidden once current ===
    // total, so the auto-complete never fired and plans got stuck "active".)
    const isComplete = plan.totalPayments !== null && newNo >= plan.totalPayments;

    await db
      .update(schema.installmentPlans)
      .set({
        currentPaymentNo: newNo,
        status:           isComplete ? 'complete' : plan.status,
        actualEndMonth:   isComplete ? new Date().toISOString().slice(0, 7) : plan.actualEndMonth,
      })
      .where(eq(schema.installmentPlans.id, id));

    revalidatePath('/installments');
    return { ok: true };
  } catch (e) {
    console.error('advancePayment', e);
    return { ok: false, error: 'שגיאה בעדכון מספר תשלום' };
  }
}
