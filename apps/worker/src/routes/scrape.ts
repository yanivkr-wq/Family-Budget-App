import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, schema } from '@fba/db';
import { and, eq } from 'drizzle-orm';
import { runScrapeForAccount } from '../scrapers/run';
import type { Config } from '../config';

const TriggerScrape = z.object({
  householdId: z.string().uuid(),
  accountId: z.string().uuid().optional(), // if omitted, scrape all active accounts
});

export async function registerScrapeRoutes(
  app: FastifyInstance,
  _opts: { config: Config },
) {
  // Manual scrape trigger — useful for "Run now" button or first-time backfill.
  app.post('/scrape/trigger', async (req, reply) => {
    const parsed = TriggerScrape.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      return;
    }

    const db = getDb();
    const accounts = await db
      .select()
      .from(schema.accounts)
      .where(
        parsed.data.accountId
          ? and(
              eq(schema.accounts.householdId, parsed.data.householdId),
              eq(schema.accounts.id, parsed.data.accountId),
            )
          : and(
              eq(schema.accounts.householdId, parsed.data.householdId),
              eq(schema.accounts.isActive, true),
            ),
      );

    const results = [];
    for (const account of accounts) {
      try {
        const r = await runScrapeForAccount({ db, account, logger: app.log });
        results.push({ ok: true, ...r });
      } catch (err) {
        results.push({
          accountId: account.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    reply.send({ results });
  });
}
