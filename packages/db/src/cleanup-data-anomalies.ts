/**
 * One-shot cleanup for the two anomaly classes the importer can now detect
 * automatically but that pre-date the fix:
 *
 *   PART A — Cross-account amount-mirror transfers:
 *     Find pairs of unpaired non-transfer rows with sign-flipped, equal-magnitude
 *     amounts (within 1 agora) on different accounts, dates within ±2 days,
 *     |amount| ≥ ₪500. Flag both as is_transfer=true and link via transfer_pair_id.
 *
 *   PART B — Same-day same-merchant duplicate copies:
 *     Find groups by (account, transaction_date, abs(amount), merchant_normalized)
 *     with >1 active row. Keep the first (by createdAt); soft-delete the rest.
 *     Avoids the case where bank exports double-list installments etc.
 *
 * Both operations are reversible:
 *   • Transfer flag/pair: clear via the edit modal or `transfer_pair_id = NULL`.
 *   • Soft-delete: `UPDATE transaction SET deleted_at = NULL WHERE id = ...`.
 *
 * Run dry-run:   npx --prefix packages/db tsx --env-file=.env packages/db/src/cleanup-data-anomalies.ts
 * Run for real:  add --apply
 */

import { closeDb, getDb } from './client';
import { transactions, households, accounts } from './schema/index';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');
const TRANSFER_AMOUNT_FLOOR = 500;
const TRANSFER_DATE_WINDOW_DAYS = 2;
// Optional: skip Part B duplicate groups whose |amount| is below this floor.
// Use to preserve small same-day same-merchant rows that might be real
// (two coffees, two parking charges) while still cleaning up bigger
// definitely-wrong cases like the 3× ₪2280.96 ביטוח לאומי installment.
//   --amount-floor=100  → only dedupe groups with |amount| ≥ ₪100
const DUP_AMOUNT_FLOOR = (() => {
  const arg = process.argv.find((a) => a.startsWith('--amount-floor='));
  if (!arg) return 0;
  const n = Number(arg.split('=')[1]);
  return isFinite(n) && n >= 0 ? n : 0;
})();

