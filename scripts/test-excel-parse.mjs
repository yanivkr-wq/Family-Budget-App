// Dry-run the Excel parser on the user's sample so we can confirm parse quality
// before they actually upload through the UI.

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '..', 'reference', 'budget-sample.xlsx');

// Re-implement the parser locally so we don't have to compile the TS file.
function parseSheetMonth(name, currentYear) {
  const trimmed = String(name).trim();
  if (/^([1-9]|1[0-2])$/.test(trimmed)) {
    return `${currentYear}-${String(Number(trimmed)).padStart(2, '0')}`;
  }
  if (/^\d{4}$/.test(trimmed)) {
    const m = Number(trimmed.slice(0, 2));
    const y = Number(trimmed.slice(2));
    if (m >= 1 && m <= 12 && y >= 0 && y <= 99) {
      return `20${String(y).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseShortDate(raw, billingMonth) {
  const s = String(raw).trim();
  if (!s) return null;
  const full = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (full) {
    const d = String(Number(full[1])).padStart(2, '0');
    const m = String(Number(full[2])).padStart(2, '0');
    let y = full[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  const short = /^(\d{1,2})\.(\d{1,2})$/.exec(s);
  if (short) {
    const d = String(Number(short[1])).padStart(2, '0');
    const m = String(Number(short[2])).padStart(2, '0');
    return `${billingMonth.slice(0, 4)}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseAmount(raw) {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  s = s.replace(/[₪$€£\s]/g, '').replace(/,/g, '');
  if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const buf = readFileSync(filePath);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
const currentYear = new Date().getFullYear();

const stats = {
  monthlySheets: [],
  skipped: [],
  totalTxns: 0,
  byMonth: {},
  categoriesSeen: new Set(),
  itemsSeen: new Set(),
  accountsSeen: new Set(),
  errors: [],
  sampleTxns: [],
};

for (const name of wb.SheetNames) {
  const billingMonth = parseSheetMonth(name, currentYear);
  if (!billingMonth) {
    stats.skipped.push(name);
    continue;
  }
  stats.monthlySheets.push(name);

  const ws = wb.Sheets[name];
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });

  let monthTxns = 0;
  for (let i = 2; i < arr.length; i++) {
    const row = arr[i];
    if (!Array.isArray(row)) continue;

    const dateRaw = String(row[5] ?? '').trim();
    const amountRaw = String(row[6] ?? '').trim();
    const itemRaw = String(row[7] ?? '').trim();
    const categoryRaw = String(row[8] ?? '').trim();
    const accountRaw = String(row[9] ?? '').trim();

    if (!dateRaw && !amountRaw && !itemRaw) continue;
    const amount = parseAmount(amountRaw);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const date = parseShortDate(dateRaw, billingMonth);
    if (!date) {
      stats.errors.push({ sheet: name, row: i + 1, reason: `bad date: ${dateRaw}` });
      continue;
    }

    monthTxns++;
    stats.totalTxns++;
    if (categoryRaw) stats.categoriesSeen.add(categoryRaw);
    if (itemRaw) stats.itemsSeen.add(itemRaw);
    if (accountRaw) stats.accountsSeen.add(accountRaw);

    if (stats.sampleTxns.length < 5) {
      stats.sampleTxns.push({
        sheet: name,
        date,
        amount,
        item: itemRaw,
        category: categoryRaw,
        account: accountRaw,
      });
    }
  }
  stats.byMonth[billingMonth] = monthTxns;
}

console.log('='.repeat(70));
console.log('PARSE DRY-RUN RESULTS');
console.log('='.repeat(70));
console.log(`Monthly sheets: ${stats.monthlySheets.length} → ${stats.monthlySheets.join(', ')}`);
console.log(`Skipped sheets (${stats.skipped.length}): ${stats.skipped.join(', ')}`);
console.log(`Total transactions parsed: ${stats.totalTxns}`);
console.log(`Errors: ${stats.errors.length}`);
console.log('');
console.log('Transactions per billing month:');
for (const [month, count] of Object.entries(stats.byMonth).sort()) {
  console.log(`  ${month}: ${count}`);
}
console.log('');
console.log(`Distinct categories seen (${stats.categoriesSeen.size}):`);
for (const c of stats.categoriesSeen) console.log(`  - ${c}`);
console.log('');
console.log(`Distinct items / expense types seen (${stats.itemsSeen.size}):`);
for (const it of [...stats.itemsSeen].slice(0, 30)) console.log(`  - ${it}`);
if (stats.itemsSeen.size > 30) console.log(`  …and ${stats.itemsSeen.size - 30} more`);
console.log('');
console.log(`Distinct account codes seen (${stats.accountsSeen.size}):`);
for (const a of stats.accountsSeen) console.log(`  - ${a}`);
console.log('');
console.log('Sample transactions:');
for (const t of stats.sampleTxns) {
  console.log(`  [${t.sheet}] ${t.date} | ₪${t.amount.toFixed(2).padStart(10)} | ${t.item.padEnd(30)} | ${t.category.padEnd(25)} | ${t.account}`);
}
if (stats.errors.length > 0) {
  console.log('');
  console.log('First 10 errors:');
  for (const e of stats.errors.slice(0, 10)) {
    console.log(`  [${e.sheet}] row ${e.row}: ${e.reason}`);
  }
}
