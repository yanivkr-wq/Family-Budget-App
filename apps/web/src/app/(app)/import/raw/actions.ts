'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema, normalizeMerchant, computeBillingMonth } from '@fba/db';
import { auth } from '@/lib/auth';
import { smartImport } from '@/lib/smart-importer';
import { computeFileHash } from '@/lib/file-hash';

export interface RawImportPreview {
  ok: boolean;
  templateName: string | null;
  templateId: string | null;
  needsManualMapping: boolean;
  rowsParsed: number;
  errors: Array<{ row: number; reason: string }>;
  /** Sample of parsed transactions for the user to verify before commit. */
  preview: Array<{
    transactionDate: string;
    chargeDate: string | null;
    merchantRaw: string;
    amountIls: number;
    originalCurrency: string | null;
  }>;
  message?: string;
}

export interface RawImportResult {
  ok: boolean;
  inserted: number;
  duplicates: number;
  errors: Array<{ row: number; reason: string }>;
  templateName: string | null;
  importSessionId?: string;
  /** True when this exact file was previously imported successfully — caller can warn before proceeding */
  duplicateFileWarning?: { previousSessionId: string; previousFilename: string; previousAt: string };
  message?: string;
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, userId: session.user.id };
}

/** Step 1: parse the file and return a preview. Doesn't write to DB. */
export async function previewRawFile(formData: FormData): Promise<RawImportPreview> {
  await requireSession();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      templateName: null,
      templateId: null,
      needsManualMapping: false,
      rowsParsed: 0,
      errors: [],
      preview: [],
      message: 'יש לבחור קובץ.',
    };
  }
  if (file.size > 25 * 1024 * 1024) {
    return {
      ok: false,
      templateName: null,
      templateId: null,
      needsManualMapping: false,
      rowsParsed: 0,
      errors: [],
      preview: [],
      message: 'קובץ גדול מדי (מעל 25MB).',
    };
  }

  const isExcel = /\.xlsx?$/i.test(file.name);
  const buf = Buffer.from(await file.arrayBuffer());

  const parsed = await smartImport(buf, isExcel);

  if (parsed.needsManualMapping) {
    return {
      ok: false,
      templateName: null,
      templateId: null,
      needsManualMapping: true,
      rowsParsed: 0,
      errors: parsed.errors,
      preview: [],
      message:
        'לא הצלחנו לזהות את מקור הקובץ אוטומטית. נדבר על מיפוי ידני בעדכון הבא — בינתיים, נסה לייבא דרך תבנית ה-Baseline.',
    };
  }

  if (!parsed.success) {
    return {
      ok: false,
      templateName: parsed.templateUsed?.name ?? null,
      templateId: parsed.templateUsed?.id ?? null,
      needsManualMapping: false,
      rowsParsed: 0,
      errors: parsed.errors,
      preview: [],
      message: 'הקובץ זוהה אבל לא נמצאו תנועות תקינות.',
    };
  }

  return {
    ok: true,
    templateName: parsed.templateUsed!.name,
    templateId: parsed.templateUsed!.id,
    needsManualMapping: false,
    rowsParsed: parsed.transactions.length,
    errors: parsed.errors.slice(0, 50),
    preview: parsed.transactions.slice(0, 8).map((t) => ({
      transactionDate: t.transactionDate,
      chargeDate: t.chargeDate,
      merchantRaw: t.merchantRaw,
      amountIls: t.amountIls,
      originalCurrency: t.originalCurrency,
    })),
  };
}

