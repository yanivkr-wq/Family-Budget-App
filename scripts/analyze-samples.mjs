/**
 * One-off analysis of every file in samples/.
 * Read-only — does NOT touch the database.
 *
 * For each file reports:
 *   • Detected template id (or "no match" → needs a new template)
 *   • Sheet names
 *   • Header row + first 3 data rows
 *   • Distinct values in the bank's ענף / קטגוריה column (if any)
 *   • Distinct values in the type column (רגילה / תשלומים / etc.)
 *   • Forex rows count, installment-marker rows count, pending rows count
 *   • Per-card breakdown (if the file has a card-last-4 column)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const SAMPLES_DIR = new URL('../samples/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Lazy-import the templates from the actual app code so we share definitions.
const { INSTITUTION_TEMPLATES, detectInstitution, findHeaderRow } = await import(
  '../apps/web/src/lib/institution-templates.ts'
).catch(async () => {
  // Fallback if TS direct-import fails — re-run via tsx
  console.error('Cannot import .ts directly with node — please run: pnpm tsx scripts/analyze-samples.mjs');
  process.exit(1);
});

function trim(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function readSheets(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = ws
      ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false })
      : [];
    return { sheetName: name, rows };
  });
}

function summarizeFile(filePath, fileName) {
  console.log('\n' + '═'.repeat(78));
  console.log(`FILE: ${fileName}`);
  console.log('─'.repeat(78));

  const buf = readFileSync(filePath);
  const sheets = readSheets(buf);

  const sheetNames = sheets.map((s) => s.sheetName);
  console.log(`Sheets (${sheets.length}): ${sheetNames.join(' | ')}`);

  // Try template detection from the first sheet's first 30 rows
  const firstRows = sheets[0]?.rows ?? [];
  const sampleText = firstRows
    .slice(0, 30)
    .map((r) => (Array.isArray(r) ? r.map((c) => trim(c)).join(' ') : ''))
    .join('\n');
  const tpl = detectInstitution(sampleText);
  console.log(`Detected template: ${tpl ? `${tpl.id} ("${tpl.name}")` : '✗ NONE — needs a new template'}`);

  // Show header + first 3 rows of each sheet
  for (const sheet of sheets) {
    console.log(`\n  └─ Sheet: "${sheet.sheetName}" (${sheet.rows.length} rows)`);
    const hdrIdx = findHeaderRow(sheet.rows);
    console.log(`     Header row index: ${hdrIdx}`);
    const headerRow = sheet.rows[hdrIdx];
    if (Array.isArray(headerRow)) {
      console.log('     Headers (col→name):');
      headerRow.forEach((c, i) => {
        const v = trim(c);
        if (v) console.log(`       [${i}] ${v}`);
      });
    }
    // First 3 data rows after header
    console.log('     First 3 data rows:');
    for (let i = hdrIdx + 1; i < Math.min(hdrIdx + 4, sheet.rows.length); i++) {
      const r = sheet.rows[i];
      if (!Array.isArray(r)) continue;
      const compact = r.map((c, idx) => `[${idx}]${trim(c) || '∅'}`).join(' · ');
      console.log(`       ${i + 1}: ${compact.slice(0, 250)}${compact.length > 250 ? '…' : ''}`);
    }
  }

  if (!tpl) return;

  // Vocabulary report — collect distinct values in cols of interest
  const cols = tpl.columns;
  const dataRows = [];
  for (const sheet of sheets) {
    const hdrIdx = findHeaderRow(sheet.rows);
    for (let i = hdrIdx + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      if (Array.isArray(r) && r.some((c) => trim(c))) dataRows.push({ sheet: sheet.sheetName, r });
    }
  }
  console.log(`\n  Total data rows across all sheets: ${dataRows.length}`);

  if (cols.categoryHint !== undefined) {
    const distinct = new Map();
    for (const { r } of dataRows) {
      const v = trim(r[cols.categoryHint]);
      if (v) distinct.set(v, (distinct.get(v) ?? 0) + 1);
    }
    console.log(`\n  Distinct ענף / קטגוריה (col ${cols.categoryHint}) — ${distinct.size} values:`);
    for (const [k, n] of [...distinct.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${String(n).padStart(4)}× ${k}`);
    }
  }
  if (cols.type !== undefined) {
    const distinct = new Map();
    for (const { r } of dataRows) {
      const v = trim(r[cols.type]);
      if (v) distinct.set(v, (distinct.get(v) ?? 0) + 1);
    }
    console.log(`\n  Distinct סוג עסקה (col ${cols.type}) — ${distinct.size} values:`);
    for (const [k, n] of [...distinct.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${String(n).padStart(4)}× ${k}`);
    }
  }

  // Installment markers in notes
  if (cols.notes !== undefined) {
    const installRe = /תשלום\s*(\d+)\s*מתוך\s*(\d+)/;
    let n = 0;
    const examples = [];
    for (const { r } of dataRows) {
      const v = trim(r[cols.notes]);
      const m = installRe.exec(v);
      if (m) {
        n++;
        if (examples.length < 3) examples.push(`"${v}" (merchant: ${trim(r[cols.merchant])})`);
      }
    }
    console.log(`\n  Installment-marker rows (תשלום N מתוך Y in notes col ${cols.notes}): ${n}`);
    examples.forEach((e) => console.log(`     • ${e}`));
  }

  // Forex prefix in amount column (Format A pattern)
  if (tpl.formatHandling?.forexFromAmountPrefix) {
    const colIdx = tpl.formatHandling.forexPrefixColumn ?? 2;
    const re = /^([₪$€£])\s*[\d,]+(?:\.\d+)?$/;
    let nForex = 0;
    const currencies = new Map();
    for (const { r } of dataRows) {
      const v = trim(r[colIdx]);
      const m = re.exec(v);
      if (m && m[1] !== '₪') {
        nForex++;
        currencies.set(m[1], (currencies.get(m[1]) ?? 0) + 1);
      }
    }
    console.log(`\n  Forex rows (non-₪ prefix in col ${colIdx}): ${nForex}`);
    for (const [c, n] of currencies) console.log(`     ${c}: ${n}`);
  }

  // Multi-card detection (Format B pattern)
  const cardCol = 3; // Discount Key convention
  const cards = new Map();
  for (const { r } of dataRows) {
    const v = trim(r[cardCol]);
    if (/^\d{4}$/.test(v)) cards.set(v, (cards.get(v) ?? 0) + 1);
  }
  if (cards.size > 0) {
    console.log(`\n  Distinct card last-4 (col ${cardCol}): ${cards.size}`);
    for (const [c, n] of cards) console.log(`     ${c}: ${n} rows`);
  }
}

import { readFileSync } from 'node:fs';

const files = (await readdir(SAMPLES_DIR)).filter((f) => /\.(xlsx|xls|csv)$/i.test(f));
console.log(`Analyzing ${files.length} sample file(s) in ${SAMPLES_DIR}\n`);
for (const f of files) {
  try {
    summarizeFile(join(SAMPLES_DIR, f), f);
  } catch (err) {
    console.log(`\n!! ERROR reading ${f}: ${err.message}`);
  }
}
console.log('\n' + '═'.repeat(78));
console.log('Analysis complete.');
