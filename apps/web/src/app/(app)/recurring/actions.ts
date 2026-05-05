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
  amount:      number;       // unsigned magnitude
  sign:        'expense' | 'income';
  frequency:   'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  status:      'active' | 'paused' | 'ended';
  notes:       string | null;
}

function parseForm(fd: FormData): ParsedForm {
  return {
    merchant:    String(fd.get('merchant') ?? '').trim(),
    description: ((fd.get('description') as string | null) ?? '').trim() || null,
    categoryId:  (fd.get('categoryId') as string | null) || null,
    amount:      Number(String(fd.get('amount') ?? '').replace(/,/g, '')),
    sign:        (fd.get('sign') as 'expense' | 'income') ?? 'expense',
    frequency:   (fd.get('frequency') as ParsedForm['frequency']) ?? 'monthly',
    status:      (fd.get('status') as ParsedForm['status']) ?? 'active',
    notes:       ((fd.get('notes') as string | null) ?? '').trim() || null,
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

    if (!f.merchant)              return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    if (!Number.isFinite(f.amount) || f.amount <= 0) return { ok: false, error: 'סכום צפוי חייב להיות חיובי' };

    const signed = f.sign === 'income' ? Math.abs(f.amount) : -Math.abs(f.amount);
    const month  = currentMonth();

    await db.insert(schema.recurringPatterns).values({
      householdId,
      merchantNormalized: f.merchant,
      ...(f.description ? { description: f.description } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      expectedAmountIls:  String(signed),
      medianAmountIls:    String(signed),
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
    if (!f.merchant)              return { ok: false, error: 'שם בית העסק הוא שדה חובה' };
    if (!Number.isFinite(f.amount) || f.amount <= 0) return { ok: false, error: 'סכום צפוי חייב להיות חיובי' };

    const signed = f.sign === 'income' ? Math.abs(f.amount) : -Math.abs(f.amount);

    await db
      .update(schema.recurringPatterns)
      .set({
        merchantNormalized: f.merchant,
        description:        f.description,
        categoryId:         f.categoryId,
        expectedAmountIls:  String(signed),
        medianAmountIls:    String(signed),
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
