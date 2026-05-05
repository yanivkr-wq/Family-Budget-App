// Minimal RFC 4180-ish CSV parser — handles:
//   - quoted fields with commas inside
//   - escaped quotes ("")
//   - trailing newline
//   - BOM (UTF-8) — important for Excel-saved files in Hebrew
// Doesn't handle:
//   - multi-line records (quoted newlines) — Excel rarely produces these
//   - tab/semicolon delimiters (we autodetect , vs ;)

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: ',' | ';' | '\t';
}

export function parseCsv(input: string): ParsedCsv {
  // Strip UTF-8 BOM
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }

  // Detect delimiter from first line
  const firstNewline = input.indexOf('\n');
  const headerLine = firstNewline === -1 ? input : input.slice(0, firstNewline);
  const counts = {
    ',': (headerLine.match(/,/g) ?? []).length,
    ';': (headerLine.match(/;/g) ?? []).length,
    '\t': (headerLine.match(/\t/g) ?? []).length,
  };
  let delimiter: ',' | ';' | '\t' = ',';
  let max = 0;
  for (const d of [',', ';', '\t'] as const) {
    if (counts[d] > max) {
      max = counts[d];
      delimiter = d;
    }
  }

  const lines: string[][] = [];
  let i = 0;
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.length === 1 && row[0] === '') {
      // Skip blank lines
      row = [];
      return;
    }
    lines.push(row);
    row = [];
  };

  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === delimiter) {
        pushField();
        i++;
      } else if (c === '\n') {
        pushRow();
        i++;
      } else if (c === '\r') {
        // skip — handle \r\n by waiting for \n
        i++;
      } else {
        field += c;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  if (lines.length === 0) return { headers: [], rows: [], delimiter };

  const headers = lines[0]!.map((h) => h.trim());
  const rows = lines.slice(1);
  return { headers, rows, delimiter };
}

// Map a header row to canonical column names. Accept Hebrew or English.
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'תאריך', 'תאריך עסקה', 'transaction_date', 'transactiondate'],
  merchant: ['merchant', 'בית עסק', 'תיאור', 'description', 'שם'],
  amount: ['amount', 'סכום', 'amount_ils', 'amountils', 'sum', 'price', 'חיוב'],
  category: ['category', 'קטגוריה', 'category_name', 'categoryname'],
  sub_category: ['sub_category', 'subcategory', 'תת קטגוריה', 'תת-קטגוריה', 'sub'],
  account: ['account', 'חשבון', 'account_name', 'accountname'],
  billing_month: ['billing_month', 'billingmonth', 'חודש חיוב'],
  notes: ['notes', 'הערות', 'note', 'memo'],
};

export function detectColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const lc = headers.map((h) => h.toLowerCase().trim().replace(/[\s-]/g, '_'));
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const aliasLc = alias.toLowerCase().trim().replace(/[\s-]/g, '_');
      const idx = lc.indexOf(aliasLc);
      if (idx >= 0) {
        map[canonical] = idx;
        break;
      }
    }
  }
  return map;
}

// Parse various date formats commonly found in Israeli Excel exports.
// Returns YYYY-MM-DD or null.
export function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy or dd.mm.yyyy or dd-mm-yyyy
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y!.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
    const dd = String(d).padStart(2, '0');
    const mm = String(mo).padStart(2, '0');
    if (Number(mm) < 1 || Number(mm) > 12) return null;
    if (Number(dd) < 1 || Number(dd) > 31) return null;
    return `${y}-${mm}-${dd}`;
  }

  // Excel serial (rare from CSV but possible): 4-5 digit number
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch
    const d = new Date(epoch.getTime() + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

// Parse "1,234.56" / "1234.56" / "₪1,234" / "-450" — returns number or NaN.
export function parseFlexibleAmount(input: string): number {
  if (!input) return NaN;
  let s = input.trim();
  // strip currency symbols / letters
  s = s.replace(/[₪$€£]/g, '').replace(/\s/g, '');
  // strip thousands separators
  s = s.replace(/,/g, '');
  // parens => negative
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
