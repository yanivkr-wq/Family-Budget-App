import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { ilike, and, eq, or, isNull, desc } from 'drizzle-orm';

/**
 * GET /api/search?q=<query>
 * Full-text search across transactions, accounts, categories, and rules.
 * Returns up to 5 results per group, household-scoped.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ transactions: [], accounts: [], categories: [], rules: [] });
  }

  const db = getDb();
  const { householdId } = session.user;
  const pattern = `%${q}%`;

  const [transactions, accounts, categories, rules] = await Promise.all([
    // ── Transactions ──────────────────────────────────────────────────────────
    db
      .select({
        id: schema.transactions.id,
        merchant: schema.transactions.merchantRaw,
        date: schema.transactions.transactionDate,
        amount: schema.transactions.amountIls,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, householdId),
          isNull(schema.transactions.deletedAt),
          ilike(schema.transactions.merchantRaw, pattern),
        ),
      )
      .orderBy(desc(schema.transactions.transactionDate))
      .limit(5),

    // ── Accounts ─────────────────────────────────────────────────────────────
    db
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        institution: schema.accounts.institution,
        type: schema.accounts.type,
      })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.householdId, householdId),
          eq(schema.accounts.isActive, true),
          ilike(schema.accounts.name, pattern),
        ),
      )
      .limit(5),

    // ── Categories ───────────────────────────────────────────────────────────
    db
      .select({
        id: schema.categories.id,
        nameHe: schema.categories.nameHe,
        parentId: schema.categories.parentId,
      })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.householdId, householdId),
          eq(schema.categories.isArchived, false),
          ilike(schema.categories.nameHe, pattern),
        ),
      )
      .limit(5),

    // ── Rules ─────────────────────────────────────────────────────────────────
    db
      .select({
        id: schema.categoryRules.id,
        name: schema.categoryRules.name,
        pattern: schema.categoryRules.pattern,
      })
      .from(schema.categoryRules)
      .where(
        and(
          eq(schema.categoryRules.householdId, householdId),
          eq(schema.categoryRules.isActive, true),
          or(
            ilike(schema.categoryRules.name, pattern),
            ilike(schema.categoryRules.pattern, pattern),
          ),
        ),
      )
      .limit(5),
  ]);

  return NextResponse.json({ transactions, accounts, categories, rules });
}
