import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { formatIls } from '@fba/shared';
import { Repeat } from 'lucide-react';
import { RecurringList } from './recurring-list';

export const dynamic = 'force-dynamic';

export default async function RecurringPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;

  const [patterns, cats, patternIdsWithNotificationsRaw] = await Promise.all([
    db
      .select({
        id:                 schema.recurringPatterns.id,
        merchantNormalized: schema.recurringPatterns.merchantNormalized,
        description:        schema.recurringPatterns.description,
        categoryId:         schema.recurringPatterns.categoryId,
        amountMode:         schema.recurringPatterns.amountMode,
        expectedAmountIls:  schema.recurringPatterns.expectedAmountIls,
        minAmountIls:       schema.recurringPatterns.minAmountIls,
        maxAmountIls:       schema.recurringPatterns.maxAmountIls,
        frequency:          schema.recurringPatterns.frequency,
        occurrenceCount:    schema.recurringPatterns.occurrenceCount,
        lastSeenMonth:      schema.recurringPatterns.lastSeenMonth,
        status:             schema.recurringPatterns.status,
        subscriptionEndDate: schema.recurringPatterns.subscriptionEndDate,
        autoRenew:          schema.recurringPatterns.autoRenew,
        cancelNoticeDays:   schema.recurringPatterns.cancelNoticeDays,
        notes:              schema.recurringPatterns.notes,
      })
      .from(schema.recurringPatterns)
      .where(eq(schema.recurringPatterns.householdId, householdId))
      .orderBy(schema.recurringPatterns.expectedAmountIls),
    db
      .select({ id: schema.categories.id, nameHe: schema.categories.nameHe, color: schema.categories.color })
      .from(schema.categories)
      .where(eq(schema.categories.householdId, householdId))
      .orderBy(schema.categories.sortOrder),
    // Recurring patterns that already have at least one (non-completed,
    // non-cancelled) notification task attached. Drives the colored bell
    // on each row so the user can see which subscriptions already have a
    // reminder in place.
    db
      .select({ recurringPatternId: schema.notificationTasks.recurringPatternId })
      .from(schema.notificationTasks)
      .where(
        and(
          eq(schema.notificationTasks.householdId, householdId),
          isNotNull(schema.notificationTasks.recurringPatternId),
          ne(schema.notificationTasks.status, 'completed'),
          ne(schema.notificationTasks.status, 'cancelled'),
        ),
      ),
  ]);
  const patternIdsWithNotifications = Array.from(
    new Set(
      patternIdsWithNotificationsRaw
        .map((r) => r.recurringPatternId)
        .filter((id): id is string => id !== null),
    ),
  );

  // Household contacts for the per-row "set reminder" modal recipient picker.
  const notificationContacts = await db
    .select({
      id:        schema.notificationContacts.id,
      label:     schema.notificationContacts.label,
      phoneE164: schema.notificationContacts.phoneE164,
      email:     schema.notificationContacts.email,
      isDefault: schema.notificationContacts.isDefault,
    })
    .from(schema.notificationContacts)
    .where(eq(schema.notificationContacts.householdId, householdId))
    .orderBy(schema.notificationContacts.label);

  // ── Summary tile math ────────────────────────────────────────────────────
  //
  // We want every tile to answer the question "what's my fixed monthly cash
  // flow right now". A few subtleties:
  //
  // 1. Non-monthly frequencies (bimonthly / quarterly / yearly) must be
  //    amortized to a monthly equivalent. A ₪6,000/year subscription contri-
  //    butes ₪500/month to monthly fixed expense. Previously the tiles hard-
  //    filtered to `frequency === 'monthly'` and silently dropped everything
  //    else — anything yearly was invisible.
  //
  // 2. Patterns whose `subscription_end_date` has already passed but are
  //    still `status='active'` (user forgot to mark them ended) are NOT
  //    really active any more — they shouldn't be summed. We exclude them
  //    from BOTH the sums and the active count, so the count and the totals
  //    refer to the same set of patterns.
  //
  // 3. Dynamic-amount patterns have expectedAmountIls=0 — they silently
  //    contribute 0 to the sums. That's accepted (we surface their count in
  //    a caption so the user knows a few patterns aren't measured here).
  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD

  const FREQ_MONTHLY_FACTOR: Record<string, number> = {
    monthly:   1,
    bimonthly: 1 / 2,
    quarterly: 1 / 3,
    yearly:    1 / 12,
  };
  function monthlyAmountFor(p: typeof patterns[number]): number {
    const factor = FREQ_MONTHLY_FACTOR[p.frequency] ?? 1;
    return Math.abs(Number(p.expectedAmountIls)) * factor;
  }
  function isExpired(p: typeof patterns[number]): boolean {
    return p.subscriptionEndDate != null && p.subscriptionEndDate < todayIso;
  }

  const dbActive    = patterns.filter((p) => p.status === 'active');
  const active      = dbActive.filter((p) => !isExpired(p));
  const dynamicCount = active.filter((p) => p.amountMode === 'dynamic').length;

  const monthlyExpense = active
    .filter((p) => Number(p.expectedAmountIls) < 0)
    .reduce((s, p) => s + monthlyAmountFor(p), 0);
  const monthlyIncome = active
    .filter((p) => Number(p.expectedAmountIls) > 0)
    .reduce((s, p) => s + monthlyAmountFor(p), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">הוצאות קבועות</h1>
        <p className="text-sm text-muted-foreground">
          תבניות תנועות חוזרות — תשלומים שאתה מצפה להן בכל חודש (משכנתא, ארנונה, מנויים וכד׳)
        </p>
      </header>

      {/* Summary tiles — only show when we have data */}
      {patterns.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="tile">
            <p className="text-xs text-muted-foreground">הוצאות קבועות חודשיות</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatIls(monthlyExpense, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">הכנסות קבועות חודשיות</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-success">
              {formatIls(monthlyIncome, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">תזרים נטו צפוי</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatIls(monthlyIncome - monthlyExpense, { decimals: false })}
            </p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">תבניות פעילות</p>
            <p className="mt-1 text-xl font-semibold flex items-center gap-2">
              <Repeat className="size-4 text-muted-foreground" />
              {active.length}
            </p>
            {dynamicCount > 0 && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                {dynamicCount} בסכום דינמי · לא נכלל בסיכום
              </p>
            )}
          </div>
        </div>
      )}

      <RecurringList
        patterns={patterns}
        categories={cats}
        patternIdsWithNotifications={patternIdsWithNotifications}
        notificationContacts={notificationContacts}
      />
    </div>
  );
}
