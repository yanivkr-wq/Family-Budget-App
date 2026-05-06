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
    /** Bank's own categorization label (Hebrew name like "מסעדות" / "אנרגיה").
     *  We map these to our household categories in the import action — used
     *  as a fallback when no user rule matches. */
    categoryHint?: number;
    /** Bank's own sub-category label (only present in tagged-export formats
     *  like the user's own custom Excel). Mapped via exact-name match
     *  against the household's sub-categories. */
    subCategoryHint?: number;
    /** Truthy column → mark this row's merchant as recurring (creates a
     *  recurring_pattern row + the קבוע badge fires on /transactions). */
    recurringFlag?: number;
    /** Truthy column → mark the transaction as inter-account transfer
     *  (sets is_transfer = true). */
    transferFlag?: number;
    /** Account name baked into a fixed column (some custom exports write
     *  "חשבון דיסקונט" in every row). When set, used as a hint for
     *  account routing — but the import action's accountId param wins. */
    accountNameHint?: number;
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
    /** Notes column carries forex info as a free-form string like
     *  "סכום העסקה הוא 20.0 $" / "סכום העסקה הוא 14,90 €". When set, we
     *  parse this out and populate originalAmount + originalCurrency. */
    forexFromNotesString?: boolean;
  };
}

export const INSTITUTION_TEMPLATES: InstitutionTemplate[] = [
  // -------- Personal tagged-export (custom Excel maintained by the user) --------
  // Detection: this format has TWO very specific column names that don't
  // appear in any bank's native export — "תת קטגוריה" + "חוזר" +
  // "העברה בין חשבונות". When all three are present, this is hand-tagged
  // data, not a raw bank export.
  // Layout per the user's May-2026 file:
  //   col 0 = תאריך
  //   col 1 = חשבון  ← account name baked in (e.g., "חשבון דיסקונט")
  //   col 2 = ₪ זכות/חובה  ← signed amount
  //   col 3 = תיאור התנועה
  //   col 4 = קטגוריה  ← user's own category name (matches household)
  //   col 5 = תת קטגוריה
  //   col 6 = חוזר  ← truthy = recurring
  //   col 7 = העברה בין חשבונות  ← truthy = transfer
  //   col 8 = הערה
  // Listed FIRST so its specific keyword score beats bank templates.
  {
    id: 'tagged-export',
    name: 'אקסל מתוייג ידנית (קטגוריה + חוזר + העברה)',
    type: 'bank',
    detectionKeywords: [
      'תת קטגוריה',
      'העברה בין חשבונות',
      'חוזר',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate:  0,
      accountNameHint:  1,  // baked in per row, used as a sanity-check hint
      amount:           2,  // signed
      merchant:         3,  // תיאור התנועה
      categoryHint:     4,  // exact match against household categories
      subCategoryHint:  5,  // exact match against household sub-categories
      recurringFlag:    6,  // truthy → create recurring_pattern
      transferFlag:     7,  // truthy → set is_transfer
      notes:            8,
    },
    amountConvention: 'signed',
    dateFormat: 'auto',
    defaultIsExpense: true,
  },

  // -------- Bank Leumi business — HTML-as-.xls export --------
  // Leumi's web portal serves business-account "Excel" downloads as HTML
  // tables with .xls extension and an HTML MIME type. xlsx-js can't parse
  // them as real workbooks; we sniff for `<HTML…` magic and parse the
  // <table> rows ourselves (see smart-importer's looksLikeHtml /
  // parseHtmlTable). Once extracted, the table layout is:
  //   col 0 = תאריך (transaction date)
  //   col 1 = תאריך ערך (value date)
  //   col 2 = תיאור (description / merchant)
  //   col 3 = אסמכתא (reference number — NOT amount!)
  //   col 4 = בחובה (debit)
  //   col 5 = בזכות (credit)
  //   col 6 = היתרה בש"ח (balance)
  //   col 7 = הערה (notes)
  //
  // Listed BEFORE the generic Hapoalim template so its more-specific
  // keywords win. Detection requires "בחובה"+"בזכות" together — that
  // exact pair is what distinguishes this format from the single-signed
  // ₪ זכות/חובה column the new Leumi/Discount checking exports use.
  {
    id: 'leumi-business-html',
    name: 'בנק לאומי — עו״ש עסקי (HTML)',
    type: 'bank',
    detectionKeywords: [
      'בנק לאומי',
      'בחובה', 'בזכות',
      'מס\' חשבון',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      merchant:        2,
      debit:           4,
      credit:          5,
      balance:         6,
      notes:           7,
    },
    amountConvention: 'split_debit_credit',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
  },

  // -------- Bank Hapoalim (CSV/Excel export) --------
  // Detection: REQUIRES the bank's name + a column-name keyword to avoid
  // greedy matches against generic exports. Pure header keywords like
  // "תאריך ערך" alone aren't enough — every bank export has them.
  {
    id: 'hapoalim',
    name: 'בנק הפועלים',
    type: 'bank',
    detectionKeywords: ['בנק הפועלים', 'הפועלים'],
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

  // -------- Israeli current-account "עובר ושב" (Leumi + Discount) --------
  // Same layout across both banks (verified May-2026 exports):
  //   col 0 = תאריך
  //   col 1 = יום ערך
  //   col 2 = תיאור התנועה
  //   col 3 = ₪ זכות/חובה  ← single SIGNED amount column (not split)
  //   col 4 = ₪ יתרה
  //   col 5 = אסמכתה
  //   col 6 = עמלה
  //   col 7 = ערוץ ביצוע
  // Negative = debit, positive = credit. ID kept as 'leumi' for backward
  // compatibility with audit_log entries from earlier imports.
  {
    id: 'leumi',
    name: 'עו״ש ישראלי (לאומי / דיסקונט)',
    type: 'bank',
    detectionKeywords: [
      'לאומי', 'דיסקונט',
      'תיאור התנועה', 'יום ערך',
      'יתרה לאחר',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,  // תאריך
      merchant:        2,  // תיאור התנועה
      amount:          3,  // ₪ זכות/חובה — signed
      balance:         4,  // ₪ יתרה
    },
    amountConvention: 'signed',
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

  // -------- Israeli CC-issuer portal export (Cal, Diners, Max, etc.) --------
  // Newer 7-column format the issuers ship (as opposed to the bank-portal
  // bank_export). Same shape across כ.א.ל ויזה / דיינרס / מקס etc.
  // Layout per the May-2026 export:
  //   col 0 = תאריך עסקה
  //   col 1 = שם בית עסק
  //   col 2 = סכום בש"ח (always ILS, prefixed with "₪ ")
  //   col 3 = מועד חיוב (per-row charge date)
  //   col 4 = סוג עסקה (רגילה / הוראת קבע / תשלומים / משיכת מזומן / חיוב חודשי)
  //   col 5 = מזהה כרטיס בארנק דיגיטלי (e.g., "GooglePay 9648", "אינטרנט 3767")
  //   col 6 = הערות
  // Notes col patterns we extract:
  //   • "סכום העסקה הוא X.XX $" → forex original amount + currency
  //   • "עסקה ב-N תשלומים"     → installment marker (N total, currentNo=1)
  //   • "תשלום N מתוך Y"        → installment marker (existing pattern)
  // Detection: requires the unique "מזהה כרטיס בארנק דיגילטי" header (typo
  // "דיגילטי" instead of "דיגיטלי" — the issuers ship it that way) plus
  // "סכום בש"ח" to differentiate from the bank-portal exports.
  {
    id: 'il-cc-issuer-export',
    name: 'ייצוא ישיר מחברת אשראי (כ.א.ל / דיינרס / מקס)',
    type: 'credit_card',
    detectionKeywords: [
      'מזהה כרטיס בארנק דיגילטי',
      'מזהה כרטיס בארנק',
      'סכום בש"ח',
      'פירוט עסקאות וזיכויים',
    ],
    headerRowIndex: 'auto',
    columns: {
      transactionDate: 0,
      merchant:        1,
      amount:          2,  // signed (the value comes "₪ 59.94" — prefix stripped by parseAmount)
      chargeDate:      3,  // per-row
      type:            4,  // for filtering / future use
      notes:           6,
    },
    amountConvention: 'signed',
    dateFormat: 'dd/mm/yyyy',
    defaultIsExpense: true,
    formatHandling: {
      // Forex info is embedded in the notes string ("סכום העסקה הוא 20.0 $")
      forexFromNotesString: true,
    },
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
      categoryHint:    5, // ענף — bank's own category label (e.g. "מסעדות", "דלק")
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
      categoryHint:     2,  // קטגוריה — bank's own category label (e.g. "אוכל ומשקאות")
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
      // Sheet name patterns that contain forex / abroad transactions.
      // Newer exports add "עסקאות בארנק מט"ח" (digital wallet forex)
      // alongside the existing "עסקאות חו"ל ומט"ח". Both flag the whole
      // sheet for immediate-charge handling.
      forexSheetPattern: /חו["'״]ל|מט["'״]ח|ארנק.*מט/,
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
