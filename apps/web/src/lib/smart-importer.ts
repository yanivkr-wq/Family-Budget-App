// Smart importer for raw bank/CC exports.
//
// Flow:
//   1. Parse the file (CSV or Excel) into a 2D array.
//   2. Sniff the first ~30 rows for institution-keyword matches.
//   3. If a template matches, find the header row, then map columns by template.
//   4. If no template matches → return { needsManualMapping: true } so the UI can
//      prompt the user (or call the AI fallback).
//
// The result is a list of `SmartTransaction` rows ready to be inserted.

import * as XLSX from 'xlsx';
import { parseCsv } from './csv';
import {
  INSTITUTION_TEMPLATES,
  detectInstitution,
  findHeaderRow,
  type InstitutionTemplate,
  type AmountConvention,
} from './institution-templates';

export interface SmartTransaction {
  transactionDate: string;
  chargeDate: string | null;
  merchantRaw: string;
  amountIls: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  notes: string | null;
  installmentInfo: string | null;
  /** True when the row was a foreign-currency purchase. Set by per-template
   *  formatHandling rules (forexFromAmountPrefix, forexSheetPattern). */
  isForex: boolean;
  /** Sheet of origin (for multi-sheet exports like Discount Key). */
  sheetName?: string;
  /** Source row index for diagnostics */
  sourceRow: number;
}

export interface SmartImportResult {
  success: boolean;
  templateUsed: InstitutionTemplate | null;
  transactions: SmartTransaction[];
  /** Headers detected (for UI preview). */
  headers: string[];
  /** Rows we couldn't parse (with reason). */
  errors: Array<{ row: number; reason: string }>;
  /** True when no template matched. The caller should ask the user / AI to map columns. */
  needsManualMapping: boolean;
  /** When needsManualMapping=true, this is a sample of the first 5 rows for review. */
  sampleRows: unknown[][];
  /** When needsManualMapping=true, this is the suspected header row. */
  detectedHeaderRowIndex: number;
}

function parseDateForTemplate(raw: unknown, fmt: string): string | null {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd.mm.yyyy or dd-mm-yyyy
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y!.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Excel serial
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  s = s.replace(/[₪$€£\s]/g, '').replace(/,/g, '');
  if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function applyAmountConvention(
  row: unknown[],
  template: InstitutionTemplate,
): { amount: number; isExpense: boolean } | null {
  const conv: AmountConvention = template.amountConvention;
  const cols = template.columns;
  switch (conv) {
    case 'signed': {
      if (cols.amount === undefined) return null;
      const a = parseAmount(row[cols.amount]);
      if (!Number.isFinite(a) || a === 0) return null;
      return { amount: Math.abs(a), isExpense: a < 0 || template.defaultIsExpense };
    }
    case 'split_debit_credit': {
      const debit = cols.debit !== undefined ? parseAmount(row[cols.debit]) : NaN;
      const credit = cols.credit !== undefined ? parseAmount(row[cols.credit]) : NaN;
      const debitVal = Number.isFinite(debit) && debit > 0 ? debit : 0;
      const creditVal = Number.isFinite(credit) && credit > 0 ? credit : 0;
      if (debitVal > 0) return { amount: debitVal, isExpense: true };
      if (creditVal > 0) return { amount: creditVal, isExpense: false };
      return null;
    }
    case 'split_with_sign': {
      if (cols.amount === undefined) return null;
      const a = parseAmount(row[cols.amount]);
      if (!Number.isFinite(a) || a === 0) return null;
      const typeRaw = String(row[cols.type ?? -1] ?? '').toLowerCase();
      const isExpense = typeRaw.includes('debit') || typeRaw.includes('d') || template.defaultIsExpense;
      return { amount: Math.abs(a), isExpense };
    }
    case 'unsigned_with_type': {
      if (cols.amount === undefined) return null;
      const a = parseAmount(row[cols.amount]);
      if (!Number.isFinite(a) || a === 0) return null;
      const typeRaw = String(row[cols.type ?? -1] ?? '').trim();
      // Hebrew: "חיוב" = debit (expense), "זיכוי" = credit (income)
      const isExpense = typeRaw === 'חיוב' || (!typeRaw && template.defaultIsExpense);
      return { amount: Math.abs(a), isExpense };
    }
  }
}

interface ParsedSheet {
  sheetName: string;
  rows: unknown[][];
}

async function readSheets(buffer: ArrayBuffer | Buffer, isExcel: boolean): Promise<ParsedSheet[]> {
  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    return wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const rows = ws
        ? XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1, raw: false, defval: '', blankrows: false,
          })
        : [];
      return { sheetName: name, rows };
    });
  }
  // CSV path — single "sheet"
  const text = typeof buffer === 'string' ? buffer : new TextDecoder('utf-8').decode(buffer as ArrayBuffer);
  const parsed = parseCsv(text);
  return [{ sheetName: '__csv__', rows: [parsed.headers, ...parsed.rows] }];
}

