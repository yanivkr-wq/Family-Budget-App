import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '@fba/db';
import { eq } from 'drizzle-orm';
import { runScrapeForAccount } from '../scrapers/run';
import { dispatchDueReminders } from '../notifications/dispatcher';
import { runBackup } from '../backups/postgres-backup';
import type { Config } from '../config';

export function registerCron(app: FastifyInstance, opts: { config: Config }) {
  // ── Scheduled bank/CC scrape ─────────────────────────────────────────────
  if (!cron.validate(opts.config.SCRAPE_CRON)) {
    app.log.warn(`Invalid SCRAPE_CRON: ${opts.config.SCRAPE_CRON} — scrape cron disabled`);
  } else {
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
    app.log.info(`Cron registered: scrape ${opts.config.SCRAPE_CRON} (${opts.config.TZ})`);
  }

  // ── Notification reminder dispatcher ─────────────────────────────────────
  // Fires every REMINDER_CRON (default */5 min). Cheap query — only scans
  // active reminders attached to active tasks. Idempotent via the unique
  // index on notification_event(reminder_id, fire_at, channel) so concurrent
  // ticks (or a delayed run) won't double-send.
  if (!cron.validate(opts.config.REMINDER_CRON)) {
    app.log.warn(`Invalid REMINDER_CRON: ${opts.config.REMINDER_CRON} — reminder cron disabled`);
  } else {
    cron.schedule(
      opts.config.REMINDER_CRON,
      async () => {
        try {
          const result = await dispatchDueReminders({ config: opts.config, logger: app.log });
          if (result.fired > 0) {
            app.log.info(result, 'reminder dispatcher tick');
          }
        } catch (err) {
          app.log.error({ err }, 'reminder dispatcher crashed');
        }
      },
      { timezone: opts.config.TZ },
    );
    app.log.info(`Cron registered: reminders ${opts.config.REMINDER_CRON} (${opts.config.TZ})`);
  }

  // ── Postgres → B2 daily backup ───────────────────────────────────────────
  // Runs at BACKUP_CRON (default 03:00 daily). Skips cleanly if B2 isn't
  // configured — no error, just a "skipped" log line. Streams pg_dump →
  // gzip → S3 PutObject so memory stays flat regardless of DB size.
  // Auto-prunes backups older than BACKUP_RETENTION_DAYS in the same run.
  if (!cron.validate(opts.config.BACKUP_CRON)) {
    app.log.warn(`Invalid BACKUP_CRON: ${opts.config.BACKUP_CRON} — backup cron disabled`);
  } else {
    cron.schedule(
      opts.config.BACKUP_CRON,
      async () => {
        try {
          const result = await runBackup({ config: opts.config, logger: app.log });
          if (result.skipped) {
            app.log.warn({ reason: result.reason }, 'backup skipped');
          } else if (result.ok) {
            app.log.info(result, 'backup ok');
          } else {
            app.log.error(result, 'backup failed');
          }
        } catch (err) {
          app.log.error({ err }, 'backup cron crashed');
        }
      },
      { timezone: opts.config.TZ },
    );
    app.log.info(`Cron registered: backup ${opts.config.BACKUP_CRON} (${opts.config.TZ})`);
  }
}
