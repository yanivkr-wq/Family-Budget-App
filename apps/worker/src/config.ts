import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Use WORKER_PORT to avoid colliding with Next.js's PORT (which it sets to 3000
  // when running in dev). Fall back to PORT if WORKER_PORT not set, then 8080.
  WORKER_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  TZ: z.string().default('Asia/Jerusalem'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  MASTER_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_CHATBOT: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_MODEL_CATEGORIZER: z.string().default('claude-haiku-4-5-20251001'),
  WORKER_INTERNAL_TOKEN: z.string().min(16, 'A shared bearer token between web and worker'),
  SCRAPE_CRON: z.string().default('0 6 * * *'),
  DEFAULT_CUTOFF_DAY: z.coerce.number().int().min(0).max(28).default(10),

  // ── Notifications ───────────────────────────────────────────────────────
  // Cron for the reminder dispatcher. Defaults to every 5 minutes — fine
  // granularity for the 1-minute time-of-day inputs the form exposes.
  REMINDER_CRON: z.string().default('*/5 * * * *'),
  /**
   * Public URL the user uses to access the web app. Used to build
   * "Mark done" links in notification emails so the recipient can complete
   * the task from their inbox without manually navigating. Defaults to the
   * dev server.
   */
  APP_URL: z.string().default('http://localhost:3010'),

  // Email channel (nodemailer SMTP). All optional — if missing, the email
  // channel marks events as 'skipped' rather than failing.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // WhatsApp channel (Twilio). All optional — if missing, channel skips.
  // TWILIO_WHATSAPP_FROM is the sandbox / approved number prefixed with
  // 'whatsapp:' (Twilio convention), e.g. 'whatsapp:+14155238886'.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  // ── Backups (Backblaze B2 via S3-compatible API) ─────────────────────────
  // Daily Postgres dumps uploaded to B2. All optional — if any of the four
  // values is missing, the backup cron logs a warning and skips. Restore
  // path is documented at /admin/backups in the web app.
  B2_ENDPOINT: z.string().optional(),       // e.g. 's3.eu-central-003.backblazeb2.com'
  B2_BUCKET:   z.string().optional(),
  B2_KEY_ID:   z.string().optional(),
  B2_APP_KEY:  z.string().optional(),
  // Cron for the backup. Defaults to 03:00 daily local TZ — chosen for
  // low traffic + after midnight rollover (so the dated filename is
  // unambiguously "yesterday's data").
  BACKUP_CRON: z.string().default('0 3 * * *'),
  // Days to keep backups in B2 before pruning. Older dumps cost storage
  // but rarely matter for restore — 30 days covers "oh no" within the
  // billing month plus a buffer.
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Set in DEV to the name of the local Postgres docker container (e.g.
  // 'budget-pg') so the backup uses `docker exec` to invoke pg_dump.
  // Leave UNSET in PROD where the worker container has pg_dump locally
  // and Postgres is reachable over the docker network at the standard
  // DATABASE_URL host.
  BACKUP_PG_DOCKER_CONTAINER: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(): Config {
  const result = Env.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
