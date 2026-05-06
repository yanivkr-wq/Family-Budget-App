import { readFile } from 'node:fs/promises';
import { smartImport } from '../apps/web/src/lib/smart-importer.ts';

const files = [
  'samples/visa-lily-052026.xlsx',
  'samples/diners-052026.xlsx',
  'samples/cal-yaniv-052026.xlsx',
  'samples/discount-checking-06052026.xlsx',
  'samples/leumi-business-06052026.xls',
];
for (const f of files) {
  const buf = await readFile(f);
  const isExcel = /\.(xlsx|xls)$/i.test(f);
  const r = await smartImport(buf, isExcel);
  console.log(`${f.split('/')[1]}`);
  console.log(`  template: ${r.templateUsed?.id} (type: ${r.templateUsed?.type})`);
  console.log(`  accountKey: ${JSON.stringify(r.accountKey)}`);
}
