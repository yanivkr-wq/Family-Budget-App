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

async function readToRows(buffer: ArrayBuffer | Buffer, isExcel: boolean): Promise<unknown[][]> {
  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    // Use the first sheet — banks usually export to a single sheet
    const ws = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
  }
  // CSV path
  const text = typeof buffer === 'string' ? buffer : new TextDecoder('utf-8').decode(buffer as ArrayBuffer);
  const parsed = parseCsv(text);
  return [parsed.headers, ...parsed.rows];
}

export async function smartImport(
  buffer: ArrayBuffer | Buffer,
  isExcel: boolean,
): Promise<SmartImportResult> {
  const allRows = await readToRows(buffer, isExcel);
  if (allRows.length === 0) {
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

  // Sample for institution detection — top 30 rows
  const sampleText = allRows
    .slice(0, 30)
    .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')).join(' ') : ''))
    .join('\n');

  const template = detectInstitution(sampleText);
  if (!template) {
    return {
      success: false,
      templateUsed: null,
      transactions: [],
      headers: Array.isArray(allRows[0]) ? (allRows[0] as unknown[]).map((c) => String(c ?? '')) : [],
      errors: [],
      needsManualMapping: true,
      sampleRows: allRows.slice(0, 6),
      detectedHeaderRowIndex: findHeaderRow(allRows),
    };
  }

  // Find the header row
  const headerRowIdx =
    template.headerRowIndex === 'auto' ? findHeaderRow(allRows) : (template.headerRowIndex as number);
  const headers = Array.isArray(allRows[headerRowIdx])
    ? (allRows[headerRowIdx] as unknown[]).map((c) => String(c ?? ''))
    : [];

  const transactions: SmartTransaction[] = [];
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (!Array.isArray(row)) continue;

    // Skip rows that look entirely blank
    const hasContent = row.some((c) => String(c ?? '').trim() !== '');
    if (!hasContent) continue;

    const txnDate = parseDateForTemplate(row[template.columns.transactionDate], template.dateFormat);
    if (!txnDate) {
      // Could be a footer/totals row — skip silently if early rows are valid
      if (i - headerRowIdx > 3 && transactions.length > 0) continue;
      errors.push({ row: i + 1, reason: `תאריך לא תקין: "${row[template.columns.transactionDate]}"` });
      continue;
    }

    const chargeDate =
      template.columns.chargeDate !== undefined
        ? parseDateForTemplate(row[template.columns.chargeDate], template.dateFormat)
        : null;

    const merchantRaw = String(row[template.columns.merchant] ?? '').trim();
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

    transactions.push({
      transactionDate: txnDate,
      chargeDate,
      merchantRaw,
      amountIls: signedAmount,
      originalAmount:
        template.columns.originalAmount !== undefined
          ? (() => {
              const v = parseAmount(row[template.columns.originalAmount]);
              return Number.isFinite(v) && v !== 0 ? Math.abs(v) : null;
            })()
          : null,
      originalCurrency:
        template.columns.originalCurrency !== undefined
          ? String(row[template.columns.originalCurrency] ?? '').trim() || null
          : null,
      notes:
        template.columns.notes !== undefined
          ? String(row[template.columns.notes] ?? '').trim() || null
          : null,
      installmentInfo:
        template.columns.installmentInfo !== undefined
          ? String(row[template.columns.installmentInfo] ?? '').trim() || null
          : null,
      sourceRow: i + 1,
    });
  }

  return {
    success: transactions.length > 0,
    templateUsed: template,
    transactions,
    headers,
    errors,
    needsManualMapping: false,
    sampleRows: allRows.slice(headerRowIdx, headerRowIdx + 6),
    detectedHeaderRowIndex: headerRowIdx,
  };
}

/** List of all known templates — for showing the user a dropdown if auto-detect fails. */
export function listTemplates(): Array<{ id: string; name: string; type: 'bank' | 'credit_card' }> {
  return INSTITUTION_TEMPLATES.map((t) => ({ id: t.id, name: t.name, type: t.type }));
}
