'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth } from '@/lib/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireHousehold(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return session.user.householdId;
}

function revalidate() {
  revalidatePath('/admin/categories');
  revalidatePath('/');
  revalidatePath('/grid');
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createCategory(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const householdId = await requireHousehold();
  const db = getDb();

  const nameHe = String(formData.get('nameHe') ?? '').trim();
  if (!nameHe) return { ok: false, error: 'שם קטגוריה חובה' };

  const parentId = (formData.get('parentId') as string | null) || null;
  const color = (formData.get('color') as string | null) || null;
  const icon = (formData.get('icon') as string | null) || null;
  const isIncome = formData.get('isIncome') === 'true';
  const isSavings = formData.get('isSavings') === 'true';
  const monthlyTargetRaw = String(formData.get('monthlyTargetIls') ?? '').trim();
  const monthlyTargetIls =
    monthlyTargetRaw && Number.isFinite(Number(monthlyTargetRaw)) && Number(monthlyTargetRaw) > 0
      ? String(Number(monthlyTargetRaw))
      : null;

  // Validate parentId belongs to household
  if (parentId) {
    const [parent] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, parentId),
          eq(schema.categories.householdId, householdId),
        ),
      )
      .limit(1);
    if (!parent) return { ok: false, error: 'קטגוריית האב לא נמצאה' };
  }

  await db.insert(schema.categories).values({
    householdId,
    nameHe,
    parentId,
    color,
    icon,
    isIncome,
    isSavings,
    monthlyTargetIls,
  });

  revalidate();
  return { ok: true };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateCategory(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const householdId = await requireHousehold();
  const db = getDb();

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'מזהה חסר' };

  const [existing] = await db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.householdId, householdId)))
    .limit(1);
  if (!existing) return { ok: false, error: 'קטגוריה לא נמצאה' };

  const nameHe = String(formData.get('nameHe') ?? '').trim() || existing.nameHe;
  const color =
    (formData.get('color') as string | null) !== null
      ? (formData.get('color') as string) || null
      : existing.color;
  const icon =
    (formData.get('icon') as string | null) !== null
      ? (formData.get('icon') as string) || null
      : existing.icon;
  const isIncome = formData.has('isIncome')
    ? formData.get('isIncome') === 'true'
    : existing.isIncome;
  const isSavings = formData.has('isSavings')
    ? formData.get('isSavings') === 'true'
    : existing.isSavings;
  const isArchived = formData.has('isArchived')
    ? formData.get('isArchived') === 'true'
    : existing.isArchived;
  const sortOrderRaw = formData.has('sortOrder')
    ? Number(formData.get('sortOrder'))
    : existing.sortOrder;
  const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : existing.sortOrder;

  const monthlyTargetRaw = formData.has('monthlyTargetIls')
    ? String(formData.get('monthlyTargetIls') ?? '').trim()
    : null;
  const monthlyTargetIls =
    monthlyTargetRaw !== null
      ? monthlyTargetRaw === '' || Number(monthlyTargetRaw) <= 0
        ? null
        : String(Number(monthlyTargetRaw))
      : existing.monthlyTargetIls;

  await db
    .update(schema.categories)
    .set({ nameHe, color, icon, isIncome, isSavings, isArchived, sortOrder, monthlyTargetIls })
    .where(eq(schema.categories.id, id));

  revalidate();
  return { ok: true };
}

// ─── Delete (archive) ─────────────────────────────────────────────────────────

export async function archiveCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const householdId = await requireHousehold();
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.categories.id, parentId: schema.categories.parentId })
    .from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.householdId, householdId)))
    .limit(1);
  if (!existing) return { ok: false, error: 'קטגוריה לא נמצאה' };

  // Archive all children too
  if (!existing.parentId) {
    await db
      .update(schema.categories)
      .set({ isArchived: true })
      .where(
        and(
          eq(schema.categories.householdId, householdId),
          eq(schema.categories.parentId, id),
        ),
      );
  }

  await db
    .update(schema.categories)
    .set({ isArchived: true })
    .where(eq(schema.categories.id, id));

  revalidate();
  return { ok: true };
}

// ─── Restore (un-archive) ─────────────────────────────────────────────────────

export async function restoreCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const householdId = await requireHousehold();
  const db = getDb();

  await db
    .update(schema.categories)
    .set({ isArchived: false })
    .where(
      and(
        eq(schema.categories.id, id),
        eq(schema.categories.householdId, householdId),
      ),
    );

  revalidate();
  return { ok: true };
}
