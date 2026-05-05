import * as XLSX from 'xlsx';

// Importer for the new clean "baseline" template — 5 well-structured sheets:
//   - Accounts (one row per account)
//   - Transactions (clean transaction list, signed amounts)
//   - Construction (project transactions, auto-linked to "בניית בית" project)
//   - Categories (optional category overrides)
//   - README (informational only — ignored)
//
// Detect by sheet names: must contain at least "Accounts" + "Transactions".

export interface BaselineAccount {
  name: string;
  type: 'bank' | 'credit_card';
  purpose: 'personal' | 'business' | 'shared';
  institution: string;
  initialBalanceIls: number;
  notes: string | null;
  sourceRow: number;
}

export interface BaselineTransaction {
  date: string;
  accountName: string;
  amountIls: number; // signed
  merchantRaw: string;
  categoryName: string | null;
  subCategoryName: string | null;
  isRecurring: boolean;
  isTransfer: boolean;
  notes: string | null;
  sourceRow: number;
  /** Set when this row came from the Construction sheet — to be linked to the project. */
  isConstructionProject?: boolean;
}

export interface BaselineCategory {
  nameHe: string;
  parent: string | null;
  monthlyTargetIls: number | null;
  color: string | null;
}

export interface BaselineParseResult {
  accounts: BaselineAccount[];
  transactions: BaselineTransaction[];
  categories: BaselineCategory[];
  errors: Array<{ sheet: string; row: number; reason: string }>;
  hasBaselineFormat: boolean;
}

