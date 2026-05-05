import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { and, desc, eq } from 'drizzle-orm';
import { RulesAdminClient } from './client';

export const dynamic = 'force-dynamic';

export default async function RulesAdminPage() {
  const session = await auth();
  const householdId = session!.user.householdId;
  const db = getDb();

  const [rules, categories, accounts] = await Promise.all([
    db
      .select()
      .from(schema.categoryRules)
      .where(eq(schema.categoryRules.householdId, householdId))
      .orderBy(desc(schema.categoryRules.priority)),
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.householdId, householdId))
      .orderBy(schema.categories.sortOrder),
    db
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        type: schema.accounts.type,
      })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.householdId, householdId), eq(schema.accounts.isActive, true)))
      .orderBy(schema.accounts.name),
  ]);

  const topCats = categories.filter((c) => !c.parentId);
  const subCatsByParent = new Map<string, typeof categories>();
  for (const c of categories) {
    if (c.parentId) {
      const arr = subCatsByParent.get(c.parentId) ?? [];
      arr.push(c);
      subCatsByParent.set(c.parentId, arr);
    }
  }

  // Plain serializable views for the client component
  const topCatList = topCats.map((c) => ({ id: c.id, nameHe: c.nameHe }));
  const subCatList = categories
    .filter((c) => c.parentId)
    .map((c) => ({ id: c.id, nameHe: c.nameHe, parentId: c.parentId! }));
  const ruleList = rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    pattern: r.pattern,
    matchType: r.matchType,
    notesPattern: r.notesPattern,
    notesMatchType: r.notesMatchType,
    appliesToAccountId: r.appliesToAccountId,
    minAmountIls: r.minAmountIls ? Number(r.minAmountIls) : null,
    maxAmountIls: r.maxAmountIls ? Number(r.maxAmountIls) : null,
    categoryId: r.categoryId,
    subCategoryId: r.subCategoryId,
    priority: r.priority,
    isActive: r.isActive,
    timesApplied: r.timesApplied,
    lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
    source: r.source,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">כללי קטגוריזציה</h1>
        <p className="text-sm text-muted-foreground">
          הגדרת חוקים לסיווג אוטומטי של תנועות. למשל: "כל תנועה ב'שופרסל' → מכולת" או "תנועה ב'דלק' מעל 100₪ → דלק; אחרת → מסעדות".
        </p>
      </header>

      <RulesAdminClient
        rules={ruleList}
        topCategories={topCatList}
        subCategories={subCatList}
        accounts={accounts}
      />
    </div>
  );
}