// ─── Helpers for the format-quirk handling ───────────────────────────────────

const CURRENCY_PREFIX_MAP: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₪': 'ILS',
};

/** Parse a cell that mixes currency + amount as a single string ("$ 20.00",
 *  "€ 14,90", "₪ 6,327.00"). Used by Format A's col 2 (סכום עסקה) which
 *  carries the original-currency amount with the symbol baked in. */
function extractCurrencyAndAmount(raw: unknown): { currency: string | null; amount: number | null } {
  const s = String(raw ?? '').trim();
  if (!s) return { currency: null, amount: null };
  const m = /^([₪$€£])\s*([\d,]+(?:\.\d+)?)$/.exec(s);
  if (!m) return { currency: null, amount: null };
  const symbol = m[1]!;
  const num = Number(m[2]!.replace(/,/g, ''));
  return {
    currency: CURRENCY_PREFIX_MAP[symbol] ?? symbol,
    amount: Number.isFinite(num) ? num : null,
  };
}

/** Scan rows above the header for "לחיוב ב-DD/MM/YYYY" (or DD.MM.YYYY etc.)
 *  and return the parsed ISO date. Used by Format A files where the charge
 *  date applies globally to every row but only appears once at the top. */
function extractGlobalChargeDate(rowsBeforeHeader: unknown[][]): string | null {
  for (const row of rowsBeforeHeader) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const s = String(cell ?? '');
      const m = /לחיוב\s*ב[-]?\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s);
      if (m) {
        let [, d, mo, y] = m;
        if (y!.length === 2) y = '20' + y;
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

export async function smartImport(
  buffer: ArrayBuffer | Buffer,
  isExcel: boolean,
): Promise<SmartImportResult> {
  const sheets = await readSheets(buffer, isExcel);
  if (sheets.length === 0 || sheets[0]!.rows.length === 0) {
    return {
      success: false,
      templateUsed: null,
      transactions: [],
      headers: [],
      errors: [{ row: 0, reason: 'הקובץ ריק' }],
      needsManualMapping: false,
      sampleRows: [],
      detectedHeaderRowIndex: 0,
    };
  }

  // Detect institution from the FIRST sheet only — that's where bank-name
  // header rows live. Multi-sheet templates apply the same mapping to all
  // sheets.
  const firstRows = sheets[0]!.rows;
  const sampleText = firstRows
    .slice(0, 30)
    .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')).join(' ') : ''))
    .join('\n');

  const template = detectInstitution(sampleText);
  if (!template) {
    return {
      success: false,
      templateUsed: null,
      transactions: [],
      headers: Array.isArray(firstRows[0]) ? (firstRows[0] as unknown[]).map((c) => String(c ?? '')) : [],
      errors: [],
      needsManualMapping: true,
      sampleRows: firstRows.slice(0, 6),
      detectedHeaderRowIndex: findHeaderRow(firstRows),
    };
  }

  // Decide which sheets to process. multiSheet templates (Discount Key) read
  // all of them so the secondary forex sheet isn't dropped silently.
  const handling = template.formatHandling ?? {};
  const sheetsToProcess = handling.multiSheet ? sheets : [sheets[0]!];

  const transactions: SmartTransaction[] = [];
  const errors: Array<{ row: number; reason: string }> = [];
  let firstHeaderRowIdx = 0; // for the result preview
  let firstHeaders: string[] = [];

  for (let sheetIdx = 0; sheetIdx < sheetsToProcess.length; sheetIdx++) {
    const sheet = sheetsToProcess[sheetIdx]!;
    const rows = sheet.rows;
    if (rows.length === 0) continue;

    const headerRowIdx =
      template.headerRowIndex === 'auto' ? findHeaderRow(rows) : (template.headerRowIndex as number);

    if (sheetIdx === 0) {
      firstHeaderRowIdx = headerRowIdx;
      firstHeaders = Array.isArray(rows[headerRowIdx])
        ? (rows[headerRowIdx] as unknown[]).map((c) => String(c ?? ''))
        : [];
    }

    // Per-sheet "global charge date" (Format A: same date applies to every row
    // in the file, lifted from a "לחיוב ב-DD/MM/YYYY" row above the header).
    const globalChargeDate = handling.chargeDateFromHeaderRow
      ? extractGlobalChargeDate(rows.slice(0, headerRowIdx))
      : null;

    // Sheet-level forex flag: the whole sheet is forex transactions.
    const sheetIsForex = handling.forexSheetPattern
      ? handling.forexSheetPattern.test(sheet.sheetName)
      : false;

    const cols = template.columns;
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      const hasContent = row.some((c) => String(c ?? '').trim() !== '');
      if (!hasContent) continue;

      // Pull notes early so we can short-circuit on pending markers.
      const notes = cols.notes !== undefined
        ? String(row[cols.notes] ?? '').trim() || null
        : null;

      // Silent skip for pending rows ("עסקה בקליטה" in Format A files).
      if (handling.pendingNotesMarker && notes && notes.includes(handling.pendingNotesMarker)) {
        continue;
      }

      const txnDate = parseDateForTemplate(row[cols.transactionDate], template.dateFormat);
      if (!txnDate) {
        // Could be a footer/totals row — skip silently if we already have data.
        if (i - headerRowIdx > 3 && transactions.length > 0) continue;
        errors.push({ row: i + 1, reason: `תאריך לא תקין: "${row[cols.transactionDate]}"` });
        continue;
      }

      const merchantRaw = String(row[cols.merchant] ?? '').trim();
      if (!merchantRaw) {
        errors.push({ row: i + 1, reason: 'שם בית עסק ריק' });
        continue;
      }

      const amtResult = applyAmountConvention(row, template);
      if (!amtResult) {
        errors.push({ row: i + 1, reason: 'סכום לא תקין' });
        continue;
      }
      const signedAmount = amtResult.isExpense ? -amtResult.amount : amtResult.amount;

      // Original currency / amount — multiple possible sources:
      //   1. Format B style: explicit columns (originalAmount + originalCurrency)
      //   2. Format A style: extracted from a single "$ 20.00" cell prefix
      let originalAmount: number | null = null;
      let originalCurrency: string | null = null;
      if (cols.originalAmount !== undefined) {
        const v = parseAmount(row[cols.originalAmount]);
        if (Number.isFinite(v) && v !== 0) originalAmount = Math.abs(v);
      }
      if (cols.originalCurrency !== undefined) {
        const v = String(row[cols.originalCurrency] ?? '').trim();
        if (v) originalCurrency = CURRENCY_PREFIX_MAP[v] ?? v;
      }
      if (handling.forexFromAmountPrefix) {
        const colIdx = handling.forexPrefixColumn ?? 2;
        const ext = extractCurrencyAndAmount(row[colIdx]);
        if (ext.currency && ext.currency !== 'ILS') {
          originalCurrency = ext.currency;
          if (ext.amount !== null) originalAmount = ext.amount;
        }
      }

      // isForex: anything non-ILS, OR the whole sheet is the forex sheet.
      const isForex = sheetIsForex || (originalCurrency !== null && originalCurrency !== 'ILS');

      // chargeDate resolution priority:
      //   1. Per-row column (Format B)
      //   2. Forex → equals transactionDate (immediate charge — user requested)
      //   3. Global header date (Format A)
      //   4. null (calculated later from billing-cycle logic)
      let chargeDate: string | null = null;
      if (cols.chargeDate !== undefined) {
        chargeDate = parseDateForTemplate(row[cols.chargeDate], template.dateFormat);
      }
      if (!chargeDate && isForex) chargeDate = txnDate;
      if (!chargeDate && globalChargeDate) chargeDate = globalChargeDate;

      transactions.push({
        transactionDate: txnDate,
        chargeDate,
        merchantRaw,
        amountIls: signedAmount,
        originalAmount,
        originalCurrency,
        notes,
        installmentInfo:
          cols.installmentInfo !== undefined
            ? String(row[cols.installmentInfo] ?? '').trim() || null
            : null,
        isForex,
        sheetName: sheet.sheetName,
        sourceRow: i + 1,
      });
    }
  }

  return {
    success: transactions.length > 0,
    templateUsed: template,
    transactions,
    headers: firstHeaders,
    errors,
    needsManualMapping: false,
    sampleRows: sheets[0]!.rows.slice(firstHeaderRowIdx, firstHeaderRowIdx + 6),
    detectedHeaderRowIndex: firstHeaderRowIdx,
  };
}

/** List of all known templates — for showing the user a dropdown if auto-detect fails. */
export function listTemplates(): Array<{ id: string; name: string; type: 'bank' | 'credit_card' }> {
  return INSTITUTION_TEMPLATES.map((t) => ({ id: t.id, name: t.name, type: t.type }));
}
