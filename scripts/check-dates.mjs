import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const buf = await readFile('samples/discount-checking-06052026.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

console.log('Header at row 7-8:');
console.log(rows[7]?.map((c, i) => `[${i}]"${c}"`).join(' | '));
console.log(rows[8]?.map((c, i) => `[${i}]"${c}"`).join(' | '));
console.log(`\nTotal rows: ${rows.length}`);

// Check col 0 + col 1 for date format consistency
let weird = 0;
for (let i = 8; i < rows.length; i++) {
  const r = rows[i];
  if (!Array.isArray(r)) continue;
  const c0 = String(r[0] ?? '').trim();
  if (!c0) continue;
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(c0);
  if (!m) {
    weird++;
    if (weird <= 10) console.log(`Row ${i+1} col[0] doesn't match D/M/Y: "${c0}" — full row: ${r.slice(0,4).map(c => `"${c}"`).join('|')}`);
    continue;
  }
  const [, d, mo] = m;
  if (Number(mo) > 12 || Number(d) > 31) {
    console.log(`Row ${i+1} col[0]="${c0}" → invalid d=${d} mo=${mo}`);
  }
}
console.log(`\nRows with weird date formats: ${weird}`);
