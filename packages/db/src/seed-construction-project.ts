/**
 * One-shot helper: create a "בניית בית" project (if none exists) and tag
 * every construction-related transaction to it.
 *
 * Run with:  pnpm --filter @fba/db exec tsx --env-file=../../.env src/seed-construction-project.ts
 *
 * Detects construction txns by merchant matching one of the keywords below.
 * Idempotent — running it twice is safe.
 */

import { closeDb, getDb } from './client';
import { transactions, projects, households } from './schema/index';
import { and, eq, isNull, or, ilike, inArray } from 'drizzle-orm';

const KEYWORDS = ['חולדה', 'קבלן', 'בנייה', 'בניה'];

async function main() {
  const db = getDb();

  // ── 1. Pick the household ─────────────────────────────────────────────
  const [household] = await db.select().from(households).limit(1);
  if (!household) {
    console.error('No household found. Sign up first.');
    process.exit(1);
  }
  const householdId = household.id;
  console.log(`Household: ${household.name ?? household.id}`);

  // ── 2. Find or create the project ─────────────────────────────────────
  let [project] = await db
    .select()
    .from(projects)
    .where(and(
      eq(projects.householdId, householdId),
      eq(projects.name, 'בניית בית'),
    ))
    .limit(1);

  if (!project) {
    [project] = await db
      .insert(projects)
      .values({
        householdId,
        name: 'בניית בית',
        description: 'פרויקט בניית הבית — תשלומים לקבלן וספקים',
        color: '#f59e0b', // amber
        status: 'active',
        excludeFromMonthlyTotals: true,
      })
      .returning();
    console.log(`✓ Created project: ${project!.name} (${project!.id})`);
  } else {
    console.log(`✓ Project already exists: ${project.name} (${project.id})`);
  }

  // ── 3. Find candidate transactions ────────────────────────────────────
  const candidates = await db
    .select({
      id:           transactions.id,
      date:         transactions.transactionDate,
      merchant:     transactions.merchantRaw,
      amount:       transactions.amountIls,
      projectId:    transactions.projectId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isProjected, false),
      or(
        ...KEYWORDS.flatMap((k) => [
          ilike(transactions.merchantRaw, `%${k}%`),
          ilike(transactions.merchantNormalized, `%${k}%`),
        ]),
      ),
    ));

  if (candidates.length === 0) {
    console.log('\nNo construction-related transactions found.');
    console.log('Search terms:', KEYWORDS.join(', '));
    console.log('\nIf your contractor goes by a different name, edit KEYWORDS in this script and re-run.');
    return;
  }

  console.log(`\nFound ${candidates.length} candidate transaction(s):`);
  console.log('─'.repeat(80));
  for (const t of candidates) {
    const flag = t.projectId === project!.id
      ? '✓ already tagged'
      : t.projectId
        ? '⚠ tagged to ANOTHER project'
        : '+ will tag';
    console.log(`  ${flag.padEnd(28)}  ${t.date}  ${t.merchant}  ₪${Number(t.amount).toLocaleString()}`);
  }

  const toTag = candidates.filter((t) => !t.projectId);
  if (toTag.length === 0) {
    console.log('\nNothing to update — all candidates already have a project tag.');
    return;
  }

  console.log(`\nTagging ${toTag.length} transaction(s) to project "${project!.name}"...`);
  const result = await db
    .update(transactions)
    .set({ projectId: project!.id })
    .where(and(
      eq(transactions.householdId, householdId),
      inArray(transactions.id, toTag.map((t) => t.id)),
    ))
    .returning({ id: transactions.id });
  console.log(`✓ Updated ${result.length} row(s).`);
  console.log(`\nOpen /projects/${project!.id} to see the per-project dashboard.`);
}

main()
  .then(() => closeDb().then(() => process.exit(0)))
  .catch((err) => {
    console.error(err);
    closeDb().finally(() => process.exit(1));
  });
