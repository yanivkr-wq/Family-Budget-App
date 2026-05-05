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

// ─────────────────────────────────────────────────────────────────────────────
// importBankExport — for raw bank/CC portal exports.
//
// Flow:
//   1. User picks an account + uploads a single Excel/CSV file
//   2. We run smartImport which detects the institution template + parses rows
//   3. Each parsed row becomes a transactions row, scoped to the chosen account
//   4. external_id = SHA1 hash of (date|chargeDate|amount|merchant|notes) so
//      re-uploading the same file is a no-op (onConflictDoNothing handles it)
//   5. Return a summary the UI can render
//
// Out of scope for v1:
//   • Multi-card files (Discount Key with 4 cards) — all rows currently land
//     in the chosen account. Card-splitting UI is a future feature; for now
//     the user can either pre-filter the file in Excel OR accept the lump.
//   • Installment auto-detection — separate layer, runs after import lands.
// ─────────────────────────────────────────────────────────────────────────────

export interface BankExportImportResult {
  ok:                boolean;
  templateUsed:      { id: string; name: string } | null;
  inserted:          number;
  duplicates:        number;
  /** When re-importing the same file, rows already exist BUT have NULL
   *  category_id / installment_plan_id. The new ON CONFLICT DO UPDATE path
   *  fills those gaps without duplicating. This counts how many such rows
   *  got upgraded (categorized OR plan-linked). */
  upgradedDuplicates: number;
  pendingSkipped:    number;          // rows where parser silently skipped (Format A pending)
  forexRows:         number;          // count of rows flagged as forex
  installmentRows:   number;          // count of rows whose notes carry "תשלום N מתוך Y"
  rowsParsed:        number;          // total rows the parser produced
  /** Rows that received a category from the rules engine. */
  categorizedRows:   number;
  /** Rows that received a category from the bank's own ענף / קטגוריה column
   *  via BANK_HINT_TO_OUR_CATEGORY (used as fallback when no user rule fires). */
  bankHintCategorized: number;
  /** Rows that received a category by keyword-scanning the merchant name
   *  itself with the BANK_HINT_TO_OUR_CATEGORY patterns (fires when no user
   *  rule and no bank ענף match). Catches cases like
   *  "דלק מנטה קמעונאות..." where the bank didn't fill ענף but the merchant
   *  name itself contains a strong category keyword. */
  merchantKeywordCategorized: number;
  /** Installment plans auto-created during this import (didn't exist before). */
  newPlansCreated:   number;
  /** Rows linked to an installment plan (newly created OR pre-existing). */
  rowsLinkedToPlans: number;
  errors:            Array<{ row: number; reason: string }>;
  /** Distinct card-last-4 values found in the file (Format B). When >1, the
   *  UI shows a "this file has multiple cards — all routed to <account>"
   *  warning so the user can decide whether to split. */
  distinctCards:     string[];
  needsManualMapping: boolean;
  message?:          string;
}

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { smartImport } from '@/lib/smart-importer';
import { applyRules } from '@fba/categorizer';
import { addMonths } from '@fba/db';

function hashRowId(date: string, chargeDate: string | null, amount: number, merchant: string, notes: string | null): string {
  const key = [date, chargeDate ?? '', amount.toFixed(2), merchant.trim(), (notes ?? '').trim()].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 24);
}

/**
 * Map the bank's own ענף / קטגוריה Hebrew label → a list of candidate
 * Hebrew names we look for in the household's categories. The first match
 * wins. Strings are matched as case-insensitive normalized substrings, so
 * "מסעדות וקפה" in the bank file will match either of "מסעדות" or "מסעדות"
 * household entries.
 *
 * Why a substring map and not exact match: bank labels vary subtly between
 * exports ("דלק" vs "דלק ורכב" vs "תחנות דלק") and we want one rule that
 * covers all of them. The TARGET names are the SAME ones the user is most
 * likely to have created (Hebrew app, Hebrew defaults).
 *
 * Order matters within an array — earliest target wins if multiple exist.
 */
