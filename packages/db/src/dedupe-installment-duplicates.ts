/**
 * Diagnostic + fixer: find groups of duplicate transactions linked to the
 * same installment plan with the same date + amount, and soft-delete all
 * but the first.
 *
 * Why this happens: some bank exports list every installment of a plan as
 * a separate row on the day the plan was opened (instead of distributing
 * each payment to its own future date). Each row gets a unique externalId
 * so the importer's dedup-by-externalId can't catch them.
 *
 * Run:  npx --prefix packages/db tsx --env-file=.env packages/db/src/dedupe-installment-duplicates.ts
 *
 * Add `--apply` to actually delete; without it, dry-run only.
 */

import { closeDb, getDb } from './client';
import { transactions, households } from './schema/index';
import { and, eq, isNull, sql } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');

async function main() {
  const db = getDb();
  const [household] = await db.select().from(households).limit(1);
  const householdId = household!.id;

  // Find every (plan, date, amount) bucket with > 1 row.
  const groups = await db
    .select({
      planId:   transactions.installmentPlanId,
      date:     transactions.transactionDate,
      amount:   transactions.amountIls,
      merchant: sql<string>`min(${transactions.merchantRaw})`,
      count:    sql<number>`count(*)::int`,
      ids:      sql<string[]>`array_agg(${transactions.id} ORDER BY ${transactions.createdAt})`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isProjected, false),
    ))
    .groupBy(
      transactions.installmentPlanId,
      transactions.transactionDate,
      transactions.amountIls,
    )
    .having(sql`count(*) > 1 AND ${transactions.installmentPlanId} IS NOT NULL`);

  if (groups.length === 0) {
    console.log('✓ No duplicate installment-plan transactions found. DB is clean.');
    return;
  }

  console.log(`Found ${groups.length} duplicate group(s):\n`);
  let totalToDelete = 0;
  for (const g of groups) {
    const keep = g.ids[0]!;
    const drop = g.ids.slice(1);
    totalToDelete += drop.length;
    console.log(`─────────────────────────────────────────────────────`);
    console.log(`Plan:         ${g.planId}`);
    console.log(`Merchant:     ${g.merchant}`);
    console.log(`Date:         ${g.date}    Amount: ₪${g.amount}    Count: ${g.count}`);
    console.log(`✓ keeping:    ${keep}`);
    drop.forEach((id) => console.log(`✗ deleting:   ${id}`));
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`Summary: ${totalToDelete} duplicate row(s) across ${groups.length} group(s).`);

  if (!APPLY) {
    console.log(`\nDry-run only — re-run with --apply to actually soft-delete.`);
    return;
  }

  console.log(`\nSoft-deleting ${totalToDelete} duplicate row(s)...`);
  const now = new Date();
  for (const g of groups) {
    const drop = g.ids.slice(1);
    for (const id of drop) {
      await db
        .update(transactions)
        .set({ deletedAt: now })
        .where(eq(transactions.id, id));
    }
  }
  console.log(`✓ Done. The synthesis logic on /transactions will now project the remaining payments (2/4, 3/4, 4/4) as "צפוי" rows in Feb/Mar/Apr.`);
}

main()
  .then(() => closeDb().then(() => process.exit(0)))
  .catch((err) => { console.error(err); closeDb().finally(() => process.exit(1)); });
