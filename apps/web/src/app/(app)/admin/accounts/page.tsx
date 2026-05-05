import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { AccountsClient } from './client';
import type { AccountRow } from './client';

export const dynamic = 'force-dynamic';

export default async function AccountsAdminPage() {
  const session = await auth();
  const householdId = session!.user.householdId;
  const db = getDb();

  const accounts = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      type: schema.accounts.type,
      purpose: schema.accounts.purpose,
      institution: schema.accounts.institution,
      accountNumberMasked: schema.accounts.accountNumberMasked,
      paymentSchedule: schema.accounts.paymentSchedule,
      cutoffDay: schema.accounts.cutoffDay,
      chargeDay: schema.accounts.chargeDay,
      isActive: schema.accounts.isActive,
      currency: schema.accounts.currency,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, householdId))
    .orderBy(schema.accounts.name);

  const txnStats = await db
    .select({
      accountId: schema.transactions.accountId,
      txnCount: count(schema.transactions.id),
      txnTotal: sql<string>`coalesce(sum(${schema.transactions.amountIls}), 0)`,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, householdId),
        eq(schema.transactions.isProjected, false),
      ),
    )
    .groupBy(schema.transactions.accountId);
  const statsById = new Map(txnStats.map((s) => [s.accountId, s]));

  const rows: AccountRow[] = accounts.map((a) => {
    const stats = statsById.get(a.id);
    return {
      ...a,
      txnCount: stats?.txnCount ?? 0,
      txnTotal: Number(stats?.txnTotal ?? 0),
      // The auto-created "manual" account is system-managed
      isSystem: a.institution === 'manual',
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">ניהול חשבונות</h1>
        <p className="text-sm text-muted-foreground">
          הגדר חשבונות בנק וכרטיסי אשראי, כולל מחזור החיוב שלהם (יום גזירה, יום חיוב).
          ההגדרות משפיעות על שיוך תנועות לחודש הנכון בלוח המחוונים.
        </p>
      </header>

      <AccountsClient initialAccounts={rows} />

      {/* Info card */}
      <section className="tile space-y-3 border-accent/40 bg-accent-soft/40 text-sm">
        <p className="font-medium text-accent">כיצד עובד מחזור החיוב?</p>
        <div className="space-y-2 text-muted-foreground text-xs leading-relaxed">
          <p>
            <strong>מיידי (בנק / חיוב ישיר)</strong> — תשלומי משכנתא, העברות, משיכות מזומן.
            כל תנועה נספרת בחודש שבו התבצעה, בלי קשר לתאריך.
          </p>
          <p>
            <strong>חיוב חודשי (כרטיס אשראי)</strong> — עסקאות שנאגרות ומחויבות ביחד ביום קבוע.
            <br />
            <em>יום גזירה = 10</em>: עסקאות 1–10 בחודש → חיוב באותו חודש.
            עסקאות 11–31 → חיוב בחודש הבא ב-10.
          </p>
          <p>
            <strong>ייעוד</strong> — &quot;אישי&quot; / &quot;עסקי&quot; / &quot;משותף&quot; קובע
            באיזו תצוגת לוח המחוונים יוצג החשבון.
          </p>
        </div>
      </section>
    </div>
  );
}
