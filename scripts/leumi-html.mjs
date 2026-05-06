import { readFile } from 'node:fs/promises';
import { smartImport } from '../apps/web/src/lib/smart-importer.ts';

const buf = await readFile('samples/leumi-business-06052026.xls');
const result = await smartImport(buf, true);
console.log('templateUsed:', result.templateUsed?.id);
console.log('success:', result.success);
console.log('transactions count:', result.transactions.length);
console.log('errors first 3:', result.errors.slice(0, 3));
console.log('first 3 transactions:', result.transactions.slice(0, 3));
console.log('accountKey:', result.accountKey);
