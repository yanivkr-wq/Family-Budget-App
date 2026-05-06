'use server';

/**
 * CRUD server actions for recurring expense patterns.
 *
 * Note on expected_amount_ils:
 *   • Negative for expenses (-1500 = ₪1,500 outflow per cycle)
 *   • Positive for incomes (+12000 = ₪12,000 salary inflow per cycle)
 * The form uses a sign-toggle dropdown ("הוצאה" / "הכנסה") to set this — the
 * user just types a positive number.
 */

import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

interface ParsedForm {
  merchant:    string;
  description: string | null; // human-readable label (e.g., "Spotify Family")
  categoryId:  string | null;
  amount:      number;       // unsigned magnitude — required for 'fixed' / 'range', ignored for 'dynamic'
  sign:        'expense' | 'income';
  frequency:   'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  status:      'active' | 'paused' | 'ended';
  notes:       string | null;
  amountMode:  'fixed' | 'range' | 'dynamic';
  minAmount:   number | null; // for 'range' mode only
  maxAmount:   number | null;
}

function parseForm(fd: FormData): ParsedForm {
  const numOrNull = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const s = String(v).replace(/,/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    merchant:    String(fd.get('merchant') ?? '').trim(),
    description: ((fd.get('description') as string | null) ?? '').trim() || null,
    categoryId:  (fd.get('categoryId') as string | null) || null,
    amount:      Number(String(fd.get('amount') ?? '').replace(/,/g, '')),
    sign:        (fd.get('sign') as 'expense' | 'income') ?? 'expense',
    frequency:   (fd.get('frequency') as ParsedForm['frequency']) ?? 'monthly',
    status:      (fd.get('status') as ParsedForm['status']) ?? 'active',
    notes:       ((fd.get('notes') as string | null) ?? '').trim() || null,
    amountMode:  (fd.get('amountMode') as ParsedForm['amountMode']) ?? 'fixed',
    minAmount:   numOrNull(fd.get('minAmount')),
    maxAmount:   numOrNull(fd.get('maxAmount')),
  };
}

async function requireHousehold() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, db: getDb() };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

export async function createRecurringPattern(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const f = parseForm(fd);

    if (!f.merchant) return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    // Amount validation depends on mode:
    //   • fixed  → amount required, > 0
    //   • range  → min + max required, min ≤ max
    //   • dynamic → no amount validation (we store 0 as placeholder)
    if (f.amountMode === 'fixed' && (!Number.isFinite(f.amount) || f.amount <= 0)) {
      return { ok: false, error: 'סכום צפוי חייב להיות חיובי' };
    }
    if (f.amountMode === 'range') {
      if (f.minAmount === null || f.maxAmount === null) {
        return { ok: false, error: 'יש להזין מינימום ומקסימום למצב טווח' };
      }
      if (f.minAmount > f.maxAmount) {
        return { ok: false, error: 'מינימום חייב להיות ≤ מקסימום' };
      }
    }

    // For 'fixed' use the amount; for 'range' use the midpoint as the
    // representative amount; for 'dynamic' use 0 as a placeholder.
    const representative =
      f.amountMode === 'fixed'   ? f.amount
      : f.amountMode === 'range' ? ((f.minAmount! + f.maxAmount!) / 2)
      :                            0;
    const signed = f.sign === 'income' ? Math.abs(representative) : -Math.abs(representative);
    const month  = currentMonth();

    await db.insert(schema.recurringPatterns).values({
      householdId,
      merchantNormalized: f.merchant,
      ...(f.description ? { description: f.description } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      amountMode:         f.amountMode,
      expectedAmountIls:  String(signed),
      medianAmountIls:    String(signed),
      ...(f.amountMode === 'range' && f.minAmount !== null
        ? { minAmountIls: String(f.sign === 'income' ? f.minAmount : -f.minAmount) }
        : {}),
      ...(f.amountMode === 'range' && f.maxAmount !== null
        ? { maxAmountIls: String(f.sign === 'income' ? f.maxAmount : -f.maxAmount) }
        : {}),
      tolerancePct:       10,
      frequency:          f.frequency,
      occurrenceCount:    0,
      firstSeenMonth:     month,
      lastSeenMonth:      month,
      status:             f.status,
      ...(f.notes ? { notes: f.notes } : {}),
    });

    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    // Likely the unique(householdId, merchantNormalized) constraint fired.
    if (e instanceof Error && e.message.includes('unique')) {
      return { ok: false, error: 'תבנית עבור בית עסק זה כבר קיימת' };
    }
    console.error('createRecurringPattern', e);
    return { ok: false, error: 'שגיאה ביצירת תבנית' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export async function updateRecurringPattern(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const id = String(fd.get('id') ?? '').trim();
    if (!id) return { ok: false, error: 'מזהה תבנית חסר' };

    const f = parseForm(fd);
    if (!f.merchant) return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    if (f.amountMode === 'fixed' && (!Number.isFinite(f.amount) || f.amount <= 0)) {
      return { ok: false, error: 'סכום צפוי חייב להיות חיובי' };
    }
    if (f.amountMode === 'range') {
      if (f.minAmount === null || f.maxAmount === null) {
        return { ok: false, error: 'יש להזין מינימום ומקסימום למצב טווח' };
      }
      if (f.minAmount > f.maxAmount) {
        return { ok: false, error: 'מינימום חייב להיות ≤ מקסימום' };
      }
    }

    const representative =
      f.amountMode === 'fixed'   ? f.amount
      : f.amountMode === 'range' ? ((f.minAmount! + f.maxAmount!) / 2)
      :                            0;
    const signed = f.sign === 'income' ? Math.abs(representative) : -Math.abs(representative);

    await db
      .update(schema.recurringPatterns)
      .set({
        merchantNormalized: f.merchant,
        description:        f.description,
        categoryId:         f.categoryId,
        amountMode:         f.amountMode,
        expectedAmountIls:  String(signed),
        medianAmountIls:    String(signed),
        // Always set min/max — null when not in range mode so switching
        // away from range clears stale bounds.
        minAmountIls:
          f.amountMode === 'range' && f.minAmount !== null
            ? String(f.sign === 'income' ? f.minAmount : -f.minAmount)
            : null,
        maxAmountIls:
          f.amountMode === 'range' && f.maxAmount !== null
            ? String(f.sign === 'income' ? f.maxAmount : -f.maxAmount)
            : null,
        frequency:          f.frequency,
        status:             f.status,
        notes:              f.notes,
        updatedAt:          new Date(),
      })
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));

    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    console.error('updateRecurringPattern', e);
    return { ok: false, error: 'שגיאה בעדכון תבנית' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteRecurringPattern(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    await db
      .delete(schema.recurringPatterns)
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));
    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    console.error('deleteRecurringPattern', e);
    return { ok: false, error: 'שגיאה במחיקת תבנית' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS — quick-toggle (active / paused / ended) without opening the modal.
// ─────────────────────────────────────────────────────────────────────────────

export async function setRecurringStatus(
  id: string,
  status: 'active' | 'paused' | 'ended',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    await db
      .update(schema.recurringPatterns)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));
    revalidatePath('/recurring');
    return { ok: true };
  } catch (e) {
    console.error('setRecurringStatus', e);
    return { ok: false, error: 'שגיאה בעדכון סטטוס' };
  }
}
