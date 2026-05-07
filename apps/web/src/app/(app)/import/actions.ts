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
  /** Rows whose categoryHint exactly matched one of the household's
   *  category names (used by the `tagged-export` template). Highest-quality
   *  signal because the user pre-tagged the file. */
  taggedExportCategorized: number;
  /** Recurring-pattern rows auto-created from the file's חוזר flag. */
  recurringPatternsCreated: number;
  /** Transactions flagged as inter-account transfers via the file's
   *  "העברה בין חשבונות" column. */
  transferRows: number;
  /** Pairs of cross-account transfers that got linked together via
   *  transfer_pair_id (1 pair = 2 rows). Includes pairs where one side
   *  was already in the DB from a previous import. */
  transferPairsLinked: number;
  /** Categories (parent or sub) auto-created from tagged-export hints. */
  categoriesCreated: number;
  /** Bank-statement rows where the merchant looks like a CC settlement
   *  ("כ.א.ל חיוב", "דיינרס חיוב", etc.). Marked is_transfer = true so
   *  they're excluded from cash-flow totals — the granular detail comes
   *  from the matching CC excel file. Prevents double-counting. */
  ccSettlementsFlagged: number;
  /** True when the destination account was inferred from the file's
   *  identifier (no user pick needed). Surface in the UI so the user
   *  knows we routed it automatically. */
  autoRoutedAccount: boolean;
  /** The account name the import landed in (for the result card). */
  destinationAccountName: string | null;
  /** Imported transactions whose merchant matched an existing recurring
   *  pattern (so they'll show the קבוע badge). Lets the user see at-a-
   *  glance how much of the new import is recurring vs one-offs. */
  matchedExistingRecurring: number;
  /** AI-categorized count: rows that were still uncategorized after
   *  rules + bank-hint + keyword + tagged-export passes, then got
   *  classified by Claude Haiku in a single batch call. New
   *  contains-rules are auto-created (≥0.6 confidence) so future
   *  imports of these merchants land categorized without another LLM
   *  call. 0 if no uncategorized rows OR if the AI call failed. */
  aiCategorized: number;
  /** Number of contains-rules auto-created by the AI pass. */
  aiRulesCreated: number;
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
import { applyRules, CategorizerBatchClient } from '@fba/categorizer';
import { addMonths } from '@fba/db';

function hashRowId(date: string, chargeDate: string | null, amount: number, merchant: string, notes: string | null): string {
  const key = [date, chargeDate ?? '', amount.toFixed(2), merchant.trim(), (notes ?? '').trim()].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 24);
}

/**
 * Patterns that match credit-card SETTLEMENT rows on a bank-account file.
 * The user's CCs are linked to bank accounts: when a CC charges them
 * (monthly batch on the 10th OR an immediate forex charge), the bank
 * statement shows a row like "כ.א.ל חיוב" / "ויזה ק.ש.ר" / "דיינרס חיוב"
 * — but the GRANULAR detail of those charges is in the CC file's import.
 *
 * Importing both as expenses double-counts. So when we see a settlement
 * row in a BANK file, we set is_transfer = true → it's excluded from
 * cash-flow totals, the CC file rows are the source of truth.
 *
 * Patterns are intentionally broad — false positives are cheap (the user
 * sees "↔ העברה" on the row and can fix), false negatives cause double
 * counting which is harder to spot.
 */
// IMPORTANT: no \b word boundaries in Hebrew patterns — JS \b only fires
// at ASCII word/non-word transitions, so \bכ\b never matches in Hebrew
// text. Patterns are plain substring matches; false-positive risk is
// minimal because these strings are very specific to CC settlement rows.
const CC_SETTLEMENT_PATTERNS: RegExp[] = [
  /כ\.?א\.?ל/i,           // Cal — matches "כ.א.ל חיוב", "מכאל 2067"
  /כאל/i,                  // Cal alt spelling
  /ויזה.*חיוב/i,           // "ויזה חיוב"
  /ויזה.*ק\.?ש\.?ר/i,      // "ויזה ק.ש.ר"
  /דיינרס/i,               // Diners
  /דינרס/i,                // Diners alt
  /מסטרקרד/i,              // MasterCard
  /מאסטרקרד/i,             // MasterCard alt
  /מאסטר.?כרט/i,           // MasterCard variant
  /ישראכרט/i,              // Isracard
  /מקס\s*איט/i,            // Max ("מקס איט פי חיוב" — full phrase)
  /ממקס/i,                 // "חיוב לכרטיס ממקס 7627"
  /לאומי\s*קארד/i,         // Leumi-Card (legacy)
  /AMEX/i,                 // American Express
];

