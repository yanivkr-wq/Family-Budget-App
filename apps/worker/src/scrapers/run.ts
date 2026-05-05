import {
  type Account,
  type Database,
  computeBillingMonth,
  decryptString,
  normalizeMerchant,
  parseInstallment,
  schema,
} from '@fba/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

// Phase 2 will wire `israeli-bank-scrapers` here. For now this scaffolding shows
// the intended shape so the pipeline downstream of scraping is exercised end-to-end
// in tests with a fixture provider.

export interface ScrapeOutcome {
  accountId: string;
  inserted: number;
  duplicates: number;
  durationMs: number;
}

export interface RawScrapedTxn {
  // The shape israeli-bank-scrapers' `Transaction` returns. Keep this minimal subset
  // so we can swap in the real type when we wire the package up in Phase 2.
  identifier: string;
  date: string; // ISO yyyy-mm-dd or full ISO string
  processedDate?: string;
  chargedAmount: number; // negative = debit, positive = credit
  description: string;
  memo?: string;
  installments?: { number: number; total: number };
  originalAmount?: number;
  originalCurrency?: string;
}

export interface ScrapeProvider {
  name: string;
  scrape(input: { credentials: Record<string, string>; startDate: Date }): Promise<{
    accounts: Array<{ accountNumber: string; txns: RawScrapedTxn[] }>;
  }>;
}

// Provider lookup. Populated once israeli-bank-scrapers is integrated.
const PROVIDERS: Record<string, ScrapeProvider> = {};

export function registerProvider(p: ScrapeProvider) {
  PROVIDERS[p.name] = p;
}

export async function runScrapeForAccount(opts: {
  db: Database;
  account: Account;
  logger: FastifyBaseLogger;
}): Promise<ScrapeOutcome> {
  const { db, account, logger } = opts;
  const start = Date.now();

  if (!account.scraperProvider || !account.encryptedCredentials) {
    throw new Error(`Account ${account.id} has no scraper configured`);
  }

  const provider = PROVIDERS[account.scraperProvider];
  if (!provider) {
    throw new Error(
      `Provider "${account.scraperProvider}" not registered. Wire it up in apps/worker/src/scrapers/providers/.`,
    );
  }

  const credentials = JSON.parse(decryptString(account.encryptedCredentials)) as Record<
    string,
    string
  >;
  // Look back ~60 days on each scrape to give us a window for re-tries / corrections.
  const startDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const result = await provider.scrape({ credentials, startDate });

  let inserted = 0;
  let duplicates = 0;

  for (const acc of result.accounts) {
    for (const raw of acc.txns) {
      const transactionDate = raw.date.slice(0, 10);
      const merchantNormalized = normalizeMerchant(raw.description);
      const billingMonth = computeBillingMonth(transactionDate, account.cutoffDay);
      const installment = raw.installments ?? parseInstallment(raw.description);

      try {
        await db
          .insert(schema.transactions)
          .values({
            householdId: account.householdId,
            accountId: account.id,
            externalId: raw.identifier,
            transactionDate,
            postedDate: raw.processedDate?.slice(0, 10),
            billingMonth,
            amountIls: String(raw.chargedAmount),
            currency: 'ILS',
            originalAmount: raw.originalAmount ? String(raw.originalAmount) : null,
            originalCurrency: raw.originalCurrency,
            merchantRaw: raw.description,
            merchantNormalized,
            isInstallment: !!installment,
            isManual: false,
            rawSource: raw as unknown as object,
          })
          .onConflictDoNothing({
            target: [schema.transactions.accountId, schema.transactions.externalId],
          });
        inserted++;
      } catch (err) {
        logger.warn({ err, externalId: raw.identifier }, 'transaction insert failed');
        duplicates++;
      }
    }
  }

  await db
    .update(schema.accounts)
    .set({
      lastScrapedAt: new Date(),
      lastScrapeStatus: 'ok',
      lastScrapeError: null,
    })
    .where(eq(schema.accounts.id, account.id));

  return {
    accountId: account.id,
    inserted,
    duplicates,
    durationMs: Date.now() - start,
  };
}
