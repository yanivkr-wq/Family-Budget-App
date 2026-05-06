import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { formatIls } from '@fba/shared';
import { Repeat } from 'lucide-react';
import { RecurringList } from './recurring-list';

export const dynamic = 'force-dynamic';

export default async function RecurringPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const db = getDb();
  const { householdId } = session.user;

  const [patterns, cats] = await Promise.all([
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
  ]);

  // Summary tiles — sums for "active" patterns only
  const active = patterns.filter((p) => p.status === 'active');
  const monthlyExpense = active
    .filter((p) => p.frequency === 'monthly' && Number(p.expectedAmountIls) < 0)
    .reduce((s, p) => s + Math.abs(Number(p.expectedAmountIls)), 0);
  const monthlyIncome = active
    .filter((p) => p.frequency === 'monthly' && Number(p.expectedAmountIls) > 0)
    .reduce((s, p) => s + Number(p.expectedAmountIls), 0);

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
          </div>
        </div>
      )}

      <RecurringList patterns={patterns} categories={cats} />
    </div>
  );
}
