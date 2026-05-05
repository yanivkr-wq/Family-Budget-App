'use server';

import { eq } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';
import { auth, hashPassword, verifyPassword } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function changePassword(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthorized' };

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!current) return { ok: false, error: 'יש להזין את הסיסמה הנוכחית' };
  if (next.length < 8) return { ok: false, error: 'סיסמה חדשה חייבת להכיל לפחות 8 תווים' };
  if (next !== confirm) return { ok: false, error: 'אישור הסיסמה לא תואם' };
  if (next === current) return { ok: false, error: 'הסיסמה החדשה זהה לקיימת' };

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!user) return { ok: false, error: 'משתמש לא נמצא' };

  const ok = await verifyPassword(user.passwordHash, current);
  if (!ok) return { ok: false, error: 'סיסמה נוכחית שגויה' };

  const newHash = await hashPassword(next);
  await db
    .update(schema.users)
    .set({ passwordHash: newHash })
    .where(eq(schema.users.id, user.id));

  await db.insert(schema.auditLog).values({
    householdId: user.householdId,
    actorUserId: user.id,
    action: 'password_change',
    entityType: 'user',
    entityId: user.id,
  });

  return { ok: true };
}
