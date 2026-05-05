'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  getDb,
  schema,
  computeBillingMonth,
  normalizeMerchant,
  type Database,
} from '@fba/db';
import { auth } from '@/lib/auth';
import { parseCsv, detectColumnMap, parseFlexibleDate, parseFlexibleAmount } from '@/lib/csv';
import { parseUserExcel, parseBusinessIncome, accountNameFromCode } from '@/lib/excel-importer';
import {
  parseBaselineExcel,
  findTransferPairs,
  type BaselineTransaction,
} from '@/lib/baseline-importer';
import { computeFileHash } from '@/lib/file-hash';

export interface ImportRowError {
  rowNumber: number;
  reason: string;
  raw?: string[];
  sheet?: string;
}

export interface ImportResult {
  ok: boolean;
  inserted: number;
  duplicates: number;
  errors: ImportRowError[];
  createdAccounts: string[];
  createdCategories: string[];
  unmatchedCategories: string[];
  monthsImported: string[];
  columnsDetected?: Record<string, number>;
  headers?: string[];
  message?: string;
}

interface SessionContext {
  householdId: string;
  userId: string;
}

async function requireSession(): Promise<SessionContext> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  return { householdId: session.user.householdId, userId: session.user.id };
}

export async function importCsv(formData: FormData): Promise<ImportResult> {
  const ctx = await requireSession();
  const db = getDb();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return emptyResult({ ok: false, message: 'יש לבחור קובץ.' });
  }
  if (file.size > 25 * 1024 * 1024) {
    return emptyResult({ ok: false, message: 'קובץ גדול מדי (מעל 25MB).' });
  }

  const isExcel =
    /\.xlsx$/i.test(file.name) ||
    /\.xls$/i.test(file.name) ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel';

  if (!isExcel) return importCsvFile(db, ctx, file);

  // Detect: if the Excel has Accounts + Transactions sheets → it's the new baseline format.
  // Otherwise → legacy multi-sheet "monthly" format.
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const baseline = parseBaselineExcel(buf);
    if (baseline.hasBaselineFormat) {
      return importBaselineFile(db, ctx, file, baseline, buf);
    }
  } catch {
    // fall through to legacy parser
  }
  return importLegacyExcelFile(db, ctx, file, buf);
}

// ---------- BASELINE Excel path (clean structured template) ----------

