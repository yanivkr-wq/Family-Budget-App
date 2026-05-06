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
  /** Bank's own categorization label, e.g. "מסעדות", "דלק", "אוכל ומשקאות".
   *  Extracted from the template's `categoryHint` column. Used as a fallback
   *  category signal in the import action when no user rule matches. */
  categoryHint: string | null;
  /** Bank's own sub-category label (only set by tagged-export formats). */
  subCategoryHint: string | null;
  /** Tagged-export hint: this row's merchant should be marked as a
   *  recurring expense. Triggers recurring_pattern creation in the import. */
  isRecurringHint: boolean;
  /** Tagged-export hint: this row is an inter-account transfer. */
  isTransferHint: boolean;
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
  /**
   * Identifier extracted from the file that uniquely points to ONE
   * account on the user's side — used for auto-routing the import
   * without making the user pick an account each time.
   *
   * Per template:
   *  - discount-key       → col [3] last-4 digits (e.g., "7627")
   *  - il-cc-issuer-export→ trailing 4-digit token from col [5] wallet
   *                          identifier (e.g., "GooglePay 9648" → "9648")
   *  - il-cc-bank-export  → digits extracted from sheet name
   *                          (e.g., "לאומי לישראל 669-4703428" → "6694703428")
   *  - leumi              → null (current accounts have no per-row
   *                          identifier; user must pick or set externalKey
   *                          on the only checking account they own)
   *  - tagged-export      → null (col [1] = account-name string, not a
   *                          stable id; matched by name elsewhere)
   *
   * Importer compares this against `account.externalKey` (case &
   * whitespace insensitive substring match) to find the destination.
   */
  accountKey: string | null;
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

/**
 * Israeli bank portals sometimes serve "Excel" downloads that are actually
 * HTML tables with a .xls extension and an HTML MIME type. Excel opens them
 * via a "format-doesn't-match-extension" prompt; xlsx-js doesn't recognize
 * them because the magic bytes are HTML (`<HTML…`) not OLE/Zip.
 *
 * Detect by sniffing the first few bytes for a `<` or "html" marker and,
 * if so, parse the embedded `<table>` rows ourselves with regex (good
 * enough for these rectangular bank exports — no nested tables, no
 * complex markup).
 */
function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.slice(0, 64).toString('utf8').toLowerCase().trim();
  return head.startsWith('<') && (head.includes('html') || head.includes('table') || head.includes('!doctype'));
}

