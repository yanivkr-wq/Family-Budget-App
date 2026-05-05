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
  /** Per-template behaviour flags for handling format quirks that don't fit the
   *  generic column-mapping model. The smart-importer checks each flag and
   *  applies the corresponding logic. */
  formatHandling?: {
    /** Scan rows BEFORE the header for "לחיוב ב-DD/MM/YYYY" — use as
     *  chargeDate for every row in the file. Used when the file applies a
     *  single charge date globally and only writes it once at the top. */
    chargeDateFromHeaderRow?: boolean;
    /** col 2's raw cell value carries the original amount with a currency
     *  prefix ("$ 20.00", "€ 14,90"). Extract original amount + currency from
     *  the prefix when it's not ₪. */
    forexFromAmountPrefix?: boolean;
    /** Which column carries the prefixed original amount (default: 2). */
    forexPrefixColumn?: number;
    /** Read ALL sheets, not just the first. Used by multi-sheet exports
     *  (e.g. Discount Key keeps forex on its own sheet). */
    multiSheet?: boolean;
    /** When set, rows from a sheet whose name matches this pattern are
     *  flagged as forex and get chargeDate = transactionDate (immediate). */
    forexSheetPattern?: RegExp;
    /** Substring in the notes column that marks a row as pending — skip
     *  silently (no error reported). */
    pendingNotesMarker?: string;
  };
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

  // -------- Israeli "bank-portal" CC export (Diners via Leumi, Visa via Discount, etc.) --------
  // The bank's online portal exports your CC charges. Same structure
  // regardless of which bank/CC. Single sheet, 7 columns. Charge date is in
  // a header row above the data ("עסקאות לחיוב ב-DD/MM/YYYY") and is the
  // SAME for every row in the file. Forex rows have a non-₪ prefix in col 2
  // ("$ 20.00", "€ 14,90") — we extract the original currency from there
  // while col 3 always gives the ILS-converted charge.
  {
    id: 'il-cc-bank-export',
    name: 'CC export מבנק (לאומי / דיסקונט / וכד׳)',
    type: 'credit_card',
    detectionKeywords: [
      'פירוט עסקאות לחשבון',
      'סכום עסקה',
      'סכום חיוב',
      'עסקאות לחיוב ב',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0, // תאריך עסקה
      merchant:        1, // שם בית עסק
      amount:          3, // סכום חיוב — always ILS, after FX conversion
      type:            4, // סוג עסקה (רגילה / הוראת קבע / שירותים / תשלומים)
      notes:           6, // הערות (sometimes carries "עסקה בקליטה" for pending)
    },
    amountConvention: 'signed',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
    formatHandling: {
      chargeDateFromHeaderRow: true,
      forexFromAmountPrefix:   true,
      forexPrefixColumn:       2,
      pendingNotesMarker:      'עסקה בקליטה',
    },
  },

  // -------- Discount Key (מפתח דיסקונט) — multi-card aggregator export --------
  // Two sheets: regular ILS transactions + a separate forex/חו"ל sheet. 16 cols
  // with proper per-row charge dates, original-currency support, and embedded
  // installment markers in the notes ("תשלום N מתוך Y"). One file can contain
  // multiple cards (col 3 = last 4 digits) — the upload action handles
  // per-card → account routing on top of the parsed rows.
  {
    id: 'discount-key',
    name: 'מפתח דיסקונט (Discount Key)',
    type: 'credit_card',
    detectionKeywords: [
      'מפתח דיסקונט',
      'כל הכרטיסים',
      'תאריך חיוב',
      'מטבע חיוב',
      '4 ספרות אחרונות',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate:  0,  // תאריך עסקה
      merchant:         1,  // שם בית העסק
      // col 2 = קטגוריה (the bank's own — useful as a hint, not mapped)
      // col 3 = 4 ספרות אחרונות של כרטיס האשראי (handled by upload action)
      type:             4,  // סוג עסקה (רגילה / תשלומים / חיוב עסקות מיידי / etc.)
      amount:           5,  // סכום חיוב — always ILS
      originalAmount:   7,  // סכום עסקה מקורי
      originalCurrency: 8,  // מטבע עסקה מקורי
      chargeDate:       9,  // תאריך חיוב — actual per-row charge date
      notes:            10, // הערות — installment info ("תשלום N מתוך Y") lives here
    },
    amountConvention: 'signed',
    dateFormat: 'dd-mm-yyyy',
    defaultIsExpense: true,
    formatHandling: {
      multiSheet:        true,
      // Sheet name "עסקאות חו"ל ומט"ח" — match on "חו"ל" or "ומט"ח" since
      // the smart quote may vary between exports.
      forexSheetPattern: /חו["'״]ל|ומט["'״]ח/,
    },
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