async function importBaselineFile(
  db: Database,
  ctx: SessionContext,
  file: File,
  baseline: ReturnType<typeof parseBaselineExcel>,
  buf: Buffer,
): Promise<ImportResult> {
  if (baseline.transactions.length === 0 && baseline.accounts.length === 0) {
    return emptyResult({ ok: false, message: 'הקובץ ריק — אין נתונים בגליון Accounts או Transactions.' });
  }

  // Create import session immediately so every transaction below can reference it
  const fileHash = computeFileHash(buf);
  const [importSession] = await db
    .insert(schema.importSessions)
    .values({
      householdId: ctx.householdId,
      actorUserId: ctx.userId,
      filename: file.name,
      fileHash,
      fileSize: file.size,
      sourceType: 'baseline',
      status: 'committed',
    })
    .returning();
  const importSessionId = importSession!.id;

  const createdAccounts: string[] = [];
  const createdCategories: string[] = [];
  const errors: ImportRowError[] = baseline.errors.map((e) => ({
    rowNumber: e.row,
    sheet: e.sheet,
    reason: e.reason,
  }));

  // ---- Upsert accounts ----
  const existingAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, ctx.householdId));
  const accountByName = new Map<string, { id: string; purpose: string }>(
    existingAccounts.map((a) => [a.name.toLowerCase().trim(), { id: a.id, purpose: a.purpose }]),
  );

  for (const a of baseline.accounts) {
    const key = a.name.toLowerCase().trim();
    const existing = accountByName.get(key);
    if (existing) {
      await db
        .update(schema.accounts)
        .set({ purpose: a.purpose, type: a.type, institution: a.institution })
        .where(eq(schema.accounts.id, existing.id));
    } else {
      const [created] = await db
        .insert(schema.accounts)
        .values({
          householdId: ctx.householdId,
          name: a.name,
          type: a.type,
          purpose: a.purpose,
          institution: a.institution,
          cutoffDay: 0,
        })
        .returning();
      accountByName.set(key, { id: created!.id, purpose: a.purpose });
      createdAccounts.push(a.name);
    }
  }

  // ---- Upsert categories (auto-create unknown ones referenced in transactions) ----
  const existingCats = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.householdId, ctx.householdId));
  const topByName = new Map<string, string>();
  const subByName = new Map<string, { id: string; parentId: string }>();
  for (const c of existingCats) {
    if (c.parentId) {
      subByName.set(c.nameHe.toLowerCase().trim(), { id: c.id, parentId: c.parentId });
    } else {
      topByName.set(c.nameHe.toLowerCase().trim(), c.id);
    }
  }

  // First, materialize categories from explicit Categories sheet (with targets/colors)
  for (const cat of baseline.categories) {
    const key = cat.nameHe.toLowerCase().trim();
    if (cat.parent) {
      // Sub-category
      const parentId = topByName.get(cat.parent.toLowerCase().trim());
      if (!parentId) {
        // Parent doesn't exist yet — create it first
        const [createdParent] = await db
          .insert(schema.categories)
          .values({ householdId: ctx.householdId, nameHe: cat.parent, sortOrder: 0 })
          .returning();
        topByName.set(cat.parent.toLowerCase().trim(), createdParent!.id);
        createdCategories.push(cat.parent);
      }
      const finalParentId = topByName.get(cat.parent.toLowerCase().trim())!;
      if (!subByName.has(key)) {
        const [createdSub] = await db
          .insert(schema.categories)
          .values({
            householdId: ctx.householdId,
            nameHe: cat.nameHe,
            parentId: finalParentId,
            sortOrder: 0,
            color: cat.color ?? null,
          })
          .returning();
        subByName.set(key, { id: createdSub!.id, parentId: finalParentId });
      }
    } else {
      if (!topByName.has(key)) {
        const [createdTop] = await db
          .insert(schema.categories)
          .values({
            householdId: ctx.householdId,
            nameHe: cat.nameHe,
            monthlyTargetIls: cat.monthlyTargetIls ? String(cat.monthlyTargetIls) : null,
            color: cat.color ?? null,
            sortOrder: topByName.size,
            isIncome: cat.nameHe === 'הכנסות' || cat.nameHe === 'משכורת',
          })
          .returning();
        topByName.set(key, createdTop!.id);
        createdCategories.push(cat.nameHe);
      } else if (cat.monthlyTargetIls) {
        await db
          .update(schema.categories)
          .set({ monthlyTargetIls: String(cat.monthlyTargetIls), color: cat.color ?? undefined })
          .where(eq(schema.categories.id, topByName.get(key)!));
      }
    }
  }

  // Auto-create top categories referenced in transactions
  for (const t of baseline.transactions) {
    if (t.categoryName) {
      const key = t.categoryName.toLowerCase().trim();
      if (!topByName.has(key)) {
        const isIncomeCat = t.categoryName === 'הכנסות' || t.categoryName === 'משכורת';
        const [created] = await db
          .insert(schema.categories)
          .values({
            householdId: ctx.householdId,
            nameHe: t.categoryName,
            sortOrder: topByName.size,
            isIncome: isIncomeCat,
          })
          .returning();
        topByName.set(key, created!.id);
        createdCategories.push(t.categoryName);
      }
    }
  }

  // Auto-create sub-categories referenced in transactions
  for (const t of baseline.transactions) {
    if (t.categoryName && t.subCategoryName) {
      const subKey = t.subCategoryName.toLowerCase().trim();
      if (!subByName.has(subKey)) {
        const parentId = topByName.get(t.categoryName.toLowerCase().trim())!;
        const [created] = await db
          .insert(schema.categories)
          .values({
            householdId: ctx.householdId,
            nameHe: t.subCategoryName,
            parentId,
            sortOrder: 0,
          })
          .returning();
        subByName.set(subKey, { id: created!.id, parentId });
      }
    }
  }

  // ---- Construction project ----
  const hasConstruction = baseline.transactions.some((t) => t.isConstructionProject);
  let constructionProjectId: string | null = null;
  if (hasConstruction) {
    const existingProj = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.householdId, ctx.householdId),
          eq(schema.projects.name, 'בניית בית'),
        ),
      )
      .limit(1);
    if (existingProj.length > 0) {
      constructionProjectId = existingProj[0]!.id;
    } else {
      const [created] = await db
        .insert(schema.projects)
        .values({
          householdId: ctx.householdId,
          name: 'בניית בית',
          color: '#8b5cf6',
          status: 'active',
          excludeFromMonthlyTotals: true,
        })
        .returning();
      constructionProjectId = created!.id;
    }
  }

  // ---- Build inserts ----
  const cur = new Date();
  const currentBillingMonth = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
  const inserts: Array<typeof schema.transactions.$inferInsert & { _idx: number }> = [];

  for (let idx = 0; idx < baseline.transactions.length; idx++) {
    const t = baseline.transactions[idx]!;
    const accountKey = t.accountName.toLowerCase().trim();
    const acc = accountByName.get(accountKey);
    if (!acc) {
      errors.push({
        rowNumber: t.sourceRow,
        sheet: t.isConstructionProject ? 'Construction' : 'Transactions',
        reason: `חשבון לא נמצא: "${t.accountName}". הוסף אותו לגליון Accounts ונסה שוב.`,
      });
      continue;
    }

    const billingMonth = t.date.slice(0, 7);
    const isProjected = !t.isConstructionProject && billingMonth >= currentBillingMonth && t.isRecurring;

    const categoryId = t.categoryName ? topByName.get(t.categoryName.toLowerCase().trim()) : null;
    const subCategoryId = t.subCategoryName ? subByName.get(t.subCategoryName.toLowerCase().trim())?.id : null;

    inserts.push({
      _idx: idx,
      householdId: ctx.householdId,
      accountId: acc.id,
      transactionDate: t.date,
      billingMonth,
      amountIls: String(t.amountIls),
      currency: 'ILS',
      merchantRaw: t.merchantRaw,
      merchantNormalized: normalizeMerchant(t.merchantRaw),
      categoryId: categoryId ?? null,
      subCategoryId: subCategoryId ?? null,
      projectId: t.isConstructionProject ? constructionProjectId : null,
      isRecurring: t.isRecurring,
      isTransfer: t.isTransfer,
      isProjected,
      isManual: true,
      notes: t.notes,
      externalId: null,
      importSessionId,
    });
  }

  // ---- Idempotent dedup ----
  const monthSet = Array.from(new Set(inserts.map((i) => i.billingMonth)));
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
  const existingKey = (r: { accountId: string; transactionDate: string; amountIls: string; merchantNormalized: string }) =>
    `${r.accountId}|${r.transactionDate}|${r.amountIls}|${r.merchantNormalized}`;
  const existingSet = new Set(existing.map(existingKey));

  const dedupedInserts = inserts.filter((row) => {
    const key = existingKey({
      accountId: row.accountId,
      transactionDate: row.transactionDate as string,
      amountIls: row.amountIls as string,
      merchantNormalized: row.merchantNormalized as string,
    });
    if (existingSet.has(key)) return false;
    existingSet.add(key);
    return true;
  });
  const skippedAsDuplicates = inserts.length - dedupedInserts.length;

  let inserted = 0;
  const insertedIdToInputIdx = new Map<string, number>();
  const BATCH = 500;
  for (let i = 0; i < dedupedInserts.length; i += BATCH) {
    const batch = dedupedInserts.slice(i, i + BATCH);
    // Strip the _idx field before inserting
    const stripped = batch.map(({ _idx, ...rest }) => rest);
    const result = await db
      .insert(schema.transactions)
      .values(stripped)
      .returning({ id: schema.transactions.id });
    inserted += result.length;
    for (let k = 0; k < result.length; k++) {
      insertedIdToInputIdx.set(result[k]!.id, batch[k]!._idx);
    }
  }

  // ---- Pair up transfers ----
  const insertedTransferList = Array.from(insertedIdToInputIdx.entries())
    .map(([id, idx]) => {
      const src = baseline.transactions[idx]!;
      return { id, date: src.date, amount: src.amountIls, isTransfer: src.isTransfer };
    })
    .filter((t) => t.isTransfer);
  const pairs = findTransferPairs(insertedTransferList);
  for (const [aId, bId] of pairs) {
    await db
      .update(schema.transactions)
      .set({ transferPairId: bId })
      .where(eq(schema.transactions.id, aId));
    await db
      .update(schema.transactions)
      .set({ transferPairId: aId })
      .where(eq(schema.transactions.id, bId));
  }

  // ---- Update import session with final summary ----
  await db
    .update(schema.importSessions)
    .set({
      insertedCount: inserted,
      duplicateCount: skippedAsDuplicates,
      errorCount: errors.length,
      billingMonths: monthSet.sort(),
      createdAccounts: createdAccounts as object,
      createdCategories: createdCategories as object,
      summary: { transferPairs: pairs.length, hasConstruction } as object,
    })
    .where(eq(schema.importSessions.id, importSessionId));

  // ---- Audit log ----
  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'import',
    entityType: 'import_session',
    entityId: importSessionId,
    afterJson: {
      source: 'baseline',
      filename: file.name,
      inserted,
      duplicates: skippedAsDuplicates,
      months: monthSet,
      createdAccounts,
      createdCategories,
      transferPairs: pairs.length,
      hasConstruction,
      errors: errors.length,
    } as object,
  });

  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');
  revalidatePath('/import');
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/imports');

  return {
    ok: true,
    inserted,
    duplicates: skippedAsDuplicates,
    errors: errors.slice(0, 200),
    createdAccounts,
    createdCategories,
    unmatchedCategories: [],
    monthsImported: monthSet.sort(),
  };
}

