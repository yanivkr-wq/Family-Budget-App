import * as XLSX from 'xlsx';

// Importer for the specific multi-sheet Hebrew Excel layout the user manages today.
//
// Structure (per the user's actual file):
//   - Sheets named "1".."12" are months of the current year
//   - Sheets named "MMYY" (e.g., "1125", "1225") are months of older years
//   - Each monthly sheet has the same column layout starting at row 1:
//       A:E = account/credit-card summary block (totals — IGNORED for transactions)
//       F   = תאריך (date) — "DD.MM" or "DD.MM.YY"
//       G   = סכום (amount) — positive number, treated as expense
//       H   = סוג הוצאה (expense type / item)
//       I   = קטגוריה (top-level category)
//       J   = איך (payment method / account code)
//       K   = # (installment number, optional)
//       L   = סיום (total installments / end month, optional)
//
// Other sheets (Dropdown, charts, summaries, business detail, etc.) are skipped —
// they are derived data, not source-of-truth transactions.

export interface ExcelTransaction {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** YYYY-MM derived from sheet name */
  billingMonth: string;
  /** Always negative (expenses) — flip sign on income later if needed */
  amountIls: number;
  /** Free-text description (column H "סוג הוצאה") */
  merchantRaw: string;
  /** Top-level category name (column I) */
  categoryName: string | null;
  /** Sub-category — same as merchantRaw at this stage; categorization pipeline can refine. */
  subCategoryName: string | null;
  /** Account code from column J ("איך") */
  accountCode: string | null;
  /** Installment "X / Y" if both present */
  installment?: { number: number; total: number | null };
  /** True when the row had no date in the sheet, meaning it's a recurring monthly fixed expense. */
  isRecurringFixed: boolean;
  /** True when this row represents a future-month projection rather than an actual paid transaction.
   *  Set when billingMonth >= today's month AND the row is dateless (a template row, not a real charge).
   */
  isProjected: boolean;
  /** True when this transaction represents a transfer between two of the user's own accounts
   *  (e.g., business→personal salary). Detected by item == "משכורת" in monthly sheets.
   */
  isTransfer: boolean;
  /** True when this is an income transaction (positive sign in DB). */
  isIncome: boolean;
  /** Source sheet name (for diagnostics) */
  sheetName: string;
  /** Source row in the sheet (1-based) for error reporting */
  sourceRow: number;
}

export interface ExcelParseResult {
  transactions: ExcelTransaction[];
  categoriesSeen: Set<string>;
  subCategoriesSeen: Set<string>;
  accountsSeen: Set<string>;
  monthsSeen: Set<string>;
  /** Sheets we recognized as monthly transaction sheets */
  monthlySheets: string[];
  /** Sheets we deliberately skipped (charts/summaries/etc.) */
  skippedSheets: string[];
  errors: Array<{ sheet: string; row: number; reason: string }>;
}

