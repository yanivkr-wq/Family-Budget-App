'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth } from '@/lib/auth';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return session.user;
}

function numOrNull(val: FormDataEntryValue | null): string | null {
  if (val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
}

function parseGoalForm(formData: FormData) {
  return {
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim() || null,
    icon: String(formData.get('icon') ?? '').trim() || null,
    color: String(formData.get('color') ?? '').trim() || null,
    targetAmountIls: numOrNull(formData.get('targetAmountIls')),
    currentAmountIls: numOrNull(formData.get('currentAmountIls')) ?? '0',
    monthlyContributionIls: numOrNull(formData.get('monthlyContributionIls')),
    targetDate: String(formData.get('targetDate') ?? '').trim() || null,
    status: String(formData.get('status') ?? 'active') as 'active' | 'paused' | 'completed',
    priority: Number(formData.get('priority') ?? 0),
    notes: String(formData.get('notes') ?? '').trim() || null,
  };
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function createGoal(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; goalId?: string }> {
  const user = await requireSession();
  const db = getDb();
  const f = parseGoalForm(formData);

  if (!f.name) return { ok: false, error: 'שם היעד הוא שדה חובה' };

  const [created] = await db
    .insert(schema.savingGoals)
    .values({
      householdId: user.householdId,
      name: f.name,
      description: f.description,
      icon: f.icon,
      color: f.color,
      targetAmountIls: f.targetAmountIls,
      currentAmountIls: f.currentAmountIls,
      monthlyContributionIls: f.monthlyContributionIls,
      targetDate: f.targetDate,
      status: f.status,
      priority: f.priority,
      notes: f.notes,
    })
    .returning({ id: schema.savingGoals.id });

  revalidatePath('/savings');
  revalidatePath('/');
  return { ok: true, goalId: created!.id };
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function updateGoal(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'חסר מזהה' };

  const f = parseGoalForm(formData);
  if (!f.name) return { ok: false, error: 'שם היעד הוא שדה חובה' };

  const [existing] = await db
    .select({ id: schema.savingGoals.id })
    .from(schema.savingGoals)
    .where(
      and(
        eq(schema.savingGoals.id, id),
        eq(schema.savingGoals.householdId, user.householdId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: 'יעד לא נמצא' };

  await db
    .update(schema.savingGoals)
    .set({
      name: f.name,
      description: f.description,
      icon: f.icon,
      color: f.color,
      targetAmountIls: f.targetAmountIls,
      currentAmountIls: f.currentAmountIls,
      monthlyContributionIls: f.monthlyContributionIls,
      targetDate: f.targetDate,
      status: f.status,
      priority: f.priority,
      notes: f.notes,
      updatedAt: new Date(),
    })
    .where(eq(schema.savingGoals.id, id));

  revalidatePath('/savings');
  revalidatePath('/');
  return { ok: true };
}

// ─── update balance only ──────────────────────────────────────────────────────
// Quick action: just update the current balance without a full edit modal.

export async function updateGoalBalance(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  const rawAmount = formData.get('currentAmountIls');
  if (!id) return { ok: false, error: 'חסר מזהה' };
  const amount = numOrNull(rawAmount);
  if (amount === null) return { ok: false, error: 'סכום לא תקין' };

  await db
    .update(schema.savingGoals)
    .set({ currentAmountIls: amount, updatedAt: new Date() })
    .where(
      and(
        eq(schema.savingGoals.id, id),
        eq(schema.savingGoals.householdId, user.householdId),
      ),
    );

  revalidatePath('/savings');
  revalidatePath('/');
  return { ok: true };
}

// ─── delete ───────────────────────────────────────────────────────────────────

export async function deleteGoal(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  const db = getDb();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'חסר מזהה' };

  await db
    .delete(schema.savingGoals)
    .where(
      and(
        eq(schema.savingGoals.id, id),
        eq(schema.savingGoals.householdId, user.householdId),
      ),
    );

  revalidatePath('/savings');
  revalidatePath('/');
  return { ok: true };
}
