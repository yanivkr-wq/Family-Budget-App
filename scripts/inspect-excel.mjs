// Inspect the user's Excel sample so we can adapt the importer to its actual layout.
// Prints: sheet list, header rows for each sheet, first 5 rows, total rows, merged cells.

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '..', 'reference', 'budget-sample.xlsx');

const buf = readFileSync(filePath);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellStyles: false });

console.log('='.repeat(70));
console.log(`SHEET LIST: ${wb.SheetNames.join(', ')}`);
console.log('='.repeat(70));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  if (!ws) continue;
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  const merges = ws['!merges'] ?? [];

  console.log(`\n----- SHEET: "${name}" -----`);
  console.log(`Range: ${ws['!ref']} (${range ? range.e.r - range.s.r + 1 : 0} rows × ${range ? range.e.c - range.s.c + 1 : 0} cols)`);
  console.log(`Merged cells: ${merges.length}`);
  if (merges.length > 0 && merges.length <= 20) {
    for (const m of merges) {
      console.log(`  ${XLSX.utils.encode_range(m)}`);
    }
  }

  // Read as 2D array — see actual contents incl. blanks
  const arr = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: '',
  });

  const totalRows = arr.length;
  const showRows = Math.min(8, totalRows);
  console.log(`Total rows in sheet: ${totalRows}`);
  console.log(`First ${showRows} rows (truncated to first 12 columns each):`);

  for (let i = 0; i < showRows; i++) {
    const row = arr[i] ?? [];
    const truncated = row.slice(0, 12).map((c) => {
      const s = String(c ?? '');
      return s.length > 24 ? s.slice(0, 21) + '…' : s;
    });
    console.log(`  ROW ${i + 1}: ${JSON.stringify(truncated)}`);
  }

  // Sample row from middle of sheet (likely a real data row, not a header)
  if (totalRows > 12) {
    const mid = Math.floor(totalRows / 2);
    const row = arr[mid] ?? [];
    const truncated = row.slice(0, 12).map((c) => {
      const s = String(c ?? '');
      return s.length > 24 ? s.slice(0, 21) + '…' : s;
    });
    console.log(`  ROW ${mid + 1} (mid): ${JSON.stringify(truncated)}`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('END OF INSPECTION');
console.log('='.repeat(70));