function parseHtmlTable(html: string): unknown[][] {
  // Strip styles / scripts so they don't pollute cell text.
  const cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const rows: unknown[][] = [];
  const trMatcher = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trMatcher.exec(cleaned))) {
    const rowHtml = trMatch[1] ?? '';
    const cells: string[] = [];
    const cellMatcher = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellMatcher.exec(rowHtml))) {
      const inner = cellMatch[1] ?? '';
      // Strip nested tags, decode common entities, collapse whitespace.
      const text = inner
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

async function readSheets(buffer: ArrayBuffer | Buffer, isExcel: boolean): Promise<ParsedSheet[]> {
  if (isExcel) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    // Sniff for HTML-as-.xls before handing to xlsx — see looksLikeHtml above.
    if (looksLikeHtml(buf)) {
      const html = buf.toString('utf8');
      const rows = parseHtmlTable(html);
      return [{ sheetName: 'Sheet1', rows }];
    }
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
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
      accountKey: null,
    };
  }

  // Detect institution from the FIRST sheet only — that's where bank-name
  // header rows live. Multi-sheet templates apply the same mapping to all
  // sheets.
  const firstRows = sheets[0]!.rows;
  // Build the sample text used for template detection.
  // CRITICAL: collapse ALL whitespace (newlines, tabs, NBSP, multiple
  // spaces) into single spaces. Bank exports often wrap header labels
  // mid-cell — e.g., "סכום\nבש\"ח" or "מזהה כרטיס\nבארנק דיגילטי" —
  // and detection keywords are written as single-line phrases. Without
  // this normalization the right template silently fails to match and
  // an unrelated one wins by accidental keyword overlap.
  const sampleText = firstRows
    .slice(0, 30)
    .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')).join(' ') : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

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
      accountKey: null,
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
      // Some banks dump system labels into the notes column (Discount Key
      // writes "הוראת קבע" / "חיוב עסקת חו\"ל בש\"ח" / similar). The user
      // doesn't want these in their personal notes — strip them out.
      // Anything left after stripping (real installment markers, user-
      // entered text) is preserved.
      const NOISE_NOTES = new Set([
        'הוראת קבע',
        'חיוב חודשי',
        'חיוב עסקות מיידי',
        'חיוב עסקת חו"ל בש"ח',
        'חיוב עסקת חוץ-לארץ בש"ח',
      ]);
      let notes: string | null = null;
      if (cols.notes !== undefined) {
        const raw = String(row[cols.notes] ?? '').trim();
        if (raw && !NOISE_NOTES.has(raw)) notes = raw;
      }

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
      // Forex from notes string ("סכום העסקה הוא 20.0 $") — Cal/Diners
      // 7-col portal exports embed forex info here. Parse symbol + amount.
      if (handling.forexFromNotesString && notes) {
        const m = /סכום\s*העסקה\s*הוא\s*([\d,.]+)\s*([₪$€£])/i.exec(notes);
        if (m) {
          const sym = m[2]!;
          const amt = Number(m[1]!.replace(/,/g, '.'));
          if (sym !== '₪' && Number.isFinite(amt)) {
            originalCurrency = CURRENCY_PREFIX_MAP[sym] ?? sym;
            originalAmount = amt;
          }
        }
      }

      // isForex: STRICT — only when the original transaction was actually
      // in a non-NIS currency. Discount Key's "עסקאות חו"ל ומט"ח" sheet
      // also includes foreign-MERCHANT rows that the bank already
      // converted to NIS at the source (e.g., Netflix Amsterdam billed in
      // ₪). Those aren't forex from the user's wallet perspective — they
      // paid NIS — so we don't flag them.
      const isForex = (originalCurrency !== null && originalCurrency !== 'ILS');
      // sheetIsForex still drives chargeDate=immediate below, but doesn't
      // set the forex flag on its own.
      void sheetIsForex; // (consumed in chargeDate calc below)

      // chargeDate resolution priority:
      //   1. Per-row column (Format B)
      //   2. Forex OR foreign-merchant sheet → equals transactionDate
      //      (Israeli CCs charge these immediately, not on the next cycle)
      //   3. Global header date (Format A)
      //   4. null (calculated later from billing-cycle logic)
      let chargeDate: string | null = null;
      if (cols.chargeDate !== undefined) {
        chargeDate = parseDateForTemplate(row[cols.chargeDate], template.dateFormat);
      }
      if (!chargeDate && (isForex || sheetIsForex)) chargeDate = txnDate;
      if (!chargeDate && globalChargeDate) chargeDate = globalChargeDate;

      const categoryHint = cols.categoryHint !== undefined
        ? String(row[cols.categoryHint] ?? '').trim() || null
        : null;
      const subCategoryHint = cols.subCategoryHint !== undefined
        ? String(row[cols.subCategoryHint] ?? '').trim() || null
        : null;

      // Truthy parsing for tagged-export flags. Treat
      // V/✓/yes/true/1/כן as "true", everything else as false.
      const truthy = (v: unknown): boolean => {
        const s = String(v ?? '').trim().toLowerCase();
        return s === 'v' || s === '✓' || s === 'yes' || s === 'true'
          || s === '1' || s === 'כן' || s === 'x' || s === 'נכון';
      };
      const isRecurringHint = cols.recurringFlag !== undefined
        ? truthy(row[cols.recurringFlag])
        : false;
      const isTransferHint = cols.transferFlag !== undefined
        ? truthy(row[cols.transferFlag])
        : false;

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
        categoryHint,
        subCategoryHint,
        isRecurringHint,
        isTransferHint,
        sourceRow: i + 1,
      });
    }
  }

  // ── Extract a single account identifier from the file for auto-routing.
  // Per-template heuristics; null when nothing reliable was found. ─────────
  let accountKey: string | null = null;
  switch (template.id) {
    case 'discount-key': {
      // col [3] = card last-4. Multi-card files (Discount Key can hold
      // several) leave the key null so the user picks explicitly.
      // Single-card files use the unique value.
      const counts = new Map<string, number>();
      for (const sheet of sheetsToProcess) {
        for (let i = 0; i < sheet.rows.length; i++) {
          const r = sheet.rows[i];
          if (!Array.isArray(r)) continue;
          const v = String(r[3] ?? '').trim();
          if (/^\d{4}$/.test(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      // Discount Key really IS multi-card sometimes (col [3] differs
      // across cards). If there's more than one distinct value, return
      // null — caller forces explicit pick to avoid wrong routing.
      if (counts.size === 1) accountKey = [...counts.keys()][0]!;
      break;
    }
    case 'il-cc-issuer-export': {
      // Issuer files carry MULTIPLE candidate identifiers — collect them
      // all so the user can set externalKey to whichever one they
      // remember:
      //   • Header row 0 string: "פירוט עסקאות ל<owner> לחשבון <bank>
      //     <account#> לכרטיס <type> <card-last-4>" — gives us the
      //     account # + card last-4
      //   • col [5] tokens: "GooglePay <last-4>" / "אינטרנט <last-4>"
      //     — these are device-specific tokens (NOT the physical card)
      // Joined into one space-separated string. The matcher uses
      // includes() so any single identifier the user sets in
      // externalKey will match against this combined blob.
      const candidates = new Set<string>();
      // Header row 0 of the FIRST sheet usually has the account # and
      // card last-4 in a single Hebrew sentence. Pull every digit-run.
      const headerCells = sheets[0]?.rows[0];
      if (Array.isArray(headerCells)) {
        const headerText = headerCells.map((c) => String(c ?? '')).join(' ');
        for (const m of headerText.matchAll(/(\d{4,})/g)) {
          candidates.add(m[1]!);
        }
      }
      // Plus the dominant token from col [5]
      const counts = new Map<string, number>();
      for (const sheet of sheetsToProcess) {
        for (let i = 0; i < sheet.rows.length; i++) {
          const r = sheet.rows[i];
          if (!Array.isArray(r)) continue;
          const cell = String(r[5] ?? '').trim();
          const m = /(\d{4})\s*$/.exec(cell);
          if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
        }
      }
      if (counts.size > 0) {
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        candidates.add(sorted[0]![0]);
      }
      if (candidates.size > 0) accountKey = [...candidates].join(' ');
      break;
    }
    case 'il-cc-bank-export': {
      // The bank-portal exports name the sheet after the issuing bank +
      // CC number, e.g. "לאומי לישראל 669-4703428" or
      // "דיסקונט לישראל 55-103054393". Extract the digit run.
      const sheetName = sheets[0]?.sheetName ?? '';
      const m = /(\d[\d\-\s]+\d)/.exec(sheetName);
      if (m) accountKey = m[1]!.replace(/[\s-]/g, '');
      break;
    }
    case 'leumi':
    case 'leumi-business-html':
    case 'discount':
    case 'hapoalim':
    case 'mizrahi': {
      // Israeli current-account exports (Leumi + Discount + Hapoalim +
      // Mizrahi + the HTML-as-.xls Leumi business format) all put the
      // account number in a header row above the data, like:
      //   "חשבון: 0103054393"
      //   "מס' חשבון : 669-47034/08"
      //   "חשבון: 669-4703428"
      // Sweep the first 10 rows for any digit run with optional
      // separators (dashes / slashes / spaces). Collect ALL candidates
      // — both the original and a stripped version — so the user can
      // set externalKey to whichever format their portal uses.
      const candidates = new Set<string>();
      for (const sheet of sheets) {
        for (let i = 0; i < Math.min(10, sheet.rows.length); i++) {
          const r = sheet.rows[i];
          if (!Array.isArray(r)) continue;
          const text = r.map((c) => String(c ?? '')).join(' ');
          // Pattern: 7+ digits possibly with internal -/spaces.
          // (also captures runs split by /, like "669-47034/08")
          for (const m of text.matchAll(/(\d[\d\-/\s]{5,}\d)/g)) {
            const raw = m[1]!.trim();
            const stripped = raw.replace(/[\-\s\/]/g, '');
            if (stripped.length >= 6) {
              candidates.add(raw);
              candidates.add(stripped);
            }
          }
        }
      }
      if (candidates.size > 0) accountKey = [...candidates].join(' ');
      break;
    }
    // tagged-export doesn't carry a stable file-level identifier — the
    // user must select the account manually.
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
    accountKey,
  };
}

/** List of all known templates — for showing the user a dropdown if auto-detect fails. */
export function listTemplates(): Array<{ id: string; name: string; type: 'bank' | 'credit_card' }> {
  return INSTITUTION_TEMPLATES.map((t) => ({ id: t.id, name: t.name, type: t.type }));
}
