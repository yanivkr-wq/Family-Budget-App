// Templates for the major Israeli banks and credit-card issuers.
//
// Each template knows:
//  - How to detect that a given file came from this institution (header keywords + structure)
//  - Which row holds the headers (sometimes there's a 5-row preamble)
//  - Which columns map to our schema (date, merchant, amount, balance, etc.)
//  - The native date format and amount conventions (sign vs separate debit/credit columns)
//
// When a user uploads a raw export, we try each template in order. If none matches,
// we fall back to AI-assisted column mapping (asks Claude to identify columns).

export type AmountConvention =
  | 'signed'           // single column, +income / -expense
  | 'split_debit_credit' // two columns: one for debits, one for credits
  | 'split_with_sign'   // two columns: amount + sign indicator (D/C)
  | 'unsigned_with_type'; // single amount column + a "type" column ("חיוב"/"זיכוי")

export type DateFormat = 'iso' | 'dd/mm/yyyy' | 'dd.mm.yyyy' | 'dd-mm-yyyy' | 'auto';

export interface InstitutionTemplate {
  id: string;
  name: string;
  type: 'bank' | 'credit_card';
  /** Lowercase keywords that, if found in the first 30 rows, suggest this template. */
  detectionKeywords: string[];
  /** 0-indexed row number where the actual headers live (rows above are preamble). */
  headerRowIndex: number | 'auto';
  /** Column indices (0-based) for each canonical field. -1 = not present. */
  columns: {
    transactionDate: number;
    chargeDate?: number; // optional — credit cards sometimes have this
    merchant: number;
    amount?: number; // present if amountConvention is 'signed' or 'unsigned_with_type'
    debit?: number; // present if amountConvention is 'split_debit_credit'
    credit?: number; // present if amountConvention is 'split_debit_credit'
    type?: number; // for 'unsigned_with_type' or 'split_with_sign'
    originalAmount?: number; // for forex
    originalCurrency?: number; // for forex
    notes?: number;
    balance?: number; // running balance after transaction (banks only)
    installmentInfo?: number; // some CCs have a "payments" column
  };
  amountConvention: AmountConvention;
  dateFormat: DateFormat;
  /** Default sign: if amount in source is unsigned, treat as expense (true) or income (false). */
  defaultIsExpense: boolean;
}

export const INSTITUTION_TEMPLATES: InstitutionTemplate[] = [
  // -------- Bank Hapoalim (CSV/Excel export) --------
  {
    id: 'hapoalim',
    name: 'בנק הפועלים',
    type: 'bank',
    detectionKeywords: ['בנק הפועלים', 'הפועלים', 'תאריך ערך', 'תאריך פעולה'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0, // תאריך פעולה
      merchant: 2,         // תיאור הפעולה
      debit: 3,            // חובה (ש"ח)
      credit: 4,           // זכות (ש"ח)
      balance: 5,
    },
    amountConvention: 'split_debit_credit',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Bank Leumi --------
  {
    id: 'leumi',
    name: 'בנק לאומי',
    type: 'bank',
    detectionKeywords: ['לאומי', 'תאריך ביצוע', 'תאריך ערך', 'יתרה לאחר'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0, // תאריך ביצוע
      merchant: 1,         // תיאור פעולה
      debit: 2,            // חובה
      credit: 3,           // זכות
      balance: 5,
    },
    amountConvention: 'split_debit_credit',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Bank Discount --------
  {
    id: 'discount',
    name: 'בנק דיסקונט',
    type: 'bank',
    detectionKeywords: ['דיסקונט', 'תאריך ערך', 'אסמכתא', 'מקור הפעולה'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      merchant: 2,
      debit: 3,
      credit: 4,
      balance: 5,
    },
    amountConvention: 'split_debit_credit',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Bank Mizrahi --------
  {
    id: 'mizrahi',
    name: 'בנק מזרחי טפחות',
    type: 'bank',
    detectionKeywords: ['מזרחי', 'טפחות', 'תאריך ערך', 'תאריך פעולה'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      merchant: 2,
      debit: 3,
      credit: 4,
      balance: 5,
    },
    amountConvention: 'split_debit_credit',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Visa Cal (CSV) --------
  {
    id: 'cal',
    name: 'ויזה כאל',
    type: 'credit_card',
    detectionKeywords: ['cal', 'כאל', 'תאריך עסקה', 'תאריך חיוב', 'visa cal', 'ויזה כ.א.ל'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0, // תאריך עסקה
      chargeDate: 1,       // תאריך חיוב
      merchant: 2,         // שם בית עסק
      amount: 3,           // סכום העסקה
      type: 4,             // סוג עסקה / "חיוב" / "זיכוי"
      originalAmount: 5,
      originalCurrency: 6,
      installmentInfo: 7,
      notes: 8,
    },
    amountConvention: 'unsigned_with_type',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Isracard --------
  {
    id: 'isracard',
    name: 'ישראכרט',
    type: 'credit_card',
    detectionKeywords: ['isracard', 'ישראכרט', 'מסטרכרט', 'תאריך רכישה', 'מועד חיוב'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      chargeDate: 1,
      merchant: 2,
      amount: 3,
      originalAmount: 4,
      originalCurrency: 5,
      notes: 6,
    },
    amountConvention: 'signed',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Max (formerly Leumi-Card) --------
  {
    id: 'max',
    name: 'Max',
    type: 'credit_card',
    detectionKeywords: ['max', 'מקס איט', 'ליאומי קארד', 'תאריך עסקה', 'תאריך חיוב'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      chargeDate: 1,
      merchant: 2,
      amount: 3,
      originalAmount: 5,
      originalCurrency: 6,
      installmentInfo: 7,
    },
    amountConvention: 'signed',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Leumi-Card (legacy / pre-Max name) --------
  {
    id: 'leumi-card',
    name: 'לאומי-קארד',
    type: 'credit_card',
    detectionKeywords: ['leumi card', 'לאומי קארד', 'leumi-card'],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      chargeDate: 1,
      merchant: 2,
      amount: 3,
    },
    amountConvention: 'signed',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },
];

/** Score how well a parsed file matches a template. Higher score = better match. */
export function scoreTemplate(
  template: InstitutionTemplate,
  sampleText: string,
): number {
  const lc = sampleText.toLowerCase();
  let score = 0;
  for (const kw of template.detectionKeywords) {
    if (lc.includes(kw.toLowerCase())) score += 10;
  }
  return score;
}

/** Pick the best-matching template for a file, or null if no template scores high enough. */
export function detectInstitution(sampleText: string): InstitutionTemplate | null {
  let best: { template: InstitutionTemplate; score: number } | null = null;
  for (const t of INSTITUTION_TEMPLATES) {
    const score = scoreTemplate(t, sampleText);
    if (score > 0 && (!best || score > best.score)) {
      best = { template: t, score };
    }
  }
  return best && best.score >= 10 ? best.template : null;
}

/** Find the row that contains real headers — the row with the most known column-name keywords. */
export function findHeaderRow(rows: unknown[][]): number {
  const headerKeywords = [
    'תאריך', 'date',
    'סכום', 'amount',
    'בית עסק', 'תיאור', 'merchant', 'description',
    'חובה', 'זכות', 'debit', 'credit',
    'יתרה', 'balance',
  ];
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const text = row.map((c) => String(c ?? '').toLowerCase()).join(' ');
    let score = 0;
    for (const kw of headerKeywords) if (text.includes(kw.toLowerCase())) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