function looksLikeCcSettlement(merchantRaw: string): boolean {
  const s = merchantRaw.trim();
  if (!s) return false;
  return CC_SETTLEMENT_PATTERNS.some((re) => re.test(s));
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
  // Restaurants & cafes  → "מסעדות וקפה"
  // Discount-Key uses "מסעדות, קפה וברים", Diners/Visa uses just "מסעדות".
  // International food delivery brands: WOLT, GLOVO, UBEREATS, DOORDASH.
  // Israeli chains: ארומה, ארקפה, מורן, באג, נספרסו, פיצה דומינו.
  { pattern: /מסעדות|אוכל\s*בחוץ|בית\s*קפה|פאסט\s*פוד|אוכל\s*ומשקאות|מזנון|פיצריות?|המבורגר|קפה\s*וברים|קפה|wolt|glovo|ubereats|doordash|deliveroo|ארומה|ארקפה|מורן.*אספרסו|באג\s|נספרסו|פיצה|בורגר|burger|starbucks|קפיטריה|דליבר/i,
    targets: ['מסעדות וקפה', 'מסעדות', 'אוכל בחוץ', 'אוכל'] },
  // Groceries  → "מכולת ומזון"
  // Discount-Key uses "מזון וצריכה", Visa uses "מזון ומשקאות".
  // Israeli chains: שופרסל, רמי לוי, ויקטורי, יוחננוף, אושר עד, ביכורי שדה.
  { pattern: /סופרמרקט|סופר|מצרכים|מזון|מכולת|ירקן|בשר|קצב|צריכה|משקאות|שופרסל|רמי\s*לוי|ויקטורי|יוחננוף|אושר\s*עד|ביכורי\s*שדה|טיב\s*טעם|מגה|חצי\s*חינם|ירוקת/i,
    targets: ['מכולת ומזון', 'מכולת', 'סופר', 'מזון', 'קניות מזון', 'סופרמרקט', 'מצרכים'] },
  // Fuel — Discount/Visa label these as "אנרגיה" (!), Diners as "רכב ותחבורה".
  // Brands: פז, סונול, דלק, מנטה, דור אלון, ten.
  { pattern: /דלק|תדלוק|בנזין|אנרגיה|פז\s*אפליק|פז\s*יילו|סונול|דור\s*אלון|מנטה|\bten\b|tnuva|תנובה/i,
    targets: ['תחבורה', 'דלק', 'רכב'] },
  // Vehicle / transport  → "תחבורה"
  // Discount-Key: "תחבורה ורכבים", Diners: "רכב ותחבורה".
  // Ride-hail: GETT, UBER, MOOVIT, BUBBLE. Parking: PANGO. Trains: רכבת.
  { pattern: /רכב|מוסך|חנייה|חניון|חניה|כביש\s*אגרה|אגרת\s*כביש|כביש\s*6|פנגו|pango|טסט|תחבורה|רכבת|אוטובוס|רב\s*קו|מונית|gett|\bgt\b|uber|ubr\b|moovit|bubble|cellopark|אגרה|טסטים|דמי\s*רישוי|לוחית\s*זיהוי/i,
    targets: ['תחבורה', 'רכב', 'הוצאות רכב'] },
  // Communications & tech / digital subscriptions  → "תקשורת"
  // Israeli telco: סלקום, פרטנר, פלאפון, הוט, בזק, יס, גולן.
  // International digital: OPENAI, CLAUDE.AI, GITHUB, GOOGLE, MICROSOFT,
  //                        APPLE, AMAZON AWS, ADOBE, NOTION, FIGMA, ZOOM,
  //                        DROPBOX, PADDLE (subscription billing platform).
  { pattern: /תקשורת|סלולר|אינטרנט|טלפון|כבלים|טלוויזיה|פלאפון|פרטנר|הוט|בזק|סלקום|\byes\b|מחשבים|openai|chatgpt|claude\.?ai|anthropic|github|google\b|microsoft|apple\.com|aws\b|amazon\s*web|adobe|notion|figma|zoom\.us|dropbox|paddle\b|paddle\.net|stripe|spotify|telekom/i,
    targets: ['תקשורת', 'תקשורת וטלוויזיה'] },
  // Insurance / finance  → "הלוואות וחיסכון"
  // Discount-Key: "ביטוח", Diners/Visa: "ביטוח ופיננסים"
  { pattern: /ביטוח|פיננסים/i,
    targets: ['הלוואות וחיסכון', 'ביטוח', 'ביטוחים'] },
  // Loans / savings / mortgage  → "הלוואות וחיסכון"
  { pattern: /הלוואה|הלוואת|משכנתא|חיסכון|הפקדה|השקעה|קרן|קופת\s*גמל/i,
    targets: ['הלוואות וחיסכון', 'הלוואות', 'חיסכון'] },
  // Health / pharmacy  → "בריאות"
  // Discount-Key: "רפואה ובתי מרקחת", Visa: "רפואה ובריאות"
  { pattern: /בריאות|רפואה|רוקחות|בית\s*מרקחת|פארם|רופא|קופ.?ח|סופר[-\s]פארם|קופת\s*חולים/i,
    targets: ['בריאות', 'רפואה'] },
  // Entertainment / leisure  → "בילוי ופנאי"
  // Discount-Key: "פנאי, בידור וספורט", Visa: "פנאי בילוי"
  { pattern: /בידור|פנאי|תרבות|קולנוע|תיאטרון|הופעה|מנוי|סטרימינג|נטפליקס|ספוטיפיי|spotify|netflix|youtube|disney|חדר\s*בריחה|spa|ספורט|בילוי/i,
    targets: ['בילוי ופנאי', 'בילוי', 'בידור', 'פנאי', 'בילויים'] },
  // Travel / vacation  → "נסיעות וחופשות"
  // Diners: "תיירות". Brands: אל על, ארקיע, יונייטד, EL AL, ELAL,
  // RYANAIR, AIRBNB, BOOKING, EXPEDIA, KAYAK.
  { pattern: /חופשה|נסיעות|תיירות|טיסות|מלון|חו["'״]?ל|airbnb|booking|expedia|airline|אל[\s־-]?על|el[\s־-]?al|elal|ארקיע|ryanair|kayak|hotels?\.com|trivago/i,
    targets: ['נסיעות וחופשות', 'טיולים', 'חופשות', 'נסיעות', 'נופש'] },
  // Home / furniture / household / electrical  → "בית ומשק"
  // Discount-Key: "עיצוב הבית", Diners/Visa: "ריהוט ובית". Brands:
  // איקאה, IKEA, ACE, הום סנטר, מחסני תאורה, ויהי אור.
  { pattern: /ריהוט|מטבח|כלי\s*בית|חומרה|שיפוצים|איקאה|ikea|\bace\b|הום\s*סנטר|עיצוב\s*הבית|בית|מחסני\s*תאורה|תאורה|ויהי\s*אור|אדיסון|חשמלאי|אינסטלטור|מנעולן/i,
    targets: ['בית ומשק', 'בית', 'דיור', 'ריהוט'] },
  // Government / municipal bills  → "בית ומשק"
  // Discount-Key: "עירייה וממשלה" (catches arnona, water, etc.).
  // Includes utility companies: חברת חשמל, מי אביבים, פלגי מים, הגיחון.
  { pattern: /עירייה|ממשלה|חשמל|מים|גז|תאגיד|ארנונה|ועד\s*בית|דייר|חברת\s*חשמל|חשבונית|פלגי\s*מים|מי\s*אביבים|הגיחון|מועצה\s*אזורית/i,
    targets: ['בית ומשק', 'חשבונות', 'שירותים', 'בית'] },
  // CC / banking fees  → "בית ומשק" (closest catch-all when no fees cat)
  { pattern: /דמי\s*כרטיס|דמי\s*ניהול|עמלת|עמלה|ריבית|מסלול\s*בסיסי|מסלול\s*נוסף|פירעון\s*תפעולית|פירעון/i,
    targets: ['בית ומשק', 'הלוואות וחיסכון', 'אחר'] },
  // Education  → "ילדים וחינוך"
  { pattern: /חינוך|לימודים|בית\s*ספר|גן\s*ילדים|חוגים|ספרים|אוניברס|מכללה|פעוטון|קייטנה|תינוק|צעצועים/i,
    targets: ['ילדים וחינוך', 'חינוך', 'לימודים', 'ילדים'] },
  // Cash withdrawals  → "כספומט"
  { pattern: /כספומט|משיכת\s*מזומן|atm|מזומן/i,
    targets: ['כספומט'] },
  // Income  → "הכנסות"
  { pattern: /משכורת|שכר|הכנסה|העברה\s*נכנסת|זיכוי/i,
    targets: ['הכנסות', 'משכורת'] },
  // Catch-alls landing in "אחר" (the user's bucket for "doesn't fit elsewhere")
  // Bank labels for clothing, beauty, electronics, office, charity, transfers, "misc"
  { pattern: /אופנה|ביגוד|בגדים|הנעלה|נעליים|יופי|טיפוח|קוסמטיקה|מספרה|אלקטרוניקה|מוצרי\s*חשמל|ksp|איי-דיגיטל|ציוד|משרד|מוסדות|שונות|העברת\s*כספים|צדקה|תרומה|תרומות|עמותות|חיות\s*מחמד|וטרינר/i,
    targets: ['אחר', 'ביגוד', 'אופנה', 'טיפוח', 'אלקטרוניקה', 'צדקה', 'חיות מחמד'] },
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
  // accountId may be empty — we auto-route via account.externalKey when so.
  const userPickedAccountId = String(formData.get('accountId') ?? '').trim();

  const empty = (msg: string, extra: Partial<BankExportImportResult> = {}): BankExportImportResult => ({
    ok: false, templateUsed: null, inserted: 0, duplicates: 0, upgradedDuplicates: 0,
    pendingSkipped: 0, forexRows: 0, installmentRows: 0, rowsParsed: 0,
    categorizedRows: 0, bankHintCategorized: 0, merchantKeywordCategorized: 0,
    taggedExportCategorized: 0, recurringPatternsCreated: 0, transferRows: 0,
    transferPairsLinked: 0, categoriesCreated: 0, ccSettlementsFlagged: 0,
    autoRoutedAccount: false, destinationAccountName: null,
    matchedExistingRecurring: 0,
    aiCategorized: 0, aiRulesCreated: 0,
    newPlansCreated: 0, rowsLinkedToPlans: 0,
    errors: [], distinctCards: [], needsManualMapping: false, message: msg, ...extra,
  });

  if (!(file instanceof File) || file.size === 0) return empty('לא נבחר קובץ');

  const ctx = await requireSession();
  const db = getDb();

  // Parse the file FIRST so we have the accountKey for auto-routing.
  // (Used to require accountId before parsing — flipped because the
  // smartImport extract gives us the file's identifier without needing
  // the account context.)
  const buffer = Buffer.from(await file.arrayBuffer());
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  const parsedEarly = await smartImport(buffer, isExcel);

  // ── Resolve destination account: user pick > auto-route via externalKey ─
  let accountId = userPickedAccountId;
  let autoRouted = false;
  if (!accountId && parsedEarly.accountKey) {
    // Find the household account whose externalKey appears in the file's
    // identifier blob (matcher uses substring both ways for flexibility
    // — minor formatting variations should still pair).
    //
    // CRITICAL: filter accounts by TYPE matching the template's type.
    // CC files (il-cc-issuer-export, il-cc-bank-export, discount-key)
    // can only route to credit_card accounts; bank files (leumi,
    // leumi-business-html, etc.) can only route to bank accounts. Without
    // this, a Diners file's blob ("3427 4703428 7631" — card last-4 +
    // parent bank account # + Google Pay token) would match BOTH the
    // Diners CC account (externalKey 3427) AND the Leumi business
    // account (externalKey 47034 ⊂ 4703428) → "2 accounts" error.
    const wantsAccountType: 'bank' | 'credit_card' | null =
      parsedEarly.templateUsed?.type ?? null;
    const norm = (s: string | null | undefined) =>
      String(s ?? '').toLowerCase().replace(/[\s\-/]/g, '');
    const fileKey = norm(parsedEarly.accountKey);
    const candidates = await db
      .select({
        id: schema.accounts.id,
        type: schema.accounts.type,
        externalKey: schema.accounts.externalKey,
      })
      .from(schema.accounts)
      .where(and(
        eq(schema.accounts.householdId, ctx.householdId),
        eq(schema.accounts.isActive, true),
      ));
    const hits = candidates.filter((a) => {
      if (wantsAccountType && a.type !== wantsAccountType) return false;
      const acctKey = norm(a.externalKey);
      if (!acctKey) return false;
      return acctKey === fileKey || acctKey.includes(fileKey) || fileKey.includes(acctKey);
    });
    if (hits.length === 1) {
      accountId = hits[0]!.id;
      autoRouted = true;
    } else if (hits.length > 1) {
      return empty(
        `זוהו ${hits.length} חשבונות התואמים את מזהה הקובץ "${parsedEarly.accountKey}". בחר חשבון מפורש.`,
      );
    }
  }
  if (!accountId) {
    const hint = parsedEarly.accountKey
      ? ` (מזהה בקובץ: ${parsedEarly.accountKey} — הגדר אותו כ-"מזהה חיצוני" באחד החשבונות לזיהוי אוטומטי)`
      : '';
    return empty(`יש לבחור חשבון${hint}`);
  }

  // Verify the chosen account belongs to this household + grab its cutoff
  // for billing-month computation when the file doesn't carry a chargeDate.
  const [account] = await db
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
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
  // Re-use the parse from the auto-routing pass — no second smartImport
  // call needed (parsing big Excel files isn't cheap).
  const parsed = parsedEarly;

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
      eq(schema.categories.isArchived, false),
    )),
  ]);

  // Two lookup maps:
  //   • topCategoryByName: parent-level only (used by the bank-hint
  //     pattern map — coarse hints should land on the parent).
  //   • subCategoryByName: child categories with their parent id (used by
  //     tagged-export formats that supply both the parent name and the
  //     sub-category name as exact strings).
  const topCategoryByName = new Map<string, string>(
    allCategories
      .filter((c) => !c.parentId)
      .map((c) => [c.nameHe.toLowerCase().trim(), c.id]),
  );
  const subCategoryByName = new Map<string, { id: string; parentId: string }>(
    allCategories
      .filter((c) => c.parentId)
      .map((c) => [c.nameHe.toLowerCase().trim(), { id: c.id, parentId: c.parentId! }]),
  );

  // ── Pass 0: auto-create categories from tagged-export hints. Only kicks
  // in for the `tagged-export` template — other formats use the substring
  // hint map, where unmatched hints just fall through to the next pass. ──
  let categoriesCreated = 0;
  if (parsed.templateUsed?.id === 'tagged-export') {
    // Distinct (parent, sub) pairs from the parsed rows
    const pairs = new Map<string, { parent: string; sub: string | null }>();
    for (const t of parsed.transactions) {
      if (!t.categoryHint) continue;
      const key = `${t.categoryHint}|${t.subCategoryHint ?? ''}`;
      if (pairs.has(key)) continue;
      pairs.set(key, { parent: t.categoryHint, sub: t.subCategoryHint ?? null });
    }

    let nextSortOrder = allCategories.length;
    for (const { parent, sub } of pairs.values()) {
      const parentKey = parent.toLowerCase().trim();
      let parentId = topCategoryByName.get(parentKey) ?? null;
      // Create parent if missing
      if (!parentId) {
        const [created] = await db.insert(schema.categories).values({
          householdId: ctx.householdId,
          nameHe:      parent,
          sortOrder:   nextSortOrder++,
        }).returning({ id: schema.categories.id });
        if (created) {
          parentId = created.id;
          topCategoryByName.set(parentKey, parentId);
          categoriesCreated++;
        }
      }
      // Create sub-category if missing AND we have a parent
      if (sub && parentId) {
        const subKey = sub.toLowerCase().trim();
        if (!subCategoryByName.has(subKey)) {
          const [created] = await db.insert(schema.categories).values({
            householdId: ctx.householdId,
            nameHe:      sub,
            parentId,
            sortOrder:   0,
          }).returning({ id: schema.categories.id });
          if (created) {
            subCategoryByName.set(subKey, { id: created.id, parentId });
            categoriesCreated++;
          }
        }
      }
    }
  }

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

  // Installment markers in notes — TWO patterns we accept:
  //   "תשלום N מתוך Y"      → ongoing payment N of Y (used by Discount Key,
  //                            bank-portal export, MasterCard, etc.)
  //   "עסקה ב-N תשלומים"   → initial purchase row in the new Cal/Diners
  //                            portal — the user just authorized N future
  //                            payments. Treat as currentPaymentNo=1, total=N.
  const installmentRegex     = /תשלום\s*(\d+)\s*מתוך\s*(\d+)/;
  const installmentInitRegex = /עסקה\s*ב[־\-]\s*(\d+)\s*תשלומים/;

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

    const notesStr = t.notes ?? '';
    let N: number | null = null;
    let Y: number | null = null;
    const m = notesStr.match(installmentRegex);
    if (m) {
      N = Number(m[1]);
      Y = Number(m[2]);
    } else {
      const initM = notesStr.match(installmentInitRegex);
      if (initM) {
        N = 1;
        Y = Number(initM[1]);
      }
    }
    if (!N || !Y || !Number.isFinite(N) || !Number.isFinite(Y) || Y < 1 || N < 1) {
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
  // Precedence (highest first):
  //   1. User's category rules
  //   2. Tagged-export EXACT-name match (categoryHint = household category name)
  //   3. Bank ענף → BANK_HINT_TO_OUR_CATEGORY substring map
  //   4. Merchant-name keyword scan with the same map
  let categorizedRows = 0;
  let taggedExportCategorized = 0;
  let bankHintCategorized = 0;
  let merchantKeywordCategorized = 0;
  let ccSettlementsFlagged = 0;
  let rowsLinkedToPlans = 0;
  // Bank-only flag: only run CC-settlement detection when this import is
  // for a BANK account file. CC export files don't have CC settlement rows.
  const isBankAccount = parsed.templateUsed?.type === 'bank';
  // For Pass 4 (after inserts): collect distinct merchants flagged as
  // recurring and create recurring_pattern rows for them.
  const recurringByMerchant = new Map<string, { categoryId: string | null; amountSigned: number }>();
  const inserts = rowMetas.map(({ tx, merchantNorm, billingMonth, installment }) => {
    const ruleResult = applyRules(allRules, {
      merchantNormalized: merchantNorm,
      merchantRaw:        tx.merchantRaw,
      accountId,
      amountAbs:          Math.abs(tx.amountIls),
      notes:              tx.notes,
    });
    if (ruleResult) categorizedRows++;

    // Tagged-export EXACT-name match: the file already carries a category
    // string that matches one of the household's category names verbatim.
    // Used by `tagged-export` and any future template that ships ground-truth
    // data. Higher precedence than the substring map because it's an exact
    // user-confirmed signal.
    let taggedCategoryId: string | null = null;
    let taggedSubCategoryId: string | null = null;
    if (!ruleResult && tx.categoryHint) {
      const hit = topCategoryByName.get(tx.categoryHint.toLowerCase().trim());
      if (hit) {
        taggedCategoryId = hit;
        taggedExportCategorized++;
      }
    }
    if (taggedCategoryId && tx.subCategoryHint) {
      const sub = subCategoryByName.get(tx.subCategoryHint.toLowerCase().trim());
      if (sub && sub.parentId === taggedCategoryId) {
        taggedSubCategoryId = sub.id;
      }
    }

    // Bank-hint fallback: substring map against bank's ענף label.
    let bankHintCategoryId: string | null = null;
    if (!ruleResult && !taggedCategoryId && tx.categoryHint) {
      bankHintCategoryId = matchBankHintToCategoryId(tx.categoryHint, topCategoryByName);
      if (bankHintCategoryId) bankHintCategorized++;
    }

    // Merchant-name keyword fallback: same map against merchant string.
    let merchantKeywordCategoryId: string | null = null;
    if (!ruleResult && !taggedCategoryId && !bankHintCategoryId) {
      merchantKeywordCategoryId = matchBankHintToCategoryId(tx.merchantRaw, topCategoryByName);
      if (merchantKeywordCategoryId) merchantKeywordCategorized++;
    }

    const planId = installment ? planMap.get(installment.fingerprint) ?? null : null;
    if (planId) rowsLinkedToPlans++;

    // Tagged-export recurring flag: queue for Pass 4. We aggregate by
    // merchant so multiple recurring rows for the same merchant only
    // create ONE recurring_pattern (matches the unique-by-merchant index).
    if (tx.isRecurringHint) {
      const finalCatId = ruleResult?.categoryId ?? taggedCategoryId ?? bankHintCategoryId ?? merchantKeywordCategoryId ?? null;
      recurringByMerchant.set(merchantNorm, {
        categoryId: finalCatId,
        amountSigned: tx.amountIls,
      });
    }

    // CC-settlement detection: when this row is on a BANK file AND the
    // merchant name matches a CC-issuer pattern, mark as transfer so it
    // doesn't double-count against the granular CC rows imported from
    // the credit-card file. Examples:
    //   • "כ.א.ל חיוב 15.18₪" on Discount checking → transfer (Cal will
    //     ship the underlying ₪15.18 charge in its own file)
    //   • "ויזה ק.ש.ר 142₪" on Leumi business → transfer
    //   • "דיינרס חיוב 480₪" → transfer
    const isCcSettlement = isBankAccount && looksLikeCcSettlement(tx.merchantRaw);
    if (isCcSettlement) ccSettlementsFlagged++;

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
      // is_transfer fires from EITHER the tagged-export העברה flag OR
      // the CC-settlement detector. Either way the row is excluded from
      // cash-flow totals (the granular detail comes from the matching
      // CC excel import).
      ...(tx.isTransferHint || isCcSettlement ? { isTransfer: true } : {}),
      ...(planId ? { installmentPlanId: planId } : {}),
      ...(ruleResult ? {
        categoryId:    ruleResult.categoryId,
        subCategoryId: ruleResult.subCategoryId,
        appliedRuleId: ruleResult.rule.id,
        categorySource: 'rule' as const,
      } : taggedCategoryId ? {
        categoryId:     taggedCategoryId,
        ...(taggedSubCategoryId ? { subCategoryId: taggedSubCategoryId } : {}),
        // 'tagged_export' — the file already carried an exact category name.
        categorySource: 'tagged_export' as const,
      } : bankHintCategoryId ? {
        categoryId:     bankHintCategoryId,
        // 'bank_hint' — the bank's own ענף column drove this. Distinct from
        // 'rule' so the UI badge says "ענף בנק" instead of "כלל".
        categorySource: 'bank_hint' as const,
      } : merchantKeywordCategoryId ? {
        categoryId:     merchantKeywordCategoryId,
        // 'merchant_keyword' — keyword scan against the merchant string.
        // Distinct so the UI badge says "אוטומטי" not "כלל".
        categorySource: 'merchant_keyword' as const,
      } : {}),
      externalId: hashRowId(tx.transactionDate, tx.chargeDate, tx.amountIls, tx.merchantRaw, tx.notes),
    };
  });

  // ── Disambiguate intra-batch duplicate externalIds.
  // When the source file has TRUE duplicate rows (e.g., the user bought
  // coffee twice in one day at the same place for the same amount, or two
  // identical parking charges), they hash to the same externalId. Postgres
  // refuses ON CONFLICT DO UPDATE to touch the same row twice in one
  // statement → "command cannot affect row a second time".
  //
  // Fix: walk the rows once, count each externalId, and append a "#N"
  // suffix to the 2nd / 3rd / ... occurrence. Idempotent across re-imports
  // because the source order is stable AND we only suffix WITHIN the
  // duplicate group, leaving the first occurrence untouched.
  //
  // EXCEPTION — installment-linked rows: some bank exports list every
  // payment of an installment plan as a separate identical row on the
  // day the plan was opened (instead of distributing each across its
  // future month). Suffixing creates N duplicate "payment 1/N" rows
  // that pollute the cycle and mislead the user. Instead, DROP the
  // duplicates here — the installment_plan handles the missing
  // payments via the synthesized "צפוי" projection rows.
  // ───────────────────────────────────────────────────────────────────────
  const seenSeq = new Map<string, number>();
  const droppedInstallmentDups: number[] = [];
  for (let i = 0; i < inserts.length; i++) {
    const row = inserts[i]!;
    const base = row.externalId as string;
    const n = (seenSeq.get(base) ?? 0) + 1;
    seenSeq.set(base, n);
    if (n > 1) {
      if ((row as { installmentPlanId?: string | null }).installmentPlanId) {
        // Drop the duplicate — same plan/date/amount/merchant means the
        // bank file double-listed the same payment; we keep the first.
        droppedInstallmentDups.push(i);
      } else {
        // Not an installment — these ARE legitimate (two coffees, etc.)
        // Suffix into the same 24-char slot to keep the unique-index happy.
        row.externalId = createHash('sha1').update(`${base}#${n}`).digest('hex').slice(0, 24);
      }
    }
  }
  // Remove from highest index to lowest so the indices stay valid.
  for (let i = droppedInstallmentDups.length - 1; i >= 0; i--) {
    inserts.splice(droppedInstallmentDups[i]!, 1);
  }
  if (droppedInstallmentDups.length > 0) {
    console.log(`[import] dropped ${droppedInstallmentDups.length} duplicate installment row(s) (bank double-listed the same payment)`);
  }

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

    // ── Pass 4: materialize recurring patterns from the file's חוזר flag.
    // Aggregated by merchant in Pass 3, so this is one INSERT per unique
    // recurring merchant. ON CONFLICT DO NOTHING via the
    // unique(householdId, merchantNormalized) index — keeps existing
    // user-edited recurring rows intact on re-import. ─────────────────────
    let recurringPatternsCreated = 0;
    if (recurringByMerchant.size > 0) {
      const month = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();
      for (const [merchant, info] of recurringByMerchant.entries()) {
        const result = await db.insert(schema.recurringPatterns).values({
          householdId:        ctx.householdId,
          merchantNormalized: merchant,
          ...(info.categoryId ? { categoryId: info.categoryId } : {}),
          expectedAmountIls:  String(info.amountSigned),
          medianAmountIls:    String(info.amountSigned),
          tolerancePct:       10,
          frequency:          'monthly',
          occurrenceCount:    0,
          firstSeenMonth:     month,
          lastSeenMonth:      month,
          status:             'active',
        }).onConflictDoNothing().returning({ id: schema.recurringPatterns.id });
        if (result.length > 0) recurringPatternsCreated++;
      }
    }

    // ── Pass 5: cross-account transfer pairing.
    // When a transfer happens between two of the user's accounts (e.g.,
    // Leumi → Discount), each side appears in its own bank file. We've
    // already flagged each side as is_transfer = true via the tagged-export
    // העברה column. Now we need to find pairs and link them via
    // transfer_pair_id so they cancel out in cash-flow widgets.
    //
    // Pairing rules:
    //   • both must be in the same household
    //   • is_transfer = true on both
    //   • both have transfer_pair_id IS NULL (don't double-pair)
    //   • account_id MUST differ (same-account transfers don't make sense)
    //   • amounts sum to ~0 (one positive, one negative, equal magnitude)
    //   • dates within ±2 days (settlement delay)
    //
    // We query all unpaired transfers for the household — not just this
    // import — so a Leumi side imported today can pair with a Discount
    // side imported yesterday. ────────────────────────────────────────────
    const unpaired = await db
      .select({
        id:              schema.transactions.id,
        accountId:       schema.transactions.accountId,
        transactionDate: schema.transactions.transactionDate,
        amountIls:       schema.transactions.amountIls,
      })
      .from(schema.transactions)
      .where(and(
        eq(schema.transactions.householdId, ctx.householdId),
        eq(schema.transactions.isTransfer, true),
        isNull(schema.transactions.transferPairId),
        isNull(schema.transactions.deletedAt),
      ));

    // Pair greedily: smallest date-difference first wins.
    let transferPairsLinked = 0;
    const used = new Set<string>();
    for (let i = 0; i < unpaired.length; i++) {
      const a = unpaired[i]!;
      if (used.has(a.id)) continue;
      const aAmt = Number(a.amountIls);
      let best: { id: string; daysDiff: number } | null = null;
      for (let j = i + 1; j < unpaired.length; j++) {
        const b = unpaired[j]!;
        if (used.has(b.id)) continue;
        if (b.accountId === a.accountId) continue; // must be different accounts
        const bAmt = Number(b.amountIls);
        // Opposite sign + equal magnitude (within 1 agora to absorb rounding)
        if (Math.abs(aAmt + bAmt) > 0.01) continue;
        if (Math.sign(aAmt) === Math.sign(bAmt)) continue;
        const daysDiff = Math.abs(
          (new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()) / 86400000,
        );
        if (daysDiff > 2) continue;
        if (!best || daysDiff < best.daysDiff) best = { id: b.id, daysDiff };
      }
      if (best) {
        await db.update(schema.transactions)
          .set({ transferPairId: best.id })
          .where(eq(schema.transactions.id, a.id));
        await db.update(schema.transactions)
          .set({ transferPairId: a.id })
          .where(eq(schema.transactions.id, best.id));
        used.add(a.id);
        used.add(best.id);
        transferPairsLinked++;
      }
    }

    // ── Pass 6: count this import's matched-recurring transactions for the
    // user-facing summary ("X out of your N new transactions are recurring").
    const recurringMerchants = await db
      .select({ m: schema.recurringPatterns.merchantNormalized })
      .from(schema.recurringPatterns)
      .where(and(
        eq(schema.recurringPatterns.householdId, ctx.householdId),
        eq(schema.recurringPatterns.status, 'active'),
      ));
    const recurringSet = new Set(recurringMerchants.map((r) => r.m));
    const matchedExistingRecurring = inserts.filter((i) =>
      recurringSet.has(i.merchantNormalized as string),
    ).length;

    // ── Pass 7: AUTO-AI categorization for any rows still uncategorized
    // after rules + bank-hint + merchant-keyword + tagged-export. Sends
    // distinct uncategorized merchants from THIS import to Claude Haiku
    // in a single batch call. For each high-confidence (≥0.6) result,
    // creates a contains-rule (so future imports of the same merchant
    // land categorized without another LLM call) and updates the
    // matching transactions' categoryId/source = 'llm'.
    //
    // Best-effort — failures are silently swallowed so a transient
    // Anthropic outage doesn't block an otherwise-successful import.
    let aiCategorized = 0;
    let aiRulesCreated = 0;
    try {
      // Find merchants from THIS batch that are still uncategorized.
      // Excludes is_transfer rows (CC settlements, cross-account hops) —
      // those don't need a category since they're zeroed in cash flow.
      const externalIdsThisBatch = inserts.map((i) => i.externalId).filter(Boolean) as string[];
      if (externalIdsThisBatch.length > 0) {
        const uncategorizedRows = await db
          .select({
            merchantNormalized: schema.transactions.merchantNormalized,
            amountIls: schema.transactions.amountIls,
          })
          .from(schema.transactions)
          .where(and(
            eq(schema.transactions.householdId, ctx.householdId),
            eq(schema.transactions.accountId, accountId),
            inArray(schema.transactions.externalId, externalIdsThisBatch),
            isNull(schema.transactions.categoryId),
            eq(schema.transactions.isTransfer, false),
          ));

        // Group by merchant — one classification per unique merchant.
        const byMerchant = new Map<string, number>();
        for (const r of uncategorizedRows) {
          const m = r.merchantNormalized;
          if (!byMerchant.has(m)) byMerchant.set(m, Number(r.amountIls));
        }

        if (byMerchant.size > 0) {
          // Reuse the household's category list for the LLM prompt.
          const cats = await db
            .select({
              id: schema.categories.id,
              nameHe: schema.categories.nameHe,
              nameEn: schema.categories.nameEn,
              isIncome: schema.categories.isIncome,
            })
            .from(schema.categories)
            .where(and(
              eq(schema.categories.householdId, ctx.householdId),
              isNull(schema.categories.parentId),
            ));
          const categoriesForLlm = cats.map((c) => ({
            id: c.id, nameHe: c.nameHe, nameEn: c.nameEn ?? null, isIncome: c.isIncome,
          }));
          const validCategoryIds = new Set(cats.map((c) => c.id));

          const merchantList = [...byMerchant.entries()].slice(0, 80).map(([m, amt]) => ({
            merchantNormalized: m,
            sampleAmounts: [amt],
          }));

          const client = new CategorizerBatchClient();
          const llmResp = await client.categorizeMany(merchantList, categoriesForLlm);
          const CONFIDENCE_THRESHOLD = 0.6;

          for (let i = 0; i < merchantList.length; i++) {
            const ent = merchantList[i]!;
            const llm = llmResp.results[i];
            if (!llm || !llm.categoryId || !validCategoryIds.has(llm.categoryId)) continue;
            if (llm.confidence < CONFIDENCE_THRESHOLD) continue;

            // Auto-create a contains-rule so future imports of this
            // merchant land categorized without an AI call.
            const ruleResult = await db.insert(schema.categoryRules).values({
              householdId: ctx.householdId,
              name: `AI: ${ent.merchantNormalized}`,
              description: `Auto-created during import — ${llm.reasoning.slice(0, 200)}`,
              priority: 500,
              matchType: 'contains',
              pattern: ent.merchantNormalized,
              categoryId: llm.categoryId,
              ...(llm.subCategoryId ? { subCategoryId: llm.subCategoryId } : {}),
              isActive: true,
              source: 'llm_confirmed',
            }).onConflictDoNothing().returning({ id: schema.categoryRules.id });
            if (ruleResult.length > 0) aiRulesCreated++;

            // Backfill matching transactions in this account.
            const updated = await db
              .update(schema.transactions)
              .set({
                categoryId: llm.categoryId,
                subCategoryId: llm.subCategoryId ?? null,
                categorySource: 'llm',
                ...(ruleResult[0]?.id ? { appliedRuleId: ruleResult[0].id } : {}),
              })
              .where(and(
                eq(schema.transactions.householdId, ctx.householdId),
                eq(schema.transactions.accountId, accountId),
                eq(schema.transactions.merchantNormalized, ent.merchantNormalized),
                isNull(schema.transactions.categoryId),
              ))
              .returning({ id: schema.transactions.id });
            aiCategorized += updated.length;
          }
        }
      }
    } catch (err) {
      // Don't fail the import on AI errors — log for diagnostics.
      console.error('[import] auto-AI categorization failed:', err);
    }

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
        taggedExportCategorized,
        recurringPatternsCreated,
        transferRows: inserts.filter((i) => i.isTransfer === true).length,
        transferPairsLinked,
        categoriesCreated,
        ccSettlementsFlagged,
        matchedExistingRecurring,
        aiCategorized,
        aiRulesCreated,
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
      taggedExportCategorized,
      recurringPatternsCreated,
      transferRows: inserts.filter((i) => i.isTransfer === true).length,
      transferPairsLinked,
      categoriesCreated,
      ccSettlementsFlagged,
      matchedExistingRecurring,
      aiCategorized,
      aiRulesCreated,
      autoRoutedAccount: autoRouted,
      destinationAccountName: account.name,
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
