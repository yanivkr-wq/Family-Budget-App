import { readFile } from 'node:fs/promises';
const { default: smartImporter } = await import('../apps/web/src/lib/smart-importer.ts').catch(() => ({}));
// Use the HTML parsing path directly
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const buf = await readFile('samples/leumi-business-06052026.xls');
const html = buf.toString('utf8');

// Strip + extract <tr><td>
const cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
const trM = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
let trMatch, rowIdx = 0;
while ((trMatch = trM.exec(cleaned))) {
  const cells = [];
  const cellM = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let cellMatch;
  while ((cellMatch = cellM.exec(trMatch[1]))) {
    const text = cellMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    cells.push(text);
  }
  if (cells.length > 0) {
    rowIdx++;
    if (rowIdx <= 15) {
      console.log(`[${rowIdx}] ${cells.map((c, i) => `[${i}]"${c.slice(0, 40)}"`).join(' | ')}`);
    }
  }
}
console.log(`\nTotal rows: ${rowIdx}`);
