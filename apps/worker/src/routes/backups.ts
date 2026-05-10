/**
 * Internal worker routes for the /admin/backups page:
 *   POST /backups/run-now  → trigger a backup immediately
 *   GET  /backups/list     → list recent backups in B2
 *
 * Both are protected by the same shared bearer-token check the rest of the
 * worker uses (see server.ts onRequest hook).
 */

import type { FastifyInstance } from 'fastify';
import { runBackup, listBackups } from '../backups/postgres-backup';
import type { Config } from '../config';

export async function registerBackupRoutes(app: FastifyInstance, opts: { config: Config }) {
  // On-demand backup. Long-running (10s-2min depending on DB size) — the
  // web action shows a spinner during the wait. Returns the same shape as
  // the cron's result so the UI can show success/failure + bytes.
  app.post('/backups/run-now', async (_req, reply) => {
    const result = await runBackup({ config: opts.config, logger: app.log });
    reply.code(result.ok || result.skipped ? 200 : 500).send(result);
  });

  // List recent backups for the /admin/backups table. Hits B2's S3 list
  // API — cheap, no DB query.
  app.get('/backups/list', async (_req, reply) => {
    try {
      const items = await listBackups(opts.config);
      reply.code(200).send({ items });
    } catch (err) {
      reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