/** Step 2: actually import. Re-parses + inserts (idempotent dedup). Creates an import_session. */
export async function commitRawImport(formData: FormData): Promise<RawImportResult> {
  const ctx = await requireSession();
  const db = getDb();

  const file = formData.get('file');
  const accountId = String(formData.get('accountId') ?? '');
  const skipDuplicateWarning = String(formData.get('forceDuplicate') ?? '') === 'true';
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, inserted: 0, duplicates: 0, errors: [], templateName: null, message: 'יש לבחור קובץ.' };
  }
  if (!accountId) {
    return { ok: false, inserted: 0, duplicates: 0, errors: [], templateName: null, message: 'יש לבחור חשבון יעד.' };
  }

  // Verify account belongs to household
  const [account] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.householdId, ctx.householdId)))
    .limit(1);
  if (!account) {
    return { ok: false, inserted: 0, duplicates: 0, errors: [], templateName: null, message: 'חשבון לא נמצא.' };
  }

  const isExcel = /\.xlsx?$/i.test(file.name);
  const buf = Buffer.from(await file.arrayBuffer());
  const fileHash = computeFileHash(buf);

  // ---- File-hash dedup: warn if same file was already imported ----
  if (!skipDuplicateWarning) {
    const [prev] = await db
      .select()
      .from(schema.importSessions)
      .where(
        and(
          eq(schema.importSessions.householdId, ctx.householdId),
          eq(schema.importSessions.fileHash, fileHash),
          eq(schema.importSessions.status, 'committed'),
        ),
      )
      .limit(1);
    if (prev) {
      return {
        ok: false,
        inserted: 0,
        duplicates: 0,
        errors: [],
        templateName: null,
        duplicateFileWarning: {
          previousSessionId: prev.id,
          previousFilename: prev.filename,
          previousAt: prev.committedAt.toISOString(),
        },
        message: `הקובץ הזה כבר הועלה בעבר (${prev.filename}, ${prev.committedAt.toLocaleString('he-IL')}). להמשיך בכל זאת?`,
      };
    }
  }

  const parsed = await smartImport(buf, isExcel);

  if (!parsed.success) {
    return {
      ok: false,
      inserted: 0,
      duplicates: 0,
      errors: parsed.errors,
      templateName: parsed.templateUsed?.name ?? null,
      message: parsed.needsManualMapping ? 'לא זוהה מקור הקובץ.' : 'לא נמצאו תנועות תקינות.',
    };
  }

  // Create import session up front so each transaction can link back to it
  const [importSession] = await db
    .insert(schema.importSessions)
    .values({
      householdId: ctx.householdId,
      actorUserId: ctx.userId,
      filename: file.name,
      fileHash,
      fileSize: file.size,
      accountId: account.id,
      sourceType: 'raw_bank',
      templateUsed: parsed.templateUsed!.id,
      status: 'committed', // we'll only get here if parsing succeeded
    })
    .returning();
  const importSessionId = importSession!.id;

  // Build inserts
  const inserts: typeof schema.transactions.$inferInsert[] = parsed.transactions.map((t) => {
    // For credit cards with a charge_date, use it; otherwise transaction_date
    const billingMonth = (t.chargeDate ?? t.transactionDate).slice(0, 7);
    // Forex exception: if originalCurrency is set and not ILS, use transaction_date for billing
    const isForex = !!t.originalCurrency && t.originalCurrency.toUpperCase() !== 'ILS';
    const finalBillingMonth = isForex
      ? t.transactionDate.slice(0, 7)
      : computeBillingMonth(t.chargeDate ?? t.transactionDate, account.cutoffDay);

    return {
      householdId: ctx.householdId,
      accountId: account.id,
      transactionDate: t.transactionDate,
      postedDate: t.chargeDate ?? null,
      billingMonth: finalBillingMonth,
      amountIls: String(t.amountIls),
      currency: 'ILS',
      originalAmount: t.originalAmount ? String(t.originalAmount) : null,
      originalCurrency: t.originalCurrency,
      merchantRaw: t.merchantRaw,
      merchantNormalized: normalizeMerchant(t.merchantRaw),
      isManual: false, // came from a real bank export
      notes: t.notes,
      externalId: null,
      importSessionId,
    };
  });

  // Idempotent dedup
  const monthSet = Array.from(new Set(inserts.map((i) => i.billingMonth as string)));
  const existing =
    monthSet.length > 0
      ? await db
          .select({
            accountId: schema.transactions.accountId,
            transactionDate: schema.transactions.transactionDate,
            amountIls: schema.transactions.amountIls,
            merchantNormalized: schema.transactions.merchantNormalized,
          })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.householdId, ctx.householdId),
              inArray(schema.transactions.billingMonth, monthSet),
              isNull(schema.transactions.deletedAt),
            ),
          )
      : [];
  const key = (r: { accountId: string; transactionDate: string; amountIls: string; merchantNormalized: string }) =>
    `${r.accountId}|${r.transactionDate}|${r.amountIls}|${r.merchantNormalized}`;
  const existingSet = new Set(existing.map(key));

  const dedupedInserts = inserts.filter((row) => {
    const k = key({
      accountId: row.accountId,
      transactionDate: row.transactionDate as string,
      amountIls: row.amountIls as string,
      merchantNormalized: row.merchantNormalized as string,
    });
    if (existingSet.has(k)) return false;
    existingSet.add(k);
    return true;
  });
  const duplicates = inserts.length - dedupedInserts.length;

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < dedupedInserts.length; i += BATCH) {
    const batch = dedupedInserts.slice(i, i + BATCH);
    const r = await db.insert(schema.transactions).values(batch).returning({ id: schema.transactions.id });
    inserted += r.length;
  }

  // Update the import session with final counts and which months were touched
  const monthsTouched = Array.from(new Set(inserts.map((i) => i.billingMonth as string))).sort();
  await db
    .update(schema.importSessions)
    .set({
      insertedCount: inserted,
      duplicateCount: duplicates,
      errorCount: parsed.errors.length,
      billingMonths: monthsTouched,
    })
    .where(eq(schema.importSessions.id, importSessionId));

  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'import',
    entityType: 'import_session',
    entityId: importSessionId,
    afterJson: {
      source: 'raw_bank',
      filename: file.name,
      template: parsed.templateUsed!.id,
      accountId,
      inserted,
      duplicates,
      errors: parsed.errors.length,
      months: monthsTouched,
    } as object,
  });

  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');
  revalidatePath('/import/raw');
  revalidatePath('/admin/imports');

  return {
    ok: true,
    inserted,
    duplicates,
    importSessionId,
    errors: parsed.errors.slice(0, 50),
    templateName: parsed.templateUsed!.name,
  };
}
