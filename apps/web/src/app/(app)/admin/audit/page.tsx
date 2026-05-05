import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { and, eq, desc } from 'drizzle-orm';
import { formatDateHe } from '@fba/shared';

export const dynamic = 'force-dynamic';

const ACTION_LABEL: Record<string, string> = {
  create: 'יצירה',
  update: 'עדכון',
  delete: 'מחיקה',
  restore: 'שחזור',
  login: 'כניסה',
  logout: 'יציאה',
  scrape: 'גריפה',
  import: 'ייבוא',
};

const ENTITY_LABEL: Record<string, string> = {
  transaction: 'תנועה',
  category: 'קטגוריה',
  rule: 'כלל',
  account: 'חשבון',
  auth: 'הרשאה',
  import_session: 'ייבוא',
};

export default async function AuditPage(props: {
  searchParams: Promise<{ entity?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const sp = await props.searchParams;
  const entityFilter = sp.entity ?? '';
  const page = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const { householdId } = session.user;

  const where = entityFilter
    ? and(eq(schema.auditLog.householdId, householdId), eq(schema.auditLog.entityType, entityFilter))
    : eq(schema.auditLog.householdId, householdId);

  const rows = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      entityType: schema.auditLog.entityType,
      entityId: schema.auditLog.entityId,
      createdAt: schema.auditLog.createdAt,
      actorUserId: schema.auditLog.actorUserId,
    })
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(pageSize)
    .offset(offset);

  const entityTypes = ['transaction', 'category', 'rule', 'account', 'auth', 'import_session'];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">יומן ביקורת</h1>
          <p className="text-sm text-muted-foreground">כל הפעולות שבוצעו על הנתונים</p>
        </div>
      </header>

      {/* ── Entity filter tabs ── */}
      <div className="flex flex-wrap gap-1.5">
        <a
          href="/admin/audit"
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !entityFilter
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/70'
          }`}
        >
          הכל
        </a>
        {entityTypes.map((e) => (
          <a
            key={e}
            href={`/admin/audit?entity=${e}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              entityFilter === e
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {ENTITY_LABEL[e] ?? e}
          </a>
        ))}
      </div>

      {/* ── Table ── */}
      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">אין רשומות יומן לתצוגה</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <table className="min-w-full text-sm" dir="rtl">
            <thead className="bg-muted/40 text-right">
              <tr>
                <th className="border-b px-3 py-2 font-medium">תאריך ושעה</th>
                <th className="border-b px-3 py-2 font-medium">פעולה</th>
                <th className="border-b px-3 py-2 font-medium">סוג ישות</th>
                <th className="border-b px-3 py-2 font-medium text-muted-foreground">מזהה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleString('he-IL', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.action === 'delete'
                          ? 'bg-destructive/10 text-destructive'
                          : row.action === 'create'
                            ? 'bg-success/10 text-success'
                            : row.action === 'restore'
                              ? 'bg-accent/20 text-accent'
                              : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {ACTION_LABEL[row.action ?? ''] ?? row.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ENTITY_LABEL[row.entityType] ?? row.entityType}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground/60 truncate max-w-xs">
                    {row.entityId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {rows.length === pageSize && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <a
              href={`/admin/audit?entity=${entityFilter}&page=${page - 1}`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              הקודם
            </a>
          )}
          <a
            href={`/admin/audit?entity=${entityFilter}&page=${page + 1}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            הבא
          </a>
        </div>
      )}
    </div>
  );
}
