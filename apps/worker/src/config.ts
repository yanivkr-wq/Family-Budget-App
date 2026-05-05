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
