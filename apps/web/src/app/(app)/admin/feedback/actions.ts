'use server';

/**
 * Feedback CRUD + export.
 *
 * The widget calls `createFeedback` from any page; the admin page calls
 * `listFeedback` / `setFeedbackStatus` / `deleteFeedback` / `exportFeedbackMarkdown`.
 *
 * Export format is Markdown deliberately — pasteable straight into a
 * Claude Code session, an issue tracker, or an email.
 */

import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

type Category = 'bug' | 'ux' | 'feature' | 'other';
type Status   = 'open' | 'in_progress' | 'pending_validation' | 'resolved' | 'dismissed';

const CATEGORY_HE: Record<Category, string> = {
  bug:     'באג',
  ux:      'UX / נראות',
  feature: 'פיצ׳ר חדש',
  other:   'אחר',
};
const STATUS_HE: Record<Status, string> = {
  open:               'פתוח',
  in_progress:        'בעבודה',
  pending_validation: 'ממתין לאימות',
  resolved:           'נפתר',
  dismissed:          'נדחה',
};

async function ctx() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, userId: session.user.id, db: getDb() };
}

/**
 * Called by the floating widget on any page. Captures `pagePath` +
 * `userAgent` for context — both optional.
 */
export async function createFeedback(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, userId, db } = await ctx();
    const message = String(formData.get('message') ?? '').trim();
    if (!message) return { ok: false, error: 'נא להזין טקסט' };
    const category = (String(formData.get('category') ?? 'other') as Category);
    if (!['bug', 'ux', 'feature', 'other'].includes(category)) {
      return { ok: false, error: 'קטגוריה לא תקינה' };
    }
    // Screenshot is an optional base64 data URI (e.g. "data:image/png;base64,iVBORw...").
    // Cap at ~5MB to keep DB rows manageable.
    const screenshotRaw = String(formData.get('screenshotData') ?? '').trim();
    const screenshotData = screenshotRaw && screenshotRaw.startsWith('data:image/') && screenshotRaw.length < 5_000_000
      ? screenshotRaw
      : null;
    await db.insert(schema.feedback).values({
      householdId,
      actorUserId: userId,
      category,
      message,
      pagePath:  String(formData.get('pagePath')  ?? '').trim() || null,
      userAgent: String(formData.get('userAgent') ?? '').trim() || null,
      screenshotData,
    });
    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (e) {
    console.error('createFeedback', e);
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}

export interface FeedbackRow {
  id:             string;
  category:       Category;
  message:        string;
  pagePath:       string | null;
  userAgent:      string | null;
  status:         Status;
  /** Optional base64 PNG data URI captured via the camera button in the
   *  feedback widget. NULL when feedback was submitted text-only. */
  screenshotData: string | null;
  resolvedAt:     string | null;
  createdAt:      string;
}

export async function listFeedback(): Promise<FeedbackRow[]> {
  const { householdId, db } = await ctx();
  const rows = await db
    .select({
      id:             schema.feedback.id,
      category:       schema.feedback.category,
      message:        schema.feedback.message,
      pagePath:       schema.feedback.pagePath,
      userAgent:      schema.feedback.userAgent,
      status:         schema.feedback.status,
      screenshotData: schema.feedback.screenshotData,
      resolvedAt:     schema.feedback.resolvedAt,
      createdAt:      schema.feedback.createdAt,
    })
    .from(schema.feedback)
    .where(eq(schema.feedback.householdId, householdId))
    .orderBy(desc(schema.feedback.createdAt));
  return rows.map((r) => ({
    ...r,
    category:   r.category as Category,
    status:     r.status as Status,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt:  r.createdAt.toISOString(),
  }));
}

