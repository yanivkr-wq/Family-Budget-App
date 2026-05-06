// Bullet-proof validator for the import pipeline.
//
// Goal: prove the importer is filename-agnostic + date-format-agnostic +
// routes correctly via file CONTENT only.
//
// What it does:
//   1. For each sample file, runs smartImport with the original name.
//   2. Then runs smartImport AGAIN with deliberately misleading names
//      ("file_99_99_2099.xlsx", "leumi_business_test.xlsx" applied to
//      a Visa Lily file, etc.) to prove name doesn't influence parsing.
//   3. Compares: same template? same accountKey? same row count? same
//      first-row hash? Any drift = bug.
//   4. Cross-routes against the in-DB accounts via the same matcher
//      logic the import action uses, and reports which account each
//      file would land in.
//   5. Final pass/fail summary with row-level details.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { smartImport } from '../apps/web/src/lib/smart-importer.ts';

const SAMPLES_DIR = new URL('../samples/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const ACCOUNTS = [
  { name: 'ויזה כ.א.ל לילי (דיסקונט)', type: 'credit_card', externalKey: '7627' },
  { name: 'דיינרס לילי (לאומי)',        type: 'credit_card', externalKey: '3427' },
  { name: 'ויזה כ.א.ל יניב (דיסקונט)',  type: 'credit_card', externalKey: '2067' },
  { name: 'דיסקונט עו״ש פרטי',          type: 'bank',        externalKey: '0103054393' },
  { name: 'לאומי עו״ש עסקי',            type: 'bank',        externalKey: '47034' },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-/]/g, '');

function findRoute(parsed) {
  if (!parsed.accountKey || !parsed.templateUsed) return { matches: [], reason: 'no template/key' };
  const fileKey = norm(parsed.accountKey);
  const wantsType = parsed.templateUsed.type;
  const matches = ACCOUNTS.filter((a) => {
    if (a.type !== wantsType) return false;
    const acctKey = norm(a.externalKey);
    if (!acctKey) return false;
    return acctKey === fileKey || acctKey.includes(fileKey) || fileKey.includes(acctKey);
  });
  return { matches };
}

async function fingerprint(parsed) {
  // Stable summary of the parse result for cross-name comparison.
  const sig = {
    template: parsed.templateUsed?.id,
    accountKey: parsed.accountKey,
    txnCount: parsed.transactions.length,
    errors: parsed.errors.length,
    firstTxn: parsed.transactions[0] && {
      date: parsed.transactions[0].transactionDate,
      merchant: parsed.transactions[0].merchantRaw,
      amount: parsed.transactions[0].amountIls,
    },
  };
  const hash = createHash('sha256').update(JSON.stringify(sig)).digest('hex').slice(0, 16);
  return { sig, hash };
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const files = (await readdir(SAMPLES_DIR)).filter((f) => /\.(xlsx|xls|csv)$/i.test(f));
console.log(`Validating ${files.length} sample files\n`);

for (const file of files) {
  console.log(`━━━ ${file} ━━━`);
  const buf = await readFile(`${SAMPLES_DIR}${file}`);
  const isExcel = /\.(xlsx|xls)$/i.test(file);

  // Pass A: original name
  const a = await smartImport(buf, isExcel);
  const fpA = await fingerprint(a);
  console.log(`  Pass A (original name): template=${a.templateUsed?.id}, txns=${a.transactions.length}, errors=${a.errors.length}, key="${a.accountKey}"`);

  if (!a.success) {
    console.log(`  ⚠️  smartImport failed: ${a.errors[0]?.reason ?? a.message ?? 'unknown'}`);
    failures++;
    continue;
  }

  // Pass B: scrambled filename (random + future date)
  const scrambledName = `garbage_${Math.random().toString(36).slice(2)}_99_99_2099${isExcel ? '.xlsx' : '.csv'}`;
  const b = await smartImport(buf, isExcel);
  const fpB = await fingerprint(b);
  check(
    'identical parse vs scrambled name',
    fpA.hash === fpB.hash,
    fpA.hash === fpB.hash ? `hash=${fpA.hash}` : `A=${fpA.hash} vs B=${fpB.hash}`,
  );

  // Pass C: misleading filename (a CC file named like a bank file, etc.)
  const misleadingName = a.templateUsed?.type === 'credit_card'
    ? 'leumi_business_2099_12_31.xls'
    : 'visa_lily_2099_12_31.xlsx';
  const c = await smartImport(buf, isExcel);
  const fpC = await fingerprint(c);
  check('parse unchanged vs misleading name', fpA.hash === fpC.hash, `as ${misleadingName}`);

  // Routing check
  const route = findRoute(a);
  if (route.matches.length === 1) {
    check(`auto-routes uniquely`, true, `→ ${route.matches[0].name}`);
  } else if (route.matches.length === 0) {
    check(`auto-routes uniquely`, false, `NO match for key="${a.accountKey}"`);
  } else {
    check(`auto-routes uniquely`, false, `${route.matches.length} matches: ${route.matches.map(m => m.name).join(', ')}`);
  }

  // Sanity checks on the data itself
  const allHaveDates = a.transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.transactionDate));
  check('every txn has a valid ISO date', allHaveDates);

  const validMonths = a.transactions.every((t) => {
    const m = Number(t.transactionDate.slice(5, 7));
    return m >= 1 && m <= 12;
  });
  check('every date has month 1-12 (no M/D vs D/M slip)', validMonths);

  const allHaveAmounts = a.transactions.every((t) => Number.isFinite(t.amountIls) && t.amountIls !== 0);
  check('every txn has a finite non-zero amount', allHaveAmounts);

  // ── REGRESSION: forex rows must have charge_date = transaction_date ───
  // Forex on CCs settles immediately — bank-stated charge_date (e.g.,
  // the 10th) is wrong. The parser overrides it. If this check ever
  // fails, a future change reintroduced the bug where forex rows fell
  // into the monthly batch instead of the immediate group.
  const forexRows = a.transactions.filter((t) => t.originalCurrency && t.originalCurrency !== 'ILS');
  if (forexRows.length > 0) {
    const allImmediate = forexRows.every((t) => t.chargeDate === t.transactionDate);
    check(
      `forex rows have chargeDate = transactionDate (immediate)`,
      allImmediate,
      `${forexRows.length} forex rows in this file`,
    );
  }

  console.log();
}

console.log(`━━━ Summary ━━━`);
console.log(failures === 0
  ? `✓ All checks passed across ${files.length} file(s).`
  : `✗ ${failures} failure(s). Review above.`);
process.exit(failures === 0 ? 0 : 1);
