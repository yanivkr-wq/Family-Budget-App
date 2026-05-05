'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth } from '@/lib/auth';

export interface RevertResult {
  ok: boolean;
  revertedCount: number;
  error?: string;
}

/**
 * Revert an import session — soft-delete every transaction created by it.
 * Reversible: sets `deleted_at` on transactions and marks session status='reverted'.
 * The actual rows stay in the DB so a future "Restore" action can clear deleted_at.
 */
export async function revertImportSession(formData: FormData): Promise<RevertResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, revertedCount: 0, error: 'unauthorized' };

  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return { ok: false, revertedCount: 0, error: 'Missing session id' };

  const db = getDb();

  const [imp] = await db
    .select()
    .from(schema.importSessions)
    .where(
      and(
        eq(schema.importSessions.id, sessionId),
        eq(schema.importSessions.householdId, session.user.householdId),
      ),
    )
    .limit(1);
  if (!imp) return { ok: false, revertedCount: 0, error: 'הייבוא לא נמצא' };
  if (imp.status === 'reverted') {
    return { ok: false, revertedCount: 0, error: 'ייבוא זה כבר בוטל' };
  }

  const now = new Date();
  const updated = await db
    .update(schema.transactions)
    .set({ deletedAt: now })
    .where(
      and(
        eq(schema.transactions.householdId, session.user.householdId),
        eq(schema.transactions.importSessionId, sessionId),
        isNull(schema.transactions.deletedAt),
      ),
    )
    .returning({ id: schema.transactions.id });

  await db
    .update(schema.importSessions)
    .set({ status: 'reverted', revertedAt: now, revertedByUserId: session.user.id })
    .where(eq(schema.importSessions.id, sessionId));

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'revert_import',
    entityType: 'import_session',
    entityId: sessionId,
    afterJson: { revertedCount: updated.length, filename: imp.filename } as object,
  });

  revalidatePath('/admin/imports');
  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');

  return { ok: true, revertedCount: updated.length };
}

/** Restore a previously-reverted session — clear deleted_at on its transactions. */
export async function restoreImportSession(formData: FormData): Promise<RevertResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, revertedCount: 0, error: 'unauthorized' };

  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return { ok: false, revertedCount: 0, error: 'Missing session id' };

  const db = getDb();
  const [imp] = await db
    .select()
    .from(schema.importSessions)
    .where(
      and(
        eq(schema.importSessions.id, sessionId),
        eq(schema.importSessions.householdId, session.user.householdId),
      ),
    )
    .limit(1);
  if (!imp || imp.status !== 'reverted') {
    return { ok: false, revertedCount: 0, error: 'ייבוא לא נמצא או לא בוטל' };
  }

  const restored = await db
    .update(schema.transactions)
    .set({ deletedAt: null })
    .where(
      and(
        eq(schema.transactions.householdId, session.user.householdId),
        eq(schema.transactions.importSessionId, sessionId),
      ),
    )
    .returning({ id: schema.transactions.id });

  await db
    .update(schema.importSessions)
    .set({ status: 'committed', revertedAt: null, revertedByUserId: null })
    .where(eq(schema.importSessions.id, sessionId));

  await db.insert(schema.auditLog).values({
    householdId: session.user.householdId,
    actorUserId: session.user.id,
    action: 'restore_import',
    entityType: 'import_session',
    entityId: sessionId,
    afterJson: { restoredCount: restored.length, filename: imp.filename } as object,
  });

  revalidatePath('/admin/imports');
  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');

  return { ok: true, revertedCount: restored.length };
}