export async function updateFeedback(
  id: string,
  message: string,
  category: Category,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await ctx();
    const trimmed = message.trim();
    if (!trimmed) return { ok: false, error: 'נא להזין טקסט' };
    if (!['bug', 'ux', 'feature', 'other'].includes(category)) {
      return { ok: false, error: 'קטגוריה לא תקינה' };
    }
    await db
      .update(schema.feedback)
      .set({ message: trimmed, category })
      .where(and(
        eq(schema.feedback.id, id),
        eq(schema.feedback.householdId, householdId),
      ));
    revalidatePath('/admin/feedback');
    return { ok: true };
  } catch (e) {
    console.error('updateFeedback', e);
    return { ok: false, error: e instanceof Error ? e.message : 'שגיאה' };
  }
}

export async function setFeedbackStatus(id: string, status: Status): Promise<{ ok: boolean }> {
  const { householdId, db } = await ctx();
  await db
    .update(schema.feedback)
    .set({
      // resolvedAt is only set on terminal states; pending_validation/in_progress
      // shouldn't stamp it (the item isn't actually resolved yet).
      status,
      resolvedAt: (status === 'resolved' || status === 'dismissed') ? new Date() : null,
    })
    .where(and(
      eq(schema.feedback.id, id),
      eq(schema.feedback.householdId, householdId),
    ));
  revalidatePath('/admin/feedback');
  return { ok: true };
}

export async function deleteFeedback(id: string): Promise<{ ok: boolean }> {
  const { householdId, db } = await ctx();
  await db
    .delete(schema.feedback)
    .where(and(
      eq(schema.feedback.id, id),
      eq(schema.feedback.householdId, householdId),
    ));
  revalidatePath('/admin/feedback');
  return { ok: true };
}

/**
 * Render all OPEN + IN_PROGRESS feedback as a single Markdown blob.
 * Designed to be copy-pasted into a Claude Code session ("here's what
 * needs fixing — pick anything from this list").
 *
 * Optional `includeStatuses` lets the admin export resolved items too
 * (e.g., to keep a history of past fixes).
 */
export async function exportFeedbackMarkdown(includeStatuses: Status[] = ['open', 'in_progress', 'pending_validation']): Promise<string> {
  const { householdId, db } = await ctx();
  const rows = await db
    .select({
      category:   schema.feedback.category,
      message:    schema.feedback.message,
      pagePath:   schema.feedback.pagePath,
      status:     schema.feedback.status,
      createdAt:  schema.feedback.createdAt,
    })
    .from(schema.feedback)
    .where(eq(schema.feedback.householdId, householdId))
    .orderBy(desc(schema.feedback.createdAt));

  const filtered = rows.filter((r) => includeStatuses.includes(r.status as Status));
  if (filtered.length === 0) {
    return '# פידבק\n\n_אין פריטים לייצא._\n';
  }

  const lines: string[] = [];
  lines.push(`# פידבק — Family Budget App`);
  lines.push(`_ייצוא: ${new Date().toLocaleString('he-IL')}_`);
  lines.push(`_${filtered.length} פריטים בסטטוסים: ${includeStatuses.map((s) => STATUS_HE[s]).join(', ')}_`);
  lines.push('');

  // Group by category for easier scanning
  const byCategory = new Map<Category, typeof filtered>();
  for (const r of filtered) {
    const c = r.category as Category;
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(r);
  }
  for (const cat of (['bug', 'ux', 'feature', 'other'] as const)) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`## ${CATEGORY_HE[cat]} (${items.length})`);
    lines.push('');
    for (const r of items) {
      const date = r.createdAt.toISOString().slice(0, 16).replace('T', ' ');
      const where = r.pagePath ? ` · עמוד: \`${r.pagePath}\`` : '';
      const status = r.status !== 'open' ? ` · סטטוס: ${STATUS_HE[r.status as Status]}` : '';
      lines.push(`### ${date}${where}${status}`);
      lines.push('');
      // Indent message body so multi-line messages stay readable
      lines.push(r.message.split('\n').map((l) => l.trim()).filter(Boolean).join('\n\n'));
      lines.push('');
    }
  }
  return lines.join('\n');
}