/** Parse a sheet name into a YYYY-MM, or null if it isn't a monthly sheet. */
export function parseSheetMonth(name: string, currentYear: number): string | null {
  const trimmed = name.trim();
  // Plain 1..12 → current year
  if (/^([1-9]|1[0-2])$/.test(trimmed)) {
    return `${currentYear}-${String(Number(trimmed)).padStart(2, '0')}`;
  }
  // MMYY (4 digits) where MM is 1-12 → year 20YY
  if (/^\d{4}$/.test(trimmed)) {
    const m = Number(trimmed.slice(0, 2));
    const y = Number(trimmed.slice(2));
    if (m >= 1 && m <= 12 && y >= 0 && y <= 99) {
      return `20${String(y).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Parse "DD.MM" or "DD.MM.YY" within a known billing month. */
function parseShortDate(raw: string, billingMonth: string): string | null {
  const s = String(raw).trim();
  if (!s) return null;
  // DD.MM.YY(YY)
  const full = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (full) {
    const d = String(Number(full[1])).padStart(2, '0');
    const m = String(Number(full[2])).padStart(2, '0');
    let y = full[3]!;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m}-${d}`;
  }
  // DD.MM — infer year from sheet
  const short = /^(\d{1,2})\.(\d{1,2})$/.exec(s);
  if (short) {
    const d = String(Number(short[1])).padStart(2, '0');
    const m = String(Number(short[2])).padStart(2, '0');
    const y = billingMonth.slice(0, 4);
    return `${y}-${m}-${d}`;
  }
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Excel serial (4-5 digits)
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + serial * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(raw: string): number {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  s = s.replace(/[₪$€£\s]/g, '').replace(/,/g, '');
  if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse the user's Excel file. Returns transactions and the unique categories
 * and accounts seen — the caller decides how to materialize them in the DB.
 */
export function parseUserExcel(buffer: ArrayBuffer | Buffer, opts?: { defaultYear?: number; today?: Date }): ExcelParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const today = opts?.today ?? new Date();
  const defaultYear = opts?.defaultYear ?? today.getFullYear();
  // Current billing month in YYYY-MM (Israel time)
  const currentBillingMonth = `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const result: ExcelParseResult = {
    transactions: [],
    categoriesSeen: new Set(),
    subCategoriesSeen: new Set(),
    accountsSeen: new Set(),
    monthsSeen: new Set(),
    monthlySheets: [],
    skippedSheets: [],
    errors: [],
  };

  for (const sheetName of wb.SheetNames) {
    const billingMonth = parseSheetMonth(sheetName, defaultYear);
    if (!billingMonth) {
      result.skippedSheets.push(sheetName);
      continue;
    }
    result.monthlySheets.push(sheetName);
    result.monthsSeen.add(billingMonth);

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });

    // Data rows: from row index 2 (1-based row 3) until end. Rows 1-2 are headers.
    for (let i = 2; i < arr.length; i++) {
      const row = arr[i];
      if (!Array.isArray(row)) continue;

      const dateRaw = String(row[5] ?? '').trim();
      const amountRaw = String(row[6] ?? '').trim();
      const itemRaw = String(row[7] ?? '').trim();
      const categoryRaw = String(row[8] ?? '').trim();
      const accountRaw = String(row[9] ?? '').trim();
      const installmentNumRaw = String(row[10] ?? '').trim();
      const installmentTotalRaw = String(row[11] ?? '').trim();

      const sourceRow = i + 1;

      // Skip totally blank lines
      if (!dateRaw && !amountRaw && !itemRaw) continue;

      const amount = parseAmount(amountRaw);
      if (!Number.isFinite(amount) || amount === 0) {
        // Skip zero-amount rows silently — they're placeholders/templates in the original sheet
        continue;
      }

      // Date handling:
      //   present + parseable -> actual dated transaction
      //   present + malformed -> error
      //   absent in PAST month -> recurring monthly fixed expense (already paid)
      //   absent in CURRENT or FUTURE month -> projected (template row, not yet a real charge)
      let date: string;
      let isRecurringFixed = false;
      let isProjected = false;
      if (dateRaw) {
        const parsed = parseShortDate(dateRaw, billingMonth);
        if (!parsed) {
          result.errors.push({ sheet: sheetName, row: sourceRow, reason: `תאריך לא תקין: "${dateRaw}"` });
          continue;
        }
        date = parsed;
      } else {
        date = `${billingMonth}-01`;
        isRecurringFixed = true;
        // If the billing month is the current month or any future month, treat
        // this dateless template row as a projection (not actual spend yet).
        if (billingMonth >= currentBillingMonth) {
          isProjected = true;
        }
      }

      let installment: { number: number; total: number | null } | undefined;
      if (installmentNumRaw && /^\d+$/.test(installmentNumRaw)) {
        const n = Number(installmentNumRaw);
        const totalParsed =
          installmentTotalRaw && /^\d+$/.test(installmentTotalRaw)
            ? Number(installmentTotalRaw)
            : null;
        installment = { number: n, total: totalParsed };
      }

      const merchantRaw = itemRaw || categoryRaw || 'תנועה ללא תיאור';

      // Detect transfers: rows where the item is "משכורת" (salary) under "עסק" (business)
      // category represent business→personal salary transfers. They're real money movements
      // but should be excluded from Combined-view income totals to avoid double-counting.
      const isTransfer =
        (itemRaw === 'משכורת' && categoryRaw === 'עסק') ||
        itemRaw === 'זיכוי מהעסק' ||
        merchantRaw.toLowerCase().includes('זיכוי מחשבון עסקי');

      const txn: ExcelTransaction = {
        date,
        billingMonth,
        amountIls: -Math.abs(amount), // expense convention (monthly sheets only have expenses)
        merchantRaw,
        categoryName: categoryRaw || null,
        subCategoryName: itemRaw || null,
        accountCode: accountRaw || null,
        isRecurringFixed,
        isProjected,
        isTransfer,
        isIncome: false,
        sheetName,
        sourceRow,
      };
      if (installment) txn.installment = installment;

      result.transactions.push(txn);
      if (categoryRaw) result.categoriesSeen.add(categoryRaw);
      if (itemRaw) result.subCategoriesSeen.add(itemRaw);
      if (accountRaw) result.accountsSeen.add(accountRaw);
    }
  }

  return result;
}

/**
 * Parse the "עסק" sheet for monthly business income totals.
 *
 * Layout (per the user's actual file):
 *   - Row 1 (cells I=8, J=9): blank
 *   - Row 2 header: I="חודש", J="הכנסות", K="טרם שולם", L="אושר"
 *   - Rows 3+: I=month number (1-12), J=income for that month
 *
 * The same rows have unrelated client-invoice data in columns A-G — we ignore those.
 *
 * Returns an array of { billingMonth, amount }.
 */
export function parseBusinessIncome(
  buffer: ArrayBuffer | Buffer,
  opts?: { defaultYear?: number },
): Array<{ billingMonth: string; amount: number; sourceRow: number }> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['עסק'];
  if (!ws) return [];

  const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  const defaultYear = opts?.defaultYear ?? new Date().getFullYear();
  const out: Array<{ billingMonth: string; amount: number; sourceRow: number }> = [];

  // Data starts at row index 2 (1-based row 3). Cols I=8 (month), J=9 (income).
  for (let i = 2; i < arr.length; i++) {
    const row = arr[i];
    if (!Array.isArray(row)) continue;

    const monthRaw = String(row[8] ?? '').trim();
    const amountRaw = String(row[9] ?? '').trim();
    if (!/^([1-9]|1[0-2])$/.test(monthRaw)) continue;
    const month = Number(monthRaw);

    let s = amountRaw.replace(/[₪$€£\s,]/g, '');
    if (/^\(.+\)$/.test(s)) s = '-' + s.slice(1, -1);
    const amount = Number(s);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const billingMonth = `${defaultYear}-${String(month).padStart(2, '0')}`;
    out.push({ billingMonth, amount, sourceRow: i + 1 });
  }
  return out;
}

/** Map the user's payment-method codes to clean account names. */
const ACCOUNT_CODE_NAMES: Record<string, string> = {
  'ל-ו 1': 'לאומי 1',
  'ל-ו 2': 'לאומי 2',
  'ל-פ 1': 'לאומי פיננס 1',
  'ל-פ 2': 'לאומי פיננס 2',
  'ל-ח 1': 'לאומי חיסכון 1',
  'ל-ח 2': 'לאומי חיסכון 2',
  'י-ק 1': 'ישראכרט 1',
  'י-ק 2': 'ישראכרט 2',
  'י-מ 1': 'ישראכרט מאסטר 1',
  'י-מ 2': 'ישראכרט מאסטר 2',
  'חש-ל': 'חשבון לאומי',
  'חש-ד': 'חשבון דיסקונט',
  העברה: 'העברה בנקאית',
  מזומן: 'מזומן',
};

export function accountNameFromCode(code: string | null): string {
  if (!code) return 'ידני';
  const trimmed = code.trim();
  return ACCOUNT_CODE_NAMES[trimmed] ?? trimmed;
}
