import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, eq, inArray, isNull, sum } from 'drizzle-orm';
import { activeBillingMonth } from '@fba/db';
import { SavingsClient, type GoalRow, type MonthlySavingsData } from './client';

export const dynamic = 'force-dynamic';

export default async function SavingsPage() {
  const session = await auth();
  const householdId = session!.user.householdId;
  const db = getDb();

  // ── goals ────────────────────────────────────────────────────────────────────
  const rawGoals = await db
    .select()
    .from(schema.savingGoals)
    .where(eq(schema.savingGoals.householdId, householdId))
    .orderBy(schema.savingGoals.priority, schema.savingGoals.createdAt);

  const goals: GoalRow[] = rawGoals.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    icon: g.icon,
    color: g.color,
    targetAmountIls: g.targetAmountIls !== null ? Number(g.targetAmountIls) : null,
    currentAmountIls: Number(g.currentAmountIls),
    monthlyContributionIls:
      g.monthlyContributionIls !== null ? Number(g.monthlyContributionIls) : null,
    targetDate: g.targetDate,
    status: g.status as GoalRow['status'],
    priority: g.priority,
    notes: g.notes,
  }));

  // ── monthly savings stats ────────────────────────────────────────────────────
  // Find categories flagged as savings categories to show monthly deposit rate
  const savingsCategories = await db
    .select({ id: schema.categories.id, monthlyTargetIls: schema.categories.monthlyTargetIls })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.householdId, householdId),
        eq(schema.categories.isSavings, true),
      ),
    );

  let monthly: MonthlySavingsData | null = null;

  if (savingsCategories.length > 0) {
    const currentMonth = activeBillingMonth(10);
    const catIds = savingsCategories.map((c) => c.id);

    const savingsRows = await db
      .select({ total: sum(schema.transactions.amountIls) })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          eq(schema.transactions.billingMonth, currentMonth),
          eq(schema.transactions.isProjected, false),
          isNull(schema.transactions.deletedAt),
          inArray(schema.transactions.categoryId, catIds),
        ),
      );

    const deposited = Math.abs(Number(savingsRows[0]?.total ?? 0));
    const target = savingsCategories.reduce(
      (s, c) => s + (c.monthlyTargetIls !== null ? Number(c.monthlyTargetIls) : 0),
      0,
    );

    monthly = { month: currentMonth, deposited, target };
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">חיסכון ויעדים</h1>
        <p className="text-sm text-muted-foreground">
          עקוב אחר יעדי החיסכון שלך — קרן חירום, רכב, חופשה, ועוד.
          עדכן את היתרה ידנית כל חודש כשמפקידים.
        </p>
      </header>

      <SavingsClient goals={goals} monthly={monthly} />

      {/* info card */}
      <section className="tile space-y-3 border-accent/40 bg-accent-soft/40 text-sm">
        <p className="font-medium text-accent">איך עובד מודול החיסכון?</p>
        <div className="space-y-2 text-muted-foreground text-xs leading-relaxed">
          <p>
            <strong>שכבה 1 — קטגוריית חיסכון:</strong> תייג קטגוריה כ&quot;חיסכון&quot; בניהול
            הקטגוריות. כל תנועה שתשויך לקטגוריה זו תיספר אוטומטית כהפקדת חיסכון חודשית.
          </p>
          <p>
            <strong>שכבה 2 — יעדים ספציפיים:</strong> צור יעדים כמו &quot;קרן חירום ₪50,000&quot;
            או &quot;רכב חדש&quot;. עדכן את היתרה ידנית כל חודש כשמפקידים לפיקדון.
          </p>
          <p>
            <strong>חשוב:</strong> הפיקדון הפיזי הוא בחשבון הבנק שלך — האפליקציה עוקבת אחר
            ההתקדמות רק לצורך מעקב ותכנון.
          </p>
        </div>
      </section>
    </div>
  );
}