async function main() {
  const db = getDb();
  const [household] = await db.select().from(households).limit(1);
  if (!household) {
    console.log('No household found.');
    return;
  }
  const householdId = household.id;

  console.log(`\nMode: ${APPLY ? '\x1b[33mAPPLY (will modify DB)\x1b[0m' : '\x1b[36mDRY-RUN (no changes)\x1b[0m'}`);
  console.log(`Household: ${householdId}`);
  if (DUP_AMOUNT_FLOOR > 0) {
    console.log(`Part B floor: skip dup groups where |amount| < ₪${DUP_AMOUNT_FLOOR}`);
  }
  console.log();

  // ── PART A: cross-account transfer auto-pair ──────────────────────────────
  console.log('━━━ Part A: cross-account amount-mirror transfers ━━━');

  const candidates = await db
    .select({
      id:                transactions.id,
      accountId:         transactions.accountId,
      transactionDate:   transactions.transactionDate,
      amountIls:         transactions.amountIls,
      installmentPlanId: transactions.installmentPlanId,
      merchantRaw:       transactions.merchantRaw,
    })
    .from(transactions)
    .where(and(
      eq(transactions.householdId, householdId),
      eq(transactions.isTransfer, false),
      isNull(transactions.transferPairId),
      isNull(transactions.deletedAt),
      eq(transactions.isProjected, false),
    ));

  // Account name lookup for the report.
  const accs = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  const accName = new Map(accs.map((a) => [a.id, a.name]));

  const used = new Set<string>();
  const pairsToLink: Array<{ a: typeof candidates[number]; b: typeof candidates[number]; daysDiff: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    if (used.has(a.id)) continue;
    if (a.installmentPlanId) continue;
    const aAmt = Number(a.amountIls);
    if (Math.abs(aAmt) < TRANSFER_AMOUNT_FLOOR) continue;
    let best: { b: typeof candidates[number]; daysDiff: number } | null = null;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]!;
      if (used.has(b.id)) continue;
      if (b.installmentPlanId) continue;
      if (b.accountId === a.accountId) continue;
      const bAmt = Number(b.amountIls);
      if (Math.abs(aAmt + bAmt) > 0.01) continue;
      if (Math.sign(aAmt) === Math.sign(bAmt)) continue;
      const daysDiff = Math.abs(
        (new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()) / 86400000,
      );
      if (daysDiff > TRANSFER_DATE_WINDOW_DAYS) continue;
      if (!best || daysDiff < best.daysDiff) best = { b, daysDiff };
    }
    if (best) {
      pairsToLink.push({ a, b: best.b, daysDiff: best.daysDiff });
      used.add(a.id);
      used.add(best.b.id);
    }
  }

  if (pairsToLink.length === 0) {
    console.log('  ✓ No unpaired cross-account transfers found.\n');
  } else {
    console.log(`  Found ${pairsToLink.length} pair(s) to flag + link:\n`);
    for (const { a, b, daysDiff } of pairsToLink) {
      const from = Number(a.amountIls) < 0 ? a : b;
      const to   = Number(a.amountIls) < 0 ? b : a;
      const amt  = Math.abs(Number(from.amountIls)).toFixed(2);
      console.log(
        `  • ${from.transactionDate}  ₪${amt.padStart(10)}  ` +
        `${(accName.get(from.accountId) ?? from.accountId).padEnd(28)} → ${(accName.get(to.accountId) ?? to.accountId).padEnd(28)} ` +
        `${daysDiff > 0 ? `(${daysDiff}d gap)` : ''}\n` +
        `      from: "${from.merchantRaw}"\n` +
        `      to:   "${to.merchantRaw}"`,
      );
    }
    console.log();

    if (APPLY) {
      const allIds = pairsToLink.flatMap((p) => [p.a.id, p.b.id]);
      await db
        .update(transactions)
        .set({ isTransfer: true })
        .where(inArray(transactions.id, allIds));
      for (const { a, b } of pairsToLink) {
        await db.update(transactions).set({ transferPairId: b.id }).where(eq(transactions.id, a.id));
        await db.update(transactions).set({ transferPairId: a.id }).where(eq(transactions.id, b.id));
      }
      console.log(`  \x1b[32m✓ Flagged ${allIds.length} rows as transfers and linked ${pairsToLink.length} pairs.\x1b[0m\n`);
    }
  }

  // ── PART B: same-day same-merchant duplicate copies ───────────────────────
  console.log('━━━ Part B: exact-duplicate copies (same account/date/amount/merchant) ━━━');

  const dupGroups = await db
    .select({
      accountId:          transactions.accountId,
      date:               transactions.transactionDate,
      amount:             transactions.amountIls,
      merchant:           transactions.merchantNormalized,
      count:              sql<number>`count(*)::int`,
      ids:                sql<string[]>`array_agg(${transactions.id} ORDER BY ${transactions.createdAt})`,
      sampleMerchantRaw:  sql<string>`min(${transactions.merchantRaw})`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isProjected, false),
    ))
    .groupBy(
      transactions.accountId,
      transactions.transactionDate,
      transactions.amountIls,
      transactions.merchantNormalized,
    )
    .having(sql`count(*) > 1`);

  // Apply the optional amount floor: keep only groups whose |amount| meets it.
  const eligibleGroups = dupGroups.filter(
    (g) => Math.abs(Number(g.amount)) >= DUP_AMOUNT_FLOOR,
  );
  const skippedGroups = dupGroups.length - eligibleGroups.length;

  if (eligibleGroups.length === 0) {
    console.log('  ✓ No duplicate groups to clean.');
    if (skippedGroups > 0) {
      console.log(`  (skipped ${skippedGroups} group(s) below the ₪${DUP_AMOUNT_FLOOR} floor)`);
    }
    console.log();
  } else {
    let totalToDelete = 0;
    console.log(`  Found ${eligibleGroups.length} duplicate group(s) at or above ₪${DUP_AMOUNT_FLOOR}:\n`);
    for (const g of eligibleGroups) {
      const dropIds = g.ids.slice(1);
      totalToDelete += dropIds.length;
      const amt = Math.abs(Number(g.amount)).toFixed(2);
      console.log(
        `  • ${g.date}  ₪${amt.padStart(10)}  ${(accName.get(g.accountId) ?? '???').padEnd(28)} ` +
        `"${g.sampleMerchantRaw.trim()}"  → ${g.count} copies, drop ${dropIds.length}`,
      );
    }
    console.log(`\n  Total rows to soft-delete: ${totalToDelete}`);
    if (skippedGroups > 0) {
      console.log(`  (skipped ${skippedGroups} group(s) below the ₪${DUP_AMOUNT_FLOOR} floor — preserved as-is)`);
    }
    console.log();

    if (APPLY) {
      const allDropIds = eligibleGroups.flatMap((g) => g.ids.slice(1));
      await db
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(inArray(transactions.id, allDropIds));
      console.log(`  \x1b[32m✓ Soft-deleted ${allDropIds.length} duplicate copies.\x1b[0m\n`);
    }
  }

  if (!APPLY) {
    console.log('━━━ DRY-RUN complete. Re-run with --apply to commit changes. ━━━\n');
  } else {
    console.log('━━━ APPLY complete. ━━━\n');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