function isBoolean(s: unknown): boolean {
  if (typeof s === 'boolean') return s;
  const v = String(s ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'כן';
}

function parseDate(input: unknown): string | null {
  if (!input) return null;
  // If xlsx already parsed it as a Date object
  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  if (!s) return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd.mm.yyyy
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y!.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function parseAmount(input: unknown): number {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim();
  if (!s) return NaN;
  let cleaned = s.replace(/[₪$€£\s]/g, '').replace(/,/g, '');
  if (/^\(.+\)$/.test(cleaned)) cleaned = '-' + cleaned.slice(1, -1);
  return Number(cleaned);
}

export function parseBaselineExcel(buffer: ArrayBuffer | Buffer): BaselineParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const result: BaselineParseResult = {
    accounts: [],
    transactions: [],
    categories: [],
    errors: [],
    hasBaselineFormat: false,
  };

  // Detect: must have both Accounts and Transactions sheets
  const sheetNames = wb.SheetNames;
  const accountsSheet = sheetNames.find((n) => n.toLowerCase() === 'accounts');
  const txnsSheet = sheetNames.find((n) => n.toLowerCase() === 'transactions');
  if (!accountsSheet || !txnsSheet) {
    return result;
  }
  result.hasBaselineFormat = true;

  // ---- Accounts ----
  {
    const ws = wb.Sheets[accountsSheet]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const name = String(r.name ?? '').trim();
      if (!name) continue;
      const type = String(r.type ?? 'bank').trim().toLowerCase();
      const purpose = String(r.purpose ?? 'personal').trim().toLowerCase();
      if (!['bank', 'credit_card'].includes(type)) {
        result.errors.push({ sheet: 'Accounts', row: i + 2, reason: `סוג לא תקין: "${type}"` });
        continue;
      }
      if (!['personal', 'business', 'shared'].includes(purpose)) {
        result.errors.push({ sheet: 'Accounts', row: i + 2, reason: `ייעוד לא תקין: "${purpose}"` });
        continue;
      }
      result.accounts.push({
        name,
        type: type as 'bank' | 'credit_card',
        purpose: purpose as 'personal' | 'business' | 'shared',
        institution: String(r.institution ?? 'manual').trim() || 'manual',
        initialBalanceIls: parseAmount(r.initial_balance_ils) || 0,
        notes: (String(r.notes ?? '').trim() || null),
        sourceRow: i + 2,
      });
    }
  }

  // ---- Transactions ----
  {
    const ws = wb.Sheets[txnsSheet]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const date = parseDate(r.date);
      const accountName = String(r.account ?? '').trim();
      const amount = parseAmount(r.amount_ils);
      const merchant = String(r.merchant ?? '').trim();

      if (!date && !accountName && !merchant && !Number.isFinite(amount)) continue; // blank row

      if (!date) {
        result.errors.push({ sheet: 'Transactions', row: i + 2, reason: `תאריך לא תקין: "${r.date}"` });
        continue;
      }
      if (!accountName) {
        result.errors.push({ sheet: 'Transactions', row: i + 2, reason: 'שם חשבון ריק' });
        continue;
      }
      if (!Number.isFinite(amount) || amount === 0) {
        result.errors.push({ sheet: 'Transactions', row: i + 2, reason: `סכום לא תקין: "${r.amount_ils}"` });
        continue;
      }
      if (!merchant) {
        result.errors.push({ sheet: 'Transactions', row: i + 2, reason: 'שם בית עסק ריק' });
        continue;
      }

      result.transactions.push({
        date,
        accountName,
        amountIls: amount,
        merchantRaw: merchant,
        categoryName: String(r.category ?? '').trim() || null,
        subCategoryName: String(r.sub_category ?? '').trim() || null,
        isRecurring: isBoolean(r.is_recurring),
        isTransfer: isBoolean(r.is_transfer),
        notes: String(r.notes ?? '').trim() || null,
        sourceRow: i + 2,
      });
    }
  }

  // ---- Construction (optional) ----
  const constSheet = sheetNames.find((n) => n.toLowerCase() === 'construction');
  if (constSheet) {
    const ws = wb.Sheets[constSheet]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const date = parseDate(r.date);
      const accountName = String(r.account ?? '').trim();
      const amount = parseAmount(r.amount_ils);
      const merchant = String(r.merchant ?? '').trim();
      if (!date && !accountName && !merchant && !Number.isFinite(amount)) continue;

      if (!date || !accountName || !Number.isFinite(amount) || amount === 0 || !merchant) {
        result.errors.push({
          sheet: 'Construction',
          row: i + 2,
          reason: 'שורת בנייה לא שלמה (תאריך/חשבון/סכום/בית-עסק)',
        });
        continue;
      }

      result.transactions.push({
        date,
        accountName,
        amountIls: amount,
        merchantRaw: merchant,
        categoryName: 'בנייה',
        subCategoryName: null,
        isRecurring: false,
        isTransfer: false,
        notes: String(r.notes ?? '').trim() || null,
        sourceRow: i + 2,
        isConstructionProject: true,
      });
    }
  }

  // ---- Categories (optional) ----
  const catsSheet = sheetNames.find((n) => n.toLowerCase() === 'categories');
  if (catsSheet) {
    const ws = wb.Sheets[catsSheet]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    for (const r of rows) {
      const name = String(r.name_he ?? '').trim();
      if (!name) continue;
      const target = parseAmount(r.monthly_target_ils);
      result.categories.push({
        nameHe: name,
        parent: String(r.parent ?? '').trim() || null,
        monthlyTargetIls: Number.isFinite(target) && target > 0 ? target : null,
        color: String(r.color ?? '').trim() || null,
      });
    }
  }

  return result;
}

/**
 * Pair up transfer rows: for each pair of transactions where both is_transfer=true,
 * one is positive and one is negative, same |amount|, same date, set transfer_pair_id
 * on each pointing to the other.
 *
 * The caller is responsible for inserting transactions and then calling this with
 * the inserted IDs to update the pair links.
 */
export function findTransferPairs(
  transactions: Array<{ id: string; date: string; amount: number; isTransfer: boolean }>,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const used = new Set<string>();
  const transfers = transactions.filter((t) => t.isTransfer);

  for (let i = 0; i < transfers.length; i++) {
    if (used.has(transfers[i]!.id)) continue;
    const a = transfers[i]!;
    for (let j = i + 1; j < transfers.length; j++) {
      if (used.has(transfers[j]!.id)) continue;
      const b = transfers[j]!;
      if (a.date === b.date && Math.abs(a.amount) === Math.abs(b.amount) && a.amount + b.amount === 0) {
        pairs.push([a.id, b.id]);
        used.add(a.id);
        used.add(b.id);
        break;
      }
    }
  }
  return pairs;
}
