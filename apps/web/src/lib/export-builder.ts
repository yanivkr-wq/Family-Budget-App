/**
 * Export builder — produces an xlsx Buffer ready to stream as a download.
 *
 * One module that knows how to assemble each sheet type. The route handler
 * (/api/export) decides WHICH sheets to include based on query params; this
 * file just provides the data fetchers + the workbook assembler.
 *
 * All fetchers are household-scoped — caller passes householdId, never trust
 * data from the client.
 *
 * Output is .xlsx via the existing `xlsx` (SheetJS) dep — no new packages.
 *
 * Hebrew column headers throughout, since this is a Hebrew app and the
 * primary use case is the user (or their accountant) reading the file
 * locally.
 */

import * as XLSX from 'xlsx';
import { and, eq, gte, lte, isNull, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '@fba/db';

export type SheetKind =
  | 'transactions'
  | 'category-summary'
  | 'recurring'
  | 'installments'
  | 'notifications'
  | 'accounts';

export interface ExportOptions {
  householdId: string;
  /** Inclusive YYYY-MM-DD range. Only applies to date-bound sheets
   *  (transactions, category-summary). Other sheets ignore. */
  dateFrom?: string | null;
  dateTo?:   string | null;
  /** Which sheets to include in the workbook. */
  sheets:    SheetKind[];
}

/** Friendly Hebrew sheet names — also used as the download filename root. */
const SHEET_NAMES_HE: Record<SheetKind, string> = {
  'transactions':     'תנועות',
  'category-summary': 'סיכום קטגוריות',
  'recurring':        'הוצאות קבועות',
  'installments':     'תוכניות תשלומים',
  'notifications':    'התראות',
  'accounts':         'חשבונות',
};

/** Build the workbook + return a Node Buffer. */
export async function buildExportWorkbook(opts: ExportOptions): Promise<{ buffer: Buffer; filename: string }> {
  const wb = XLSX.utils.book_new();

  // Build sheets in the order the user requested. We add a small "metadata"
  // sheet first so the file self-documents (date range, when generated).
  addMetadataSheet(wb, opts);

  for (const kind of opts.sheets) {
    switch (kind) {
      case 'transactions':     await addTransactionsSheet(wb, opts);     break;
      case 'category-summary': await addCategorySummarySheet(wb, opts);  break;
      case 'recurring':        await addRecurringSheet(wb, opts);        break;
      case 'installments':     await addInstallmentsSheet(wb, opts);     break;
      case 'notifications':    await addNotificationsSheet(wb, opts);    break;
      case 'accounts':         await addAccountsSheet(wb, opts);         break;
    }
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  const single = opts.sheets.length === 1 ? `_${SHEET_NAMES_HE[opts.sheets[0]!]}` : '';
  const filename = `family-budget${single}_${stamp}.xlsx`;
  return { buffer, filename };
}

// ── Metadata sheet ──────────────────────────────────────────────────────────
function addMetadataSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const rows = [
    ['Family Budget App — Excel Export'],
    [],
    ['נוצר בתאריך', new Date().toLocaleString('he-IL')],
    ['טווח תאריכים', `${opts.dateFrom ?? 'מההתחלה'} עד ${opts.dateTo ?? 'היום'}`],
    ['גליונות בקובץ', opts.sheets.map((s) => SHEET_NAMES_HE[s]).join(' · ')],
    [],
    ['הערות'],
    ['• סכומים שליליים = הוצאות (Outflow)'],
    ['• סכומים חיוביים = הכנסות (Income)'],
    ['• תאריכים בפורמט YYYY-MM-DD לפי לוח גרגוריאני'],
    ['• הקובץ מכיל נתונים שלא הוחרגו ע"י פרויקטים — תנועות פרויקטים מסומנות בעמודה ייעודית'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, 'מידע');
}

// ── Sheet: Transactions ─────────────────────────────────────────────────────
async function addTransactionsSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  // Resolve account + category names in one query via joins so the export
  // is human-readable (no UUIDs leaking through).
  const rows = await db.execute<{
    transaction_date:    string;
    charge_date:         string | null;
    billing_month:       string;
    amount_ils:          string;
    currency:            string;
    original_amount:     string | null;
    original_currency:   string | null;
    merchant_normalized: string;
    merchant_raw:        string;
    notes:               string | null;
    is_recurring:        boolean;
    is_installment:      boolean;
    is_transfer:         boolean;
    is_projected:        boolean;
    excluded_from_totals: boolean;
    account_name:        string | null;
    account_type:        string | null;
    category_name:       string | null;
    sub_category_name:   string | null;
    project_name:        string | null;
  }>(sql`
    SELECT
      t.transaction_date, t.charge_date, t.billing_month,
      t.amount_ils, t.currency, t.original_amount, t.original_currency,
      t.merchant_normalized, t.merchant_raw, t.notes,
      t.is_recurring, t.is_installment, t.is_transfer, t.is_projected,
      t.excluded_from_totals,
      a.name AS account_name, a.type AS account_type,
      c.name_he AS category_name, sc.name_he AS sub_category_name,
      p.name AS project_name
    FROM transaction t
    LEFT JOIN account  a  ON a.id  = t.account_id
    LEFT JOIN category c  ON c.id  = t.category_id
    LEFT JOIN category sc ON sc.id = t.sub_category_id
    LEFT JOIN project  p  ON p.id  = t.project_id
    WHERE t.household_id = ${opts.householdId}
      AND t.deleted_at IS NULL
      ${opts.dateFrom ? sql`AND t.transaction_date >= ${opts.dateFrom}` : sql``}
      ${opts.dateTo   ? sql`AND t.transaction_date <= ${opts.dateTo}`   : sql``}
    ORDER BY t.transaction_date DESC
  `);

  // Map to a flat shape with Hebrew headers. SheetJS uses the object keys
  // as headers, so we use Hebrew property names directly.
  const data = rows.map((r) => ({
    'תאריך עסקה':        r.transaction_date,
    'תאריך חיוב':        r.charge_date ?? '',
    'מחזור חיוב':        r.billing_month,
    'סכום':              Number(r.amount_ils),
    'מטבע':              r.currency,
    'סכום מקורי':        r.original_amount ? Number(r.original_amount) : '',
    'מטבע מקורי':        r.original_currency ?? '',
    'בית עסק':           r.merchant_normalized,
    'בית עסק (גולמי)':   r.merchant_raw,
    'קטגוריה':           r.category_name ?? '',
    'תת-קטגוריה':        r.sub_category_name ?? '',
    'חשבון':             r.account_name ?? '',
    'סוג חשבון':         r.account_type ?? '',
    'פרויקט':            r.project_name ?? '',
    'הערות':             r.notes ?? '',
    'קבועה':             r.is_recurring ? 'כן' : '',
    'תשלומים':           r.is_installment ? 'כן' : '',
    'העברה':             r.is_transfer ? 'כן' : '',
    'צפויה':             r.is_projected ? 'כן' : '',
    'הוחרגה מסיכומים':   r.excluded_from_totals ? 'כן' : '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  // Set column widths so it doesn't open as cramped wall-of-text.
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 6 },
    { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 18 },
    { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 30 },
    { wch: 8 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['transactions']);
}

// ── Sheet: Category summary (per-month totals by category) ──────────────────
async function addCategorySummarySheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  const rows = await db.execute<{
    billing_month: string;
    category:      string;
    expenses:      string;
    income:        string;
    txn_count:     number;
  }>(sql`
    SELECT
      t.billing_month,
      coalesce(c.name_he, '(ללא קטגוריה)') AS category,
      sum(case when t.amount_ils < 0 then abs(t.amount_ils) else 0 end) AS expenses,
      sum(case when t.amount_ils > 0 then t.amount_ils else 0 end)       AS income,
      count(*)::int                                                       AS txn_count
    FROM transaction t
    LEFT JOIN category c ON c.id = t.category_id
    WHERE t.household_id = ${opts.householdId}
      AND t.deleted_at IS NULL
      AND t.is_projected = false
      AND t.is_transfer = false
      AND t.excluded_from_totals = false
      AND t.project_id IS NULL
      ${opts.dateFrom ? sql`AND t.transaction_date >= ${opts.dateFrom}` : sql``}
      ${opts.dateTo   ? sql`AND t.transaction_date <= ${opts.dateTo}`   : sql``}
    GROUP BY t.billing_month, c.name_he
    ORDER BY t.billing_month DESC, expenses DESC
  `);

  const data = rows.map((r) => ({
    'מחזור חיוב':   r.billing_month,
    'קטגוריה':      r.category,
    'הוצאות':       Number(r.expenses),
    'הכנסות':       Number(r.income),
    'מספר תנועות':  r.txn_count,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['category-summary']);
}

// ── Sheet: Recurring patterns ───────────────────────────────────────────────
async function addRecurringSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  const rows = await db.execute<{
    merchant: string;
    description: string | null;
    category: string | null;
    amount_mode: string;
    expected_amount_ils: string;
    min_amount_ils: string | null;
    max_amount_ils: string | null;
    frequency: string;
    status: string;
    occurrence_count: number;
    first_seen_month: string;
    last_seen_month: string;
    subscription_end_date: string | null;
    auto_renew: boolean;
    cancel_notice_days: number;
    notes: string | null;
  }>(sql`
    SELECT
      p.merchant_normalized AS merchant, p.description,
      c.name_he AS category,
      p.amount_mode, p.expected_amount_ils, p.min_amount_ils, p.max_amount_ils,
      p.frequency, p.status, p.occurrence_count,
      p.first_seen_month, p.last_seen_month,
      p.subscription_end_date, p.auto_renew, p.cancel_notice_days,
      p.notes
    FROM recurring_pattern p
    LEFT JOIN category c ON c.id = p.category_id
    WHERE p.household_id = ${opts.householdId}
    ORDER BY p.status, p.merchant_normalized
  `);

  const data = rows.map((r) => ({
    'בית עסק':              r.merchant,
    'תיאור':                r.description ?? '',
    'קטגוריה':              r.category ?? '',
    'סוג סכום':             r.amount_mode,
    'סכום צפוי':            Number(r.expected_amount_ils),
    'מינימום':              r.min_amount_ils ? Number(r.min_amount_ils) : '',
    'מקסימום':              r.max_amount_ils ? Number(r.max_amount_ils) : '',
    'תדירות':               r.frequency,
    'סטטוס':                r.status,
    'מספר חיובים':          r.occurrence_count,
    'חודש ראשון':           r.first_seen_month,
    'חודש אחרון':           r.last_seen_month,
    'תאריך סיום מנוי':      r.subscription_end_date ?? '',
    'מתחדש אוטומטית':       r.auto_renew ? 'כן' : 'לא',
    'ימי הודעה לביטול':     r.cancel_notice_days,
    'הערות':                r.notes ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 25 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['recurring']);
}

// ── Sheet: Installment plans ────────────────────────────────────────────────
async function addInstallmentsSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  const rows = await db.execute<{
    merchant: string;
    description: string | null;
    account_name: string | null;
    payment_amount_ils: string;
    total_payments: number | null;
    current_payment_no: number;
    start_month: string;
    projected_end_month: string | null;
    actual_end_month: string | null;
    status: string;
    notes: string | null;
  }>(sql`
    SELECT
      ip.merchant_normalized AS merchant, ip.description,
      a.name AS account_name,
      ip.payment_amount_ils, ip.total_payments, ip.current_payment_no,
      ip.start_month, ip.projected_end_month, ip.actual_end_month,
      ip.status, ip.notes
    FROM installment_plan ip
    LEFT JOIN account a ON a.id = ip.account_id
    WHERE ip.household_id = ${opts.householdId}
    ORDER BY ip.status, ip.start_month DESC
  `);

  const data = rows.map((r) => ({
    'בית עסק':           r.merchant,
    'תיאור':             r.description ?? '',
    'חשבון':             r.account_name ?? '',
    'סכום תשלום':        Number(r.payment_amount_ils),
    'סך תשלומים':        r.total_payments ?? '',
    'תשלום נוכחי':       r.current_payment_no,
    'חודש התחלה':        r.start_month,
    'חודש סיום צפוי':    r.projected_end_month ?? '',
    'חודש סיום בפועל':   r.actual_end_month ?? '',
    'סטטוס':             r.status,
    'הערות':             r.notes ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 25 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['installments']);
}

// ── Sheet: Notifications ────────────────────────────────────────────────────
async function addNotificationsSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  const rows = await db.execute<{
    title: string;
    description: string | null;
    due_date: string;
    status: string;
    recurrence: string;
    category: string | null;
    reminder_count: number;
    reminders_summary: string;
    recipients_summary: string;
    linked_recurring: string | null;
  }>(sql`
    SELECT
      t.title, t.description, t.due_date, t.status, t.recurrence,
      c.name_he AS category,
      (SELECT count(*)::int FROM notification_reminder r WHERE r.task_id = t.id) AS reminder_count,
      coalesce(
        (SELECT string_agg(
          (case when r.offset_days = 0 then 'ביום' else r.offset_days || 'י׳ לפני' end)
          || ' @ ' || to_char(r.fire_time, 'HH24:MI'),
          ' · '
          ORDER BY r.offset_days DESC
        ) FROM notification_reminder r WHERE r.task_id = t.id),
        ''
      ) AS reminders_summary,
      coalesce(
        (SELECT string_agg(DISTINCT nc.label, ', ')
         FROM notification_reminder r
         CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(r.recipient_contact_ids, '[]'::jsonb)) AS rcid(id)
         JOIN notification_contact nc ON nc.id::text = rcid.id
         WHERE r.task_id = t.id),
        ''
      ) AS recipients_summary,
      rp.merchant_normalized AS linked_recurring
    FROM notification_task t
    LEFT JOIN category c ON c.id = t.category_id
    LEFT JOIN recurring_pattern rp ON rp.id = t.recurring_pattern_id
    WHERE t.household_id = ${opts.householdId}
    ORDER BY t.status, t.due_date DESC
  `);

  const data = rows.map((r) => ({
    'כותרת':               r.title,
    'תיאור':               r.description ?? '',
    'תאריך יעד':           r.due_date,
    'סטטוס':               r.status,
    'חזרה':                r.recurrence,
    'קטגוריה':             r.category ?? '',
    'מספר תזכורות':        r.reminder_count,
    'תזכורות':             r.reminders_summary,
    'נמענים':              r.recipients_summary,
    'מקושר להוצאה קבועה':  r.linked_recurring ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 18 }, { wch: 8 }, { wch: 35 }, { wch: 25 }, { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['notifications']);
}

// ── Sheet: Accounts ────────────────────────────────────────────────────────
async function addAccountsSheet(wb: XLSX.WorkBook, opts: ExportOptions) {
  const db = getDb();
  const accounts = await db
    .select({
      name:               schema.accounts.name,
      type:               schema.accounts.type,
      purpose:            schema.accounts.purpose,
      isActive:           schema.accounts.isActive,
      lastScrapeStatus:   schema.accounts.lastScrapeStatus,
      lastScrapeAt:       schema.accounts.lastScrapedAt,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, opts.householdId))
    .orderBy(schema.accounts.name);

  const data = accounts.map((a) => ({
    'שם חשבון':           a.name,
    'סוג':                a.type,
    'מטרה':               a.purpose,
    'פעיל':               a.isActive ? 'כן' : 'לא',
    'סטטוס סנכרון אחרון': a.lastScrapeStatus ?? '',
    'סנכרון אחרון':       a.lastScrapeAt ? new Date(a.lastScrapeAt).toISOString().slice(0, 10) : '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES_HE['accounts']);
}
