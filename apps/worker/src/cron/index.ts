import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { runScrapeForAccount } from '../scrapers/run';
import type { Config } from '../config';

export function registerCron(app: FastifyInstance, opts: { config: Config }) {
  if (!cron.validate(opts.config.SCRAPE_CRON)) {
    app.log.warn(`Invalid SCRAPE_CRON: ${opts.config.SCRAPE_CRON} — cron disabled`);
    return;
  }

  cron.schedule(
    opts.config.SCRAPE_CRON,
    async () => {
      app.log.info('Cron: scheduled scrape starting');
      const db = getDb();
      const accounts = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.isActive, true));

      for (const account of accounts) {
        if (!account.scraperProvider) continue;
        try {
          const outcome = await runScrapeForAccount({ db, account, logger: app.log });
          app.log.info({ outcome }, `Scrape completed for ${account.name}`);
        } catch (err) {
          app.log.error({ err, accountId: account.id }, 'Scrape failed');
          await db
            .update(schema.accounts)
            .set({
              lastScrapeStatus: 'error',
              lastScrapeError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(schema.accounts.id, account.id));
        }
      }
    },
    { timezone: opts.config.TZ },
  );

  app.log.info(`Cron registered: ${opts.config.SCRAPE_CRON} (${opts.config.TZ})`);
}