// ---------- Excel path (legacy multi-sheet format from the user's original Excel) ----------

async function importLegacyExcelFile(
  db: Database,
  ctx: SessionContext,
  file: File,
  buf: Buffer,
): Promise<ImportResult> {
  let parsed;
  try {
    parsed = parseUserExcel(buf);
  } catch (err) {
    return emptyResult({
      ok: false,
      message: `שגיאה בפענוח האקסל: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }

  if (parsed.transactions.length === 0) {
    return emptyResult({
      ok: false,
      message: `לא נמצאו תנועות. גליונות שזוהו כחודשיים: ${parsed.monthlySheets.join(', ') || 'אין'}.`,
    });
  }

  const createdCategories: string[] = [];
  const createdAccounts: string[] = [];
  const unmatchedCategories: string[] = [];

  const allCategories = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.householdId, ctx.householdId));
  const topByName = new Map<string, string>();
  const subByName = new Map<string, { id: string; parentId: string }>();
  for (const c of allCategories) {
    if (c.parentId) {
      const keys = [c.nameHe, c.nameEn].filter(Boolean) as string[];
      for (const k of keys) subByName.set(k.toLowerCase().trim(), { id: c.id, parentId: c.parentId });
    } else {
      const keys = [c.nameHe, c.nameEn].filter(Boolean) as string[];
      for (const k of keys) topByName.set(k.toLowerCase().trim(), c.id);
    }
  }

  // Auto-create top-level categories
  let sortOrder = allCategories.length;
  for (const name of parsed.categoriesSeen) {
    const key = name.toLowerCase().trim();
    if (topByName.has(key)) continue;
    const [created] = await db
      .insert(schema.categories)
      .values({
        householdId: ctx.householdId,
        nameHe: name,
        sortOrder: sortOrder++,
      })
      .returning();
    topByName.set(key, created!.id);
    createdCategories.push(name);
  }

  // Accounts
  const allAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, ctx.householdId));
  const accountByName = new Map<string, string>(
    allAccounts.map((a) => [a.name.toLowerCase().trim(), a.id]),
  );

  for (const code of parsed.accountsSeen) {
    const name = accountNameFromCode(code);
    const key = name.toLowerCase().trim();
    if (accountByName.has(key)) continue;
    const [created] = await db
      .insert(schema.accounts)
      .values({
        householdId: ctx.householdId,
        name,
        type: code.startsWith('ל-') || code.startsWith('י-') ? 'credit_card' : 'bank',
        institution: 'manual',
        cutoffDay: 0,
      })
      .returning();
    accountByName.set(key, created!.id);
    createdAccounts.push(name);
  }

  // Default fallback account
  let defaultAccountId = accountByName.get('ידני');
  if (!defaultAccountId) {
    const [acc] = await db
      .insert(schema.accounts)
      .values({
        householdId: ctx.householdId,
        name: 'ידני',
        type: 'bank',
        institution: 'manual',
        cutoffDay: 0,
      })
      .returning();
    defaultAccountId = acc!.id;
    accountByName.set('ידני', defaultAccountId);
  }

  const errors: ImportRowError[] = parsed.errors.map((e) => ({
    rowNumber: e.row,
    sheet: e.sheet,
    reason: e.reason,
  }));
  const inserts: typeof schema.transactions.$inferInsert[] = [];

  for (const t of parsed.transactions) {
    const accountKey = accountNameFromCode(t.accountCode).toLowerCase().trim();
    const accountId = accountByName.get(accountKey) ?? defaultAccountId;

    let categoryId: string | null = null;
    if (t.categoryName) {
      const id = topByName.get(t.categoryName.toLowerCase().trim());
      if (id) categoryId = id;
      else unmatchedCategories.push(t.categoryName);
    }

    let subCategoryId: string | null = null;
    if (t.subCategoryName && categoryId) {
      const subKey = t.subCategoryName.toLowerCase().trim();
      const existing = subByName.get(subKey);
      if (existing && existing.parentId === categoryId) {
        subCategoryId = existing.id;
      } else {
        const [createdSub] = await db
          .insert(schema.categories)
          .values({
            householdId: ctx.householdId,
            nameHe: t.subCategoryName,
            parentId: categoryId,
            sortOrder: 0,
          })
          .returning();
        subByName.set(subKey, { id: createdSub!.id, parentId: categoryId });
        subCategoryId = createdSub!.id;
      }
    }

    const isInstallment = !!t.installment;
    const notes = t.installment
      ? `תשלום ${t.installment.number}${t.installment.total ? ` מתוך ${t.installment.total}` : ''} | ${t.sheetName}`
      : null;

    inserts.push({
      householdId: ctx.householdId,
      accountId,
      transactionDate: t.date,
      billingMonth: t.billingMonth,
      amountIls: String(t.amountIls),
      currency: 'ILS',
      merchantRaw: t.merchantRaw,
      merchantNormalized: normalizeMerchant(t.merchantRaw),
      categoryId,
      subCategoryId,
      isInstallment,
      isRecurring: t.isRecurringFixed,
      isProjected: t.isProjected,
      isTransfer: t.isTransfer,
      isManual: true,
      notes,
      externalId: null,
    });
  }

  // ---- Business income from "עסק" sheet ----
  // For each monthly income total, create one positive transaction in a business account.
  // Auto-create the "הכנסות" parent category and "הכנסה עסקית" sub-category.
  // Auto-create a "חשבון עסקי" account marked as business if none exists.
  let businessAccountId = allAccounts.find((a) => a.purpose === 'business')?.id ?? null;
  if (!businessAccountId) {
    // Try existing account by name first
    const existingByName = accountByName.get('חשבון עסקי');
    if (existingByName) {
      // Mark it as business
      await db
        .update(schema.accounts)
        .set({ purpose: 'business' })
        .where(eq(schema.accounts.id, existingByName));
      businessAccountId = existingByName;
    } else {
      const [created] = await db
        .insert(schema.accounts)
        .values({
          householdId: ctx.householdId,
          name: 'חשבון עסקי',
          type: 'bank',
          institution: 'manual',
          purpose: 'business',
          cutoffDay: 0,
        })
        .returning();
      businessAccountId = created!.id;
      accountByName.set('חשבון עסקי', businessAccountId);
      createdAccounts.push('חשבון עסקי');
    }
  }

  // Income parent category
  let incomeCatId = topByName.get('הכנסות');
  if (!incomeCatId) {
    const [createdCat] = await db
      .insert(schema.categories)
      .values({
        householdId: ctx.householdId,
        nameHe: 'הכנסות',
        nameEn: 'Income',
        isIncome: true,
        sortOrder: 0,
        icon: 'TrendingUp',
        color: '#16a34a',
      })
      .returning();
    incomeCatId = createdCat!.id;
    topByName.set('הכנסות', incomeCatId);
    createdCategories.push('הכנסות');
  } else {
    // Make sure it's marked as income
    await db
      .update(schema.categories)
      .set({ isIncome: true })
      .where(eq(schema.categories.id, incomeCatId));
  }

  // "הכנסה עסקית" sub-category
  let businessIncomeSubId = subByName.get('הכנסה עסקית')?.id ?? null;
  if (!businessIncomeSubId) {
    const [createdSub] = await db
      .insert(schema.categories)
      .values({
        householdId: ctx.householdId,
        nameHe: 'הכנסה עסקית',
        nameEn: 'Business income',
        parentId: incomeCatId,
        isIncome: true,
        sortOrder: 0,
      })
      .returning();
    businessIncomeSubId = createdSub!.id;
    subByName.set('הכנסה עסקית', { id: businessIncomeSubId, parentId: incomeCatId });
  }

  const businessIncomeRows = parseBusinessIncome(buf);
  for (const inc of businessIncomeRows) {
    inserts.push({
      householdId: ctx.householdId,
      accountId: businessAccountId,
      transactionDate: `${inc.billingMonth}-01`,
      billingMonth: inc.billingMonth,
      amountIls: String(Math.abs(inc.amount)), // POSITIVE = income
      currency: 'ILS',
      merchantRaw: 'הכנסות עסקיות',
      merchantNormalized: 'הכנסות עסקיות',
      categoryId: incomeCatId,
      subCategoryId: businessIncomeSubId,
      isRecurring: true,
      isProjected: false,
      isTransfer: false,
      isManual: true,
      notes: `סיכום חודשי מגליון 'עסק'`,
      externalId: null,
    });
  }

  // Idempotent dedup — query existing transactions in the affected billing months
  // and skip any insert that matches an existing row by (account, date, amount, merchant).
  // This makes double-clicks / re-imports of the same Excel safe.
  const monthSet = Array.from(parsed.monthsSeen);
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
  const existingKey = (r: {
    accountId: string;
    transactionDate: string;
    amountIls: string;
    merchantNormalized: string;
  }) => `${r.accountId}|${r.transactionDate}|${r.amountIls}|${r.merchantNormalized}`;
  const existingSet = new Set(existing.map(existingKey));

  const dedupedInserts = inserts.filter((row) => {
    const key = `${row.accountId}|${row.transactionDate}|${row.amountIls}|${row.merchantNormalized}`;
    if (existingSet.has(key)) return false;
    existingSet.add(key); // also dedupe within this batch (defensive — Excel shouldn't have dups)
    return true;
  });
  const skippedAsDuplicates = inserts.length - dedupedInserts.length;

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < dedupedInserts.length; i += BATCH) {
    const batch = dedupedInserts.slice(i, i + BATCH);
    const result = await db
      .insert(schema.transactions)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: schema.transactions.id });
    inserted += result.length;
  }
  const duplicates = skippedAsDuplicates + (dedupedInserts.length - inserted);

  await db.insert(schema.auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: 'import',
    entityType: 'transaction',
    afterJson: {
      source: 'excel',
      filename: file.name,
      inserted,
      duplicates,
      months: Array.from(parsed.monthsSeen).sort(),
      createdCategories,
      createdAccounts,
      errors: errors.length,
    } as object,
  });

  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');
  revalidatePath('/import');

  return {
    ok: true,
    inserted,
    duplicates,
    errors: errors.slice(0, 200),
    createdAccounts,
    createdCategories,
    unmatchedCategories: Array.from(new Set(unmatchedCategories)),
    monthsImported: Array.from(parsed.monthsSeen).sort(),
  };
}

// ---------- CSV path ----------

async function importCsvFile(
  db: Database,
  ctx: SessionContext,
  file: File,
): Promise<ImportResult> {
  const text = await file.text();
  const parsed = parseCsv(text);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return emptyResult({ ok: false, message: 'הקובץ ריק או לא בפורמט CSV.', headers: parsed.headers });
  }

  const columnMap = detectColumnMap(parsed.headers);
  const required = ['date', 'merchant', 'amount'] as const;
  for (const col of required) {
    if (!(col in columnMap)) {
      return emptyResult({
        ok: false,
        message: `חסרה עמודת חובה: ${col}. עמודות שזוהו: ${Object.keys(columnMap).join(', ') || 'אין'}.`,
        headers: parsed.headers,
        columnsDetected: columnMap,
      });
    }
  }

  const categories = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.householdId, ctx.householdId));
  const categoryByName = new Map<string, { id: string; isIncome: boolean }>();
  for (const c of categories) {
    if (!c.parentId) {
      const keys = [c.nameHe, c.nameEn].filter(Boolean) as string[];
      for (const k of keys) categoryByName.set(k.toLowerCase().trim(), { id: c.id, isIncome: c.isIncome });
    }
  }
  const subCategoryByName = new Map<string, string>();
  for (const c of categories) {
    if (c.parentId) {
      const keys = [c.nameHe, c.nameEn].filter(Boolean) as string[];
      for (const k of keys) subCategoryByName.set(k.toLowerCase().trim(), c.id);
    }
  }

  const existingAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.householdId, ctx.householdId));
  const accountByName = new Map<string, string>(
    existingAccounts.map((a) => [a.name.toLowerCase().trim(), a.id]),
  );

  const errors: ImportRowError[] = [];
  const inserts: typeof schema.transactions.$inferInsert[] = [];
  const createdAccounts: string[] = [];
  const unmatchedCategories = new Set<string>();
  let duplicates = 0;

  let manualAccountId: string | null = null;
  const ensureManualAccount = async (): Promise<string> => {
    if (manualAccountId) return manualAccountId;
    const existing = existingAccounts.find((a) => a.institution === 'manual');
    if (existing) {
      manualAccountId = existing.id;
      return manualAccountId;
    }
    const [acc] = await db
      .insert(schema.accounts)
      .values({
        householdId: ctx.householdId,
        name: 'ידני',
        type: 'bank',
        institution: 'manual',
        cutoffDay: 0,
      })
      .returning();
    manualAccountId = acc!.id;
    accountByName.set('ידני', acc!.id);
    createdAccounts.push('ידני');
    return manualAccountId;
  };

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const rowNumber = i + 2;
    const get = (col: string): string => {
      const idx = columnMap[col];
      return idx === undefined ? '' : (row[idx] ?? '').trim();
    };

    const dateRaw = get('date');
    const merchantRaw = get('merchant');
    const amountRaw = get('amount');
    if (!dateRaw && !merchantRaw && !amountRaw) continue;

    const date = parseFlexibleDate(dateRaw);
    if (!date) {
      errors.push({ rowNumber, reason: `תאריך לא תקין: "${dateRaw}"`, raw: row });
      continue;
    }
    if (!merchantRaw) {
      errors.push({ rowNumber, reason: 'שדה בית עסק ריק', raw: row });
      continue;
    }
    const amount = parseFlexibleAmount(amountRaw);
    if (!Number.isFinite(amount) || amount === 0) {
      errors.push({ rowNumber, reason: `סכום לא תקין: "${amountRaw}"`, raw: row });
      continue;
    }

    const accountInput = get('account').toLowerCase().trim();
    let accountId: string;
    if (accountInput) {
      const existing = accountByName.get(accountInput);
      if (existing) {
        accountId = existing;
      } else {
        const [acc] = await db
          .insert(schema.accounts)
          .values({
            householdId: ctx.householdId,
            name: get('account').trim(),
            type: 'bank',
            institution: 'manual',
            cutoffDay: 0,
          })
          .returning();
        accountId = acc!.id;
        accountByName.set(accountInput, accountId);
        createdAccounts.push(get('account').trim());
      }
    } else {
      accountId = await ensureManualAccount();
    }

    const catNameRaw = get('category').trim();
    let categoryId: string | null = null;
    if (catNameRaw) {
      const found = categoryByName.get(catNameRaw.toLowerCase());
      if (found) categoryId = found.id;
      else unmatchedCategories.add(catNameRaw);
    }
    const subCatNameRaw = get('sub_category').trim();
    let subCategoryId: string | null = null;
    if (subCatNameRaw) {
      const found = subCategoryByName.get(subCatNameRaw.toLowerCase());
      if (found) subCategoryId = found;
      else unmatchedCategories.add(`${catNameRaw} → ${subCatNameRaw}`);
    }

    const billingMonthOverride = get('billing_month').trim();
    const billingMonth = /^\d{4}-\d{2}$/.test(billingMonthOverride)
      ? billingMonthOverride
      : computeBillingMonth(date, 0);

    const notes = get('notes').trim() || null;

    inserts.push({
      householdId: ctx.householdId,
      accountId,
      transactionDate: date,
      billingMonth,
      amountIls: String(amount),
      currency: 'ILS',
      merchantRaw,
      merchantNormalized: normalizeMerchant(merchantRaw),
      categoryId,
      subCategoryId,
      notes,
      isManual: true,
      externalId: null,
    });
  }

  let inserted = 0;
  if (inserts.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const batch = inserts.slice(i, i + BATCH);
      const result = await db
        .insert(schema.transactions)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: schema.transactions.id });
      inserted += result.length;
      duplicates += batch.length - result.length;
    }

    await db.insert(schema.auditLog).values({
      householdId: ctx.householdId,
      actorUserId: ctx.userId,
      action: 'import',
      entityType: 'transaction',
      afterJson: {
        source: 'csv',
        filename: file.name,
        inserted,
        duplicates,
        errors: errors.length,
        unmatchedCategories: Array.from(unmatchedCategories),
      } as object,
    });
  }

  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/grid');
  revalidatePath('/import');

  return {
    ok: true,
    inserted,
    duplicates,
    errors,
    createdAccounts,
    createdCategories: [],
    unmatchedCategories: Array.from(unmatchedCategories),
    monthsImported: [],
    columnsDetected: columnMap,
    headers: parsed.headers,
  };
}

function emptyResult(partial: Partial<ImportResult>): ImportResult {
  return {
    ok: false,
    inserted: 0,
    duplicates: 0,
    errors: [],
    createdAccounts: [],
    createdCategories: [],
    unmatchedCategories: [],
    monthsImported: [],
    columnsDetected: {},
    headers: [],
    ...partial,
  };
}