const BANK_HINT_TO_OUR_CATEGORY: Array<{ pattern: RegExp; targets: string[] }> = [
  // Food & dining
  { pattern: /מסעדות|אוכל\s*בחוץ|בית\s*קפה|פאסט\s*פוד|אוכל\s*ומשקאות/i,
    targets: ['מסעדות', 'אוכל בחוץ', 'מסעדות וקפה', 'אוכל'] },
  // Groceries / supermarkets
  { pattern: /סופרמרקט|סופר|מצרכים|מזון|מכולת|ירקן/i,
    targets: ['סופר', 'מזון', 'קניות מזון', 'סופרמרקט', 'מצרכים'] },
  // Fuel / car
  { pattern: /דלק|תדלוק|בנזין/i,
    targets: ['דלק', 'רכב', 'תחבורה'] },
  // Car / vehicle (non-fuel)
  { pattern: /רכב|מוסך|חנייה|חניון|חניה|כביש\s*אגרה|אגרת\s*כביש|כביש\s*6/i,
    targets: ['רכב', 'תחבורה', 'הוצאות רכב'] },
  // Public transport
  { pattern: /תחבורה|רכבת|אוטובוס|רב\s*קו|מונית/i,
    targets: ['תחבורה', 'תחבורה ציבורית'] },
  // Utilities / household bills
  { pattern: /חשמל|מים|גז|תאגיד|ארנונה|ועד\s*בית|דייר/i,
    targets: ['חשבונות', 'שירותים', 'בית', 'דיור'] },
  // Communications
  { pattern: /תקשורת|סלולר|אינטרנט|טלפון|כבלים|טלוויזיה/i,
    targets: ['תקשורת', 'תקשורת וטלוויזיה'] },
  // Insurance
  { pattern: /ביטוח/i,
    targets: ['ביטוח', 'ביטוחים'] },
  // Health / pharmacy
  { pattern: /בריאות|רפואה|רוקחות|בית\s*מרקחת|פארם|רופא|קופ.?ח/i,
    targets: ['בריאות', 'רפואה'] },
  // Clothing / fashion
  { pattern: /ביגוד|אופנה|בגדים|הנעלה|נעליים/i,
    targets: ['ביגוד', 'ביגוד והנעלה', 'אופנה'] },
  // Beauty / personal
  { pattern: /יופי|טיפוח|קוסמטיקה|מספרה|ספא/i,
    targets: ['טיפוח', 'יופי', 'אישי'] },
  // Entertainment / leisure
  { pattern: /בידור|פנאי|תרבות|קולנוע|תיאטרון|הופעה|מנוי|סטרימינג|נטפליקס|ספוטיפיי/i,
    targets: ['בילוי', 'בידור', 'פנאי', 'בילויים'] },
  // Travel / vacation
  { pattern: /חופשה|נסיעות|תיירות|טיסות|מלון|חו["'״]?ל/i,
    targets: ['טיולים', 'חופשות', 'נסיעות', 'נופש'] },
  // Education
  { pattern: /חינוך|לימודים|בית\s*ספר|גן\s*ילדים|חוגים|ספרים/i,
    targets: ['חינוך', 'ילדים', 'לימודים'] },
  // Kids
  { pattern: /ילדים|תינוק|צעצועים/i,
    targets: ['ילדים', 'משפחה'] },
  // Home / furniture / improvement
  { pattern: /בית|ריהוט|מטבח|כלי\s*בית|חומרה|שיפוצים/i,
    targets: ['בית', 'דיור', 'ריהוט'] },
  // Electronics / tech
  { pattern: /אלקטרוניקה|מחשבים|טכנולוגיה|מוצרי\s*חשמל/i,
    targets: ['אלקטרוניקה', 'טכנולוגיה', 'בית'] },
  // Charity
  { pattern: /צדקה|תרומה|תרומות/i,
    targets: ['צדקה', 'תרומות'] },
  // Pets
  { pattern: /חיות\s*מחמד|וטרינר|כלב|חתול/i,
    targets: ['חיות מחמד', 'בעלי חיים'] },
  // ATM / cash withdrawals — leave uncategorized; caller can rule it
  // Income hints — usually not in CC files but harmless
  { pattern: /משכורת|שכר|הכנסה/i,
    targets: ['הכנסות', 'משכורת'] },
];

/** Try to match a bank's hint string ("מסעדות וקפה") against the household's
 *  category list. Returns the first matching category id (top-level only),
 *  or null if no pattern fires or no household category exists for the
 *  matched targets. */
function matchBankHintToCategoryId(
  hint: string,
  topCategoryByName: Map<string, string>,
): string | null {
  const trimmed = hint.trim();
  if (!trimmed) return null;
  for (const entry of BANK_HINT_TO_OUR_CATEGORY) {
    if (!entry.pattern.test(trimmed)) continue;
    for (const target of entry.targets) {
      const id = topCategoryByName.get(target.toLowerCase().trim());
      if (id) return id;
    }
  }
  return null;
}

/** Pull distinct card-last-4 values from a Discount-Key-style workbook. We
 *  read the file twice (once here for cards, once via smartImport for
 *  transactions) — fine for an interactive UX because files are small. */
function extractDistinctCards(buffer: Buffer): string[] {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const cards = new Set<string>();
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const cell = String(row[3] ?? '').trim();
        // Card last-4 is always 4 digits — anything else is header text or a
        // different format entirely.
        if (/^\d{4}$/.test(cell)) cards.add(cell);
      }
    }
    return Array.from(cards).sort();
  } catch {
    return [];
  }
}

