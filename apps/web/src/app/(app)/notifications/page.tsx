/**
 * /notifications — task list with reminders, bulk actions, add/edit modal.
 *
 * Server component: fetches the household's notification tasks (with their
 * reminders flattened into a JSON aggregate so we don't N+1 the page) and
 * hands them to the client list. Categories + a small recent-transactions
 * list seed the modal dropdowns.
 */

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { eq, sql, desc, and, isNull } from 'drizzle-orm';
import { Bell, Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { NotificationsList, type NotificationRowData } from './notifications-list';
import { listContacts, setNotificationStatus } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ done?: string }>;
}

export default async function NotificationsPage(props: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { householdId } = session.user;
  const db = getDb();

  // Handle ?done=<taskId> — fired by "Mark done" links in notification emails
  // and by the bell dropdown's checkmark button. Idempotent: re-clicking a
  // link from an old email is harmless (the action just sets status='completed'
  // again). After processing we redirect to the clean URL so back-nav doesn't
  // re-run the action.
  const sp = await props.searchParams;
  if (sp.done) {
    await setNotificationStatus(sp.done, 'completed');
    redirect('/notifications?completed=1');
  }

  // Tasks + reminders in one query via jsonb_agg. Returns one row per task
  // with the reminders array embedded.
  const taskRowsRaw = await db.execute<{
    id: string;
    title: string;
    description: string | null;
    due_date: string;
    status: string;
    recurrence: string;
    category_id: string | null;
    transaction_id: string | null;
    recurring_pattern_id: string | null;
    recurring_pattern_label: string | null;
    created_at: string;
    reminders: unknown;
  }>(sql`
    SELECT
      t.id, t.title, t.description, t.due_date, t.status, t.recurrence,
      t.category_id, t.transaction_id, t.recurring_pattern_id,
      rp.merchant_normalized AS recurring_pattern_label,
      t.created_at,
      coalesce(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id',                  r.id,
            'offsetDays',          r.offset_days,
            'fireTime',            to_char(r.fire_time, 'HH24:MI'),
            'channels',            r.channels,
            'recipientContactIds', r.recipient_contact_ids,
            'enabled',             r.enabled
          ) ORDER BY r.offset_days DESC, r.fire_time)
          FROM notification_reminder r WHERE r.task_id = t.id
        ),
        '[]'::jsonb
      ) AS reminders
    FROM notification_task t
    LEFT JOIN recurring_pattern rp ON rp.id = t.recurring_pattern_id
    WHERE t.household_id = ${householdId}
    ORDER BY
      CASE t.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      t.due_date ASC
  `);

  const tasks: NotificationRowData[] = taskRowsRaw.map((r) => ({
    id:                    r.id,
    title:                 r.title,
    description:           r.description,
    dueDate:               r.due_date,
    status:                r.status as NotificationRowData['status'],
    recurrence:            r.recurrence as NotificationRowData['recurrence'],
    categoryId:            r.category_id,
    transactionId:         r.transaction_id,
    recurringPatternId:    r.recurring_pattern_id,
    recurringPatternLabel: r.recurring_pattern_label,
    reminders: Array.isArray(r.reminders)
      ? (r.reminders as NotificationRowData['reminders'])
      : [],
  }));

  // Categories for the modal dropdown.
  const cats = await db
    .select({ id: schema.categories.id, nameHe: schema.categories.nameHe, color: schema.categories.color })
    .from(schema.categories)
    .where(eq(schema.categories.householdId, householdId))
    .orderBy(schema.categories.sortOrder);

  // Household contacts for the modal's recipient picker.
  const contacts = await listContacts();

  // Recent transactions (last 60 days, non-deleted, non-projected) so the
  // user can attach a reminder to one without leaving the page.
  const recentTxns = await db
    .select({
      id:       schema.transactions.id,
      merchant: schema.transactions.merchantNormalized,
      amount:   schema.transactions.amountIls,
      date:     schema.transactions.transactionDate,
    })
    .from(schema.transactions)
    .where(and(
      eq(schema.transactions.householdId, householdId),
      isNull(schema.transactions.deletedAt),
      eq(schema.transactions.isProjected, false),
    ))
    .orderBy(desc(schema.transactions.transactionDate))
    .limit(100);

  const stats = {
    active:    tasks.filter((t) => t.status === 'active').length,
    paused:    tasks.filter((t) => t.status === 'paused').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
  };

  return (
    <div className="space-y-6" dir="rtl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="size-5 text-accent" aria-hidden />
            התראות ותזכורות
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            תזכורות לתשלומים ומשימות תקציביות — הגדירי מתי, איך ולכמה ערוצים שתרצי
          </p>
        </div>
        <Link
          href="/settings/notifications"
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/40"
        >
          <SettingsIcon className="size-3.5" />
          הגדרות שליחה
        </Link>
      </header>

      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-w-md">
          <div className="tile">
            <p className="text-xs text-muted-foreground">פעילות</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-success">{stats.active}</p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">מושהות</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-warning">{stats.paused}</p>
          </div>
          <div className="tile">
            <p className="text-xs text-muted-foreground">הושלמו</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">{stats.completed}</p>
          </div>
        </div>
      )}

      <NotificationsList
        tasks={tasks}
        categories={cats.map((c) => ({ id: c.id, nameHe: c.nameHe, color: c.color }))}
        contacts={contacts}
        recentTransactions={recentTxns.map((t) => ({
          id: t.id,
          merchant: t.merchant,
          amount: Number(t.amount),
          date: t.date,
        }))}
      />
    </div>
  );
}
