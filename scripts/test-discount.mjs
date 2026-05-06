import { readFile } from 'node:fs/promises';
import { smartImport } from '../apps/web/src/lib/smart-importer.ts';

const buf = await readFile('samples/discount-checking-06052026.xlsx');
const r = await smartImport(buf, true);
console.log('templateUsed:', r.templateUsed?.id);
console.log('success:', r.success);
console.log('transactions:', r.transactions.length);
console.log('errors first 3:', r.errors.slice(0, 3));
console.log('first 3 dates:', r.transactions.slice(0, 3).map(t => `${t.transactionDate} → ${t.merchantRaw}`));