export async function importBankExport(formData: FormData): Promise<BankExportImportResult> {
  const file = formData.get('file');
  const accountId = String(formData.get('accountId') ?? '').trim();

  const empty = (msg: string, extra: Partial<BankExportImportResult> = {}): BankExportImportResult => ({
    ok: false, templateUsed: null, inserted: 0, duplicates: 0, upgradedDuplicates: 0,
    pendingSkipped: 0, forexRows: 0, installmentRows: 0, rowsParsed: 0,
    categorizedRows: 0, bankHintCategorized: 0, merchantKeywordCategorized: 0,
    newPlansCreated: 0, rowsLinkedToPlans: 0,
    errors: [], distinctCards: [], needsManualMapping: false, message: msg, ...extra,
  });

  if (!(file instanceof File) || file.size === 0) return empty('לא נבחר קובץ');
  if (!accountId) return empty('יש לבחור חשבון');

  const ctx = await requireSession();
  const db = getDb();

  // Verify the chosen account belongs to this household + grab its cutoff
  // for billing-month computation when the file doesn't carry a chargeDate.
  const [account] = await db
    .select({
      id: schema.accounts.id,
      cutoffDay: schema.accounts.cutoffDay,
      paymentSchedule: schema.accounts.paymentSchedule,
    })
    .from(schema.accounts)
    .where(and(
      eq(schema.accounts.id, accountId),
      eq(schema.accounts.householdId, ctx.householdId),
    ))
    .limit(1);
  if (!account) return empty('החשבון שנבחר לא נמצא');

  const buffer = Buffer.from(await file.arrayBuffer());
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  const parsed = await smartImport(buffer, isExcel);

  if (parsed.needsManualMapping) {
    return empty('לא זוהה תבנית מתאימה לקובץ. ניתן להשתמש בייבוא הגנרי או להוסיף תבנית.', {
      needsManualMapping: true,
    });
  }

  if (!parsed.success || parsed.transactions.length === 0) {
    return empty('הקובץ לא הניב שורות תקינות', {
      templateUsed: parsed.templateUsed && { id: parsed.templateUsed.id, name: parsed.templateUsed.name },
      errors: parsed.errors,
    });
  }

  const distinctCards = extractDistinctCards(buffer);

  // ── Load household-level data needed by both the categorizer and the
  // installment auto-detector. Both run BEFORE any insert so we set the
  // right fields on the rows the first time. ─────────────────────────────────
  const [allRules, existingPlans, allCategories] = await Promise.all([
    db.select().from(schema.categoryRules).where(and(
      eq(schema.categoryRules.householdId, ctx.householdId),
      eq(schema.categoryRules.isActive, true),
    )),
    db.select({
      id:                 schema.installmentPlans.id,
      accountId:          schema.installmentPlans.accountId,
      merchantNormalized: schema.installmentPlans.merchantNormalized,
      paymentAmountIls:   schema.installmentPlans.paymentAmountIls,
      totalPayments:      schema.installmentPlans.totalPayments,
      currentPaymentNo:   schema.installmentPlans.currentPaymentNo,
    }).from(schema.installmentPlans).where(and(
      eq(schema.installmentPlans.householdId, ctx.householdId),
      eq(schema.installmentPlans.status, 'active'),
    )),
    db.select({
      id:       schema.categories.id,
      nameHe:   schema.categories.nameHe,
      parentId: schema.categories.parentId,
    }).from(schema.categories).where(and(
      eq(schema.categories.householdId, ctx.householdId),
      isNull(schema.categories.parentId),
    )),
  ]);

  // Top-level categories only — bank hints are coarse and should land on
  // the parent. The user can split into a sub-category later via the rule
  // editor.
  const topCategoryByName = new Map<string, string>(
    allCategories.map((c) => [c.nameHe.toLowerCase().trim(), c.id]),
  );

  // Plan fingerprint = (merchantNormalized, paymentAmount-cents, totalPayments,
  // accountId). Cents-precision avoids float comparison issues. accountId is
  // included because two different cards could theoretically have parallel
  // plans for the same merchant + amount.
  const fp = (merchantNorm: string, amount: number, totalPayments: number) =>
    `${merchantNorm}|${Math.round(Math.abs(amount) * 100)}|${totalPayments}|${accountId}`;
  const planMap = new Map<string, string>();
  for (const p of existingPlans) {
    if (!p.totalPayments) continue;
    if (p.accountId !== accountId) continue;
    planMap.set(fp(p.merchantNormalized, Number(p.paymentAmountIls), p.totalPayments), p.id);
  }

  const installmentRegex = /תשלום\s*(\d+)\s*מתוך\s*(\d+)/;

  // ── Pass 1: parse installment markers per row + identify plans we need
  // to create (those not in planMap yet). ───────────────────────────────────
  type RowMeta = {
    tx: typeof parsed.transactions[number];
    merchantNorm: string;
    billingMonth: string;
    installment: { N: number; Y: number; fingerprint: string } | null;
  };
  const rowMetas: RowMeta[] = parsed.transactions.map((t) => {
    const merchantNorm = normalizeMerchant(t.merchantRaw);
    const billingMonth = t.chargeDate
      ? t.chargeDate.slice(0, 7)
      : computeBillingMonth(t.transactionDate, account.cutoffDay);

    const m = (t.notes ?? '').match(installmentRegex);
    if (!m) return { tx: t, merchantNorm, billingMonth, installment: null };

    const N = Number(m[1]);
    const Y = Number(m[2]);
    if (!Number.isFinite(N) || !Number.isFinite(Y) || Y < 1 || N < 1) {
      return { tx: t, merchantNorm, billingMonth, installment: null };
    }
    return {
      tx: t, merchantNorm, billingMonth,
      installment: { N, Y, fingerprint: fp(merchantNorm, t.amountIls, Y) },
    };
  });

  // ── Pass 2: create any missing plans. We dedupe within this batch so two
  // rows from the same plan (e.g. תשלום 1/12 and תשלום 2/12 in the same
  // file) only create the plan once. ────────────────────────────────────────
  let newPlansCreated = 0;
  const uniqueNewPlans = new Map<string, RowMeta>();
  for (const meta of rowMetas) {
    if (!meta.installment) continue;
    if (planMap.has(meta.installment.fingerprint)) continue;
    if (uniqueNewPlans.has(meta.installment.fingerprint)) continue;
    uniqueNewPlans.set(meta.installment.fingerprint, meta);
  }
  for (const meta of uniqueNewPlans.values()) {
    const inst = meta.installment!;
    // startMonth = billingMonth - (N-1) months → first payment of the plan
    // projectedEndMonth = startMonth + (Y-1) months → last payment
    const startMonth = addMonths(meta.billingMonth, -(inst.N - 1));
    const projectedEndMonth = addMonths(startMonth, inst.Y - 1);
    const [created] = await db.insert(schema.installmentPlans).values({
      householdId:        ctx.householdId,
      accountId,
      merchantNormalized: meta.merchantNorm,
      // Description is intentionally NULL — the user names the plan from the
      // /installments page (e.g. "iPhone 15 Pro" instead of "KSP").
      paymentAmountIls:   String(Math.abs(meta.tx.amountIls)),
      totalPayments:      inst.Y,
      currentPaymentNo:   inst.N,
      startMonth,
      projectedEndMonth,
      status:             'active',
    }).returning({ id: schema.installmentPlans.id });
    if (created) {
      planMap.set(inst.fingerprint, created.id);
      newPlansCreated++;
    }
  }

  // ── Pass 3: build the final transaction inserts. Apply categorization
  // rules + attach installment_plan_id when applicable. ────────────────────
  let categorizedRows = 0;
  let bankHintCategorized = 0;
  let merchantKeywordCategorized = 0;
  let rowsLinkedToPlans = 0;
  const inserts = rowMetas.map(({ tx, merchantNorm, billingMonth, installment }) => {
    const ruleResult = applyRules(allRules, {
      merchantNormalized: merchantNorm,
      merchantRaw:        tx.merchantRaw,
      accountId,
      amountAbs:          Math.abs(tx.amountIls),
      notes:              tx.notes,
    });
    if (ruleResult) categorizedRows++;

    // Bank-hint fallback: only fires when the user's rules didn't match AND
    // the parser extracted a categoryHint AND we can map that hint to a
    // household top-level category. Lower precedence than user rules so the
    // user can always override via the rule editor.
    let bankHintCategoryId: string | null = null;
    if (!ruleResult && tx.categoryHint) {
      bankHintCategoryId = matchBankHintToCategoryId(tx.categoryHint, topCategoryByName);
      if (bankHintCategoryId) bankHintCategorized++;
    }

    // Merchant-name keyword fallback: when neither the user rules nor the
    // bank's ענף column gave us a category, try the SAME pattern map
    // against the raw merchant string. Catches "דלק מנטה קמעונאות דרכים בע\"מ
    // בית חנן" — the bank's ענף might be empty or generic, but the merchant
    // name itself contains "דלק" → fuel category. The patterns are designed
    // for short labels, so they only fire on strong keyword hits and don't
    // overreach. Lowest-precedence categorizer before AI.
    let merchantKeywordCategoryId: string | null = null;
    if (!ruleResult && !bankHintCategoryId) {
      merchantKeywordCategoryId = matchBankHintToCategoryId(tx.merchantRaw, topCategoryByName);
      if (merchantKeywordCategoryId) merchantKeywordCategorized++;
    }

    const planId = installment ? planMap.get(installment.fingerprint) ?? null : null;
    if (planId) rowsLinkedToPlans++;

    return {
      householdId: ctx.householdId,
      accountId,
      transactionDate: tx.transactionDate,
      chargeDate: tx.chargeDate,
      billingMonth,
      amountIls: String(tx.amountIls),
      currency: 'ILS',
      ...(tx.originalAmount !== null ? { originalAmount: String(tx.originalAmount) } : {}),
      ...(tx.originalCurrency !== null ? { originalCurrency: tx.originalCurrency } : {}),
      merchantRaw: tx.merchantRaw,
      merchantNormalized: merchantNorm,
      notes: tx.notes,
      isManual: false,
      isInstallment: !!installment,
      ...(planId ? { installmentPlanId: planId } : {}),
      ...(ruleResult ? {
        categoryId:    ruleResult.categoryId,
        subCategoryId: ruleResult.subCategoryId,
        appliedRuleId: ruleResult.rule.id,
        categorySource: 'rule' as const,
      } : bankHintCategoryId ? {
        categoryId:     bankHintCategoryId,
        // categorySource = 'rule' is reused because the source enum is
        // ['rule', 'llm', 'manual'] and bank hints are deterministic like
        // rules. appliedRuleId stays NULL so a user can later distinguish
        // bank-hint matches from real-rule matches in the UI.
        categorySource: 'rule' as const,
      } : merchantKeywordCategoryId ? {
        categoryId:     merchantKeywordCategoryId,
        // Same rationale as bank-hint: deterministic match against a
        // hard-coded keyword map → record as 'rule' source with NULL
        // applied_rule_id so it's distinguishable from real user rules.
        categorySource: 'rule' as const,
      } : {}),
      externalId: hashRowId(tx.transactionDate, tx.chargeDate, tx.amountIls, tx.merchantRaw, tx.notes),
    };
  });

  // ── Insert with ON CONFLICT DO UPDATE. Only fills NULL fields (via
  // COALESCE) so re-importing the same file UPGRADES previously-imported
  // rows that lacked categorization or plan-linking, without overwriting
  // anything the user may have manually set. ───────────────────────────────
  let inserted = 0;
  let upgradedDuplicates = 0;

  if (inserts.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const batch = inserts.slice(i, i + BATCH);
      const result = await db
        .insert(schema.transactions)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.transactions.accountId, schema.transactions.externalId],
          set: {
            // Fill NULLs only — leave user-set values alone.
            categoryId:        sql`coalesce(${schema.transactions.categoryId}, excluded.category_id)`,
            subCategoryId:     sql`coalesce(${schema.transactions.subCategoryId}, excluded.sub_category_id)`,
            appliedRuleId:     sql`coalesce(${schema.transactions.appliedRuleId}, excluded.applied_rule_id)`,
            categorySource:    sql`coalesce(${schema.transactions.categorySource}, excluded.category_source)`,
            installmentPlanId: sql`coalesce(${schema.transactions.installmentPlanId}, excluded.installment_plan_id)`,
            isInstallment:     sql`${schema.transactions.isInstallment} or excluded.is_installment`,
          },
          // Only run the UPDATE if any of those fields are still NULL on the
          // existing row AND the new row has something to fill in. Avoids
          // pointless UPDATE traffic on truly-already-fully-categorized rows.
          where: sql`(
            ${schema.transactions.categoryId} is null and excluded.category_id is not null
          ) or (
            ${schema.transactions.installmentPlanId} is null and excluded.installment_plan_id is not null
          ) or (
            ${schema.transactions.isInstallment} = false and excluded.is_installment = true
          )`,
        })
        .returning({
          id: schema.transactions.id,
          // xmax = 0 means "this was a fresh INSERT", non-zero means "this row
          // was UPDATEed by the conflict path".
          inserted: sql<boolean>`(xmax = 0)`,
        });
      for (const r of result) {
        if (r.inserted) inserted++;
        else upgradedDuplicates++;
      }
    }
    const duplicates = inserts.length - inserted - upgradedDuplicates;

    await db.insert(schema.auditLog).values({
      householdId: ctx.householdId,
      actorUserId: ctx.userId,
      action: 'import',
      entityType: 'transaction',
      afterJson: {
        source: 'bank-export',
        template: parsed.templateUsed?.id,
        filename: file.name,
        accountId,
        inserted,
        duplicates,
        upgradedDuplicates,
        categorizedRows,
        bankHintCategorized,
        merchantKeywordCategorized,
        newPlansCreated,
        rowsLinkedToPlans,
        forexRows: parsed.transactions.filter((t) => t.isForex).length,
        installmentRows: inserts.filter((i) => i.isInstallment).length,
        distinctCards,
      } as object,
    });

    revalidatePath('/');
    revalidatePath('/transactions');
    revalidatePath('/installments');
    revalidatePath('/import');

    return {
      ok: true,
      templateUsed: { id: parsed.templateUsed!.id, name: parsed.templateUsed!.name },
      inserted,
      duplicates,
      upgradedDuplicates,
      pendingSkipped: 0,
      forexRows: parsed.transactions.filter((t) => t.isForex).length,
      installmentRows: inserts.filter((i) => i.isInstallment).length,
      rowsParsed: parsed.transactions.length,
      categorizedRows,
      bankHintCategorized,
      merchantKeywordCategorized,
      newPlansCreated,
      rowsLinkedToPlans,
      errors: parsed.errors,
      distinctCards,
      needsManualMapping: false,
    };
  }

  return empty('הקובץ לא הניב שורות תקינות', {
    templateUsed: { id: parsed.templateUsed!.id, name: parsed.templateUsed!.name },
    errors: parsed.errors,
  });
}
