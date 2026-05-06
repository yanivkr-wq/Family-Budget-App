// Run smartImport against the actual file to see what comes out
import { readFile } from 'node:fs/promises';
import { smartImport } from '../apps/web/src/lib/smart-importer.ts';

const buf = await readFile('samples/diners-052026.xlsx');
const result = await smartImport(buf, true);
console.log('templateUsed:', result.templateUsed?.id);
console.log('success:', result.success);
console.log('transactions count:', result.transactions.length);
console.log('errors:', result.errors.slice(0, 5));
console.log('first 3 transactions:', result.transactions.slice(0, 3));
