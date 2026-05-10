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
import { and, eq, sql } from 'drizzle-orm';
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
  /** YYYY-MM-DD subscription end date, or null when open-ended. */
  subscriptionEndDate: string | null;
  /** Does the subscription auto-renew? Defaults true (matches column default). */
  autoRenew:           boolean;
  /** Days before end_date the user must cancel by. Defaults 0. */
  cancelNoticeDays:    number;
}

function parseForm(fd: FormData): ParsedForm {
  const numOrNull = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const s = String(v).replace(/,/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  // Date pass-through. Empty string from <input type="date"> becomes NULL on
  // the server (open-ended subscription). We do a light shape check rather
  // than parsing — Postgres will reject anything malformed.
  const dateStr = String(fd.get('subscriptionEndDate') ?? '').trim();
  const subscriptionEndDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
  // Checkbox arrives as '1' / '0' (we encode it that way in the modal).
  // Default to TRUE if missing — matches the schema default and avoids a
  // surprise "auto-renew off" for old form posts.
  const autoRenewStr = String(fd.get('autoRenew') ?? '1');
  const autoRenew = autoRenewStr !== '0';
  const noticeNum = numOrNull(fd.get('cancelNoticeDays'));
  const cancelNoticeDays = noticeNum != null && noticeNum >= 0 ? Math.floor(noticeNum) : 0;
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
    subscriptionEndDate,
    autoRenew,
    cancelNoticeDays,
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
      // Lifecycle: end date / auto-renew / notice. NULL end date = open-ended.
      ...(f.subscriptionEndDate ? { subscriptionEndDate: f.subscriptionEndDate } : {}),
      autoRenew:          f.autoRenew,
      cancelNoticeDays:   f.cancelNoticeDays,
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
        // Always set lifecycle fields — empty form date posts NULL so editors
        // can clear an end date by blanking the input.
        subscriptionEndDate: f.subscriptionEndDate,
        autoRenew:          f.autoRenew,
        cancelNoticeDays:   f.cancelNoticeDays,
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

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE — renew / end the current subscription period.
//
// Used by the "expiring subscriptions" insights card so the user can act on a
// pattern in one click without opening the full edit modal.
// ─────────────────────────────────────────────────────────────────────────────

/** How many months a frequency advances per renewal cycle. */
const FREQ_MONTH_STEP: Record<'monthly' | 'bimonthly' | 'quarterly' | 'yearly', number> = {
  monthly:   1,
  bimonthly: 2,
  quarterly: 3,
  yearly:    12,
};

/**
 * Renew a subscription: push subscription_end_date forward by one cycle of
 * its frequency (month-aware so e.g. Jan 31 + 1 month = Feb 28/29). Re-opens
 * status to 'active' if it was already 'ended', and forces auto_renew=true
 * since the user is explicitly renewing.
 *
 * If the pattern has no end date yet, we anchor the renewal off TODAY rather
 * than refusing — most cases for "renew" are subscriptions the user wants to
 * extend by a fixed period, regardless of whether they had a prior end date.
 */
export async function renewRecurringPattern(
  id: string,
): Promise<{ ok: boolean; error?: string; nextEndDate?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const [row] = await db
      .select({
        frequency: schema.recurringPatterns.frequency,
        endDate:   schema.recurringPatterns.subscriptionEndDate,
      })
      .from(schema.recurringPatterns)
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));

    if (!row) return { ok: false, error: 'תבנית לא נמצאה' };

    const step = FREQ_MONTH_STEP[(row.frequency as keyof typeof FREQ_MONTH_STEP)] ?? 1;
    // Anchor: existing end date if present, else today.
    const anchorStr = row.endDate ?? new Date().toISOString().slice(0, 10);
    const [yStr, mStr, dStr] = anchorStr.split('-');
    const y = Number(yStr);
    const m = Number(mStr); // 1-based
    const d = Number(dStr);
    // JS Date math: month + step. Clamp day to last-day-of-target-month so
    // Jan 31 + 1 month = Feb 28/29 instead of overflowing to March.
    const targetMonth = m + step; // 1-based; can exceed 12, Date handles it
    const lastDayOfTarget = new Date(Date.UTC(y, targetMonth, 0)).getUTCDate();
    const clampedDay = Math.min(d, lastDayOfTarget);
    const next = new Date(Date.UTC(y, targetMonth - 1, clampedDay));
    const nextEndDate = next.toISOString().slice(0, 10);

    await db
      .update(schema.recurringPatterns)
      .set({
        subscriptionEndDate: nextEndDate,
        autoRenew:           true,
        status:              'active',
        updatedAt:           new Date(),
      })
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));

    revalidatePath('/recurring');
    revalidatePath('/insights');
    return { ok: true, nextEndDate };
  } catch (e) {
    console.error('renewRecurringPattern', e);
    return { ok: false, error: 'שגיאה בחידוש מנוי' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SUGGEST — batch-create notification reminders for active recurring
// patterns that don't already have one attached. Used by the "create
// reminders for all my subscriptions" button on /recurring.
// ─────────────────────────────────────────────────────────────────────────────
export async function createReminderForAllPatterns(): Promise<{
  ok: boolean;
  created: number;
  skipped: number;
  error?: string;
}> {
  try {
    const { householdId, db } = await requireHousehold();

    // 1. Load active patterns that DON'T already have a non-completed
    //    notification attached.
    const patterns = await db.execute<{
      id: string;
      merchant: string;
      description: string | null;
      expected_amount_ils: string;
      frequency: string;
      category_id: string | null;
      subscription_end_date: string | null;
      auto_renew: boolean;
      cancel_notice_days: number;
    }>(sql`
      SELECT
        p.id, p.merchant_normalized AS merchant, p.description,
        p.expected_amount_ils, p.frequency, p.category_id,
        p.subscription_end_date, p.auto_renew, p.cancel_notice_days
      FROM recurring_pattern p
      WHERE p.household_id = ${householdId}
        AND p.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM notification_task nt
          WHERE nt.recurring_pattern_id = p.id
            AND nt.household_id = ${householdId}
            AND nt.status NOT IN ('completed','cancelled')
        )
    `);

    if (patterns.length === 0) {
      return { ok: true, created: 0, skipped: 0 };
    }

    // 2. Resolve the household's default contact so the new reminders go to
    //    a sensible recipient out of the box.
    const [defaultContact] = await db
      .select({ id: schema.notificationContacts.id })
      .from(schema.notificationContacts)
      .where(and(
        eq(schema.notificationContacts.householdId, householdId),
        eq(schema.notificationContacts.isDefault, true),
      ));
    const defaultContactId = defaultContact?.id ?? null;

    // 3. Resolve the user (creator) for the new tasks.
    const session = await auth();
    if (!session?.user) return { ok: false, created: 0, skipped: 0, error: 'unauthorized' };
    const userId = session.user.id;

    let created = 0;
    let skipped = 0;
    const today = new Date();

    for (const p of patterns) {
      try {
        const isIncome = Number(p.expected_amount_ils) >= 0;
        const amt = Math.abs(Number(p.expected_amount_ils));
        const freqLabel = FREQ_LABEL_HE[p.frequency] ?? p.frequency;
        const titlePrefix = isIncome ? 'הכנסה צפויה' : 'תשלום';
        const title = `${titlePrefix}: ${p.merchant} · ₪${amt.toLocaleString('he-IL')}`;

        // Due date: end_date if set, else today + N days based on frequency.
        const dueDate = p.subscription_end_date ?? addDaysIso(today, freqDaysAhead(p.frequency));

        // Map pattern frequency to notification recurrence.
        const recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly' =
          p.frequency === 'monthly'   ? 'monthly' :
          p.frequency === 'quarterly' ? 'quarterly' :
          p.frequency === 'yearly'    ? 'yearly' :
                                        'none';

        // Reminder schedule depends on whether there's an end_date (subscription
        // cancellation context wants longer lead time) or not (regular bill).
        const hasEndDate = !!p.subscription_end_date;
        const reminderRows = hasEndDate
          ? [
              { offset: 14, channels: { in_app: true, email: true,  whatsapp: false } },
              { offset: 7,  channels: { in_app: true, email: false, whatsapp: false } },
              { offset: 0,  channels: { in_app: true, email: true,  whatsapp: false } },
            ]
          : [
              { offset: 3, channels: { in_app: true, email: false, whatsapp: false } },
              { offset: 1, channels: { in_app: true, email: true,  whatsapp: false } },
              { offset: 0, channels: { in_app: true, email: false, whatsapp: false } },
            ];

        await db.transaction(async (tx) => {
          const [task] = await tx
            .insert(schema.notificationTasks)
            .values({
              householdId,
              createdByUserId:    userId,
              title,
              description:        `סכום צפוי: ₪${amt.toLocaleString('he-IL')} · תדירות: ${freqLabel}`,
              dueDate,
              status:             'active',
              recurrence,
              categoryId:         p.category_id,
              transactionId:      null,
              recurringPatternId: p.id,
            })
            .returning({ id: schema.notificationTasks.id });
          if (!task) throw new Error('insert_failed');

          await tx.insert(schema.notificationReminders).values(
            reminderRows.map((r) => ({
              taskId:               task.id,
              offsetDays:           r.offset,
              fireTime:             '09:00:00',
              channels:             r.channels,
              recipientContactIds:  defaultContactId ? [defaultContactId] : null,
              enabled:              true,
            })),
          );
        });
        created += 1;
      } catch (e) {
        console.error('createReminderForAllPatterns inner', e);
        skipped += 1;
      }
    }

    revalidatePath('/recurring');
    revalidatePath('/notifications');
    return { ok: true, created, skipped };
  } catch (e) {
    console.error('createReminderForAllPatterns', e);
    return { ok: false, created: 0, skipped: 0, error: 'שגיאה ביצירת התראות' };
  }
}

const FREQ_LABEL_HE: Record<string, string> = {
  monthly:   'חודשי',
  bimonthly: 'דו-חודשי',
  quarterly: 'רבעוני',
  yearly:    'שנתי',
};

function addDaysIso(d: Date, days: number): string {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString().slice(0, 10);
}

function freqDaysAhead(freq: string): number {
  switch (freq) {
    case 'monthly':   return 30;
    case 'bimonthly': return 60;
    case 'quarterly': return 90;
    case 'yearly':    return 365;
    default:          return 30;
  }
}

/**
 * End a subscription: mark status='ended', auto_renew=false, and stamp
 * end_date = today (so the history shows when the user pulled the plug).
 */
export async function endRecurringPattern(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { householdId, db } = await requireHousehold();
    const today = new Date().toISOString().slice(0, 10);
    await db
      .update(schema.recurringPatterns)
      .set({
        status:              'ended',
        autoRenew:           false,
        subscriptionEndDate: today,
        updatedAt:           new Date(),
      })
      .where(and(
        eq(schema.recurringPatterns.id, id),
        eq(schema.recurringPatterns.householdId, householdId),
      ));

    revalidatePath('/recurring');
    revalidatePath('/insights');
    return { ok: true };
  } catch (e) {
    console.error('endRecurringPattern', e);
    return { ok: false, error: 'שגיאה בסיום מנוי' };
  }
}
