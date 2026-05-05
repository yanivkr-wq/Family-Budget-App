import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config';
import { closeDb, getDb } from '@fba/db';
import { registerHealthRoutes } from './routes/health';
import { registerChatRoutes } from './routes/chat';
import { registerScrapeRoutes } from './routes/scrape';
import { registerCron } from './cron/index';

const config = loadConfig();

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  },
  trustProxy: true, // sits behind Caddy
});

await app.register(cors, {
  origin: false, // worker is internal-only; web app calls it via internal docker network
});

await app.register(rateLimit, {
  global: false,
});

// Auth: every request (except /healthz) requires the shared bearer token from the web app.
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/healthz') return;
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${config.WORKER_INTERNAL_TOKEN}`) {
    reply.code(401).send({ error: 'unauthorized' });
  }
});

// Initialize DB connection eagerly so the first request doesn't pay setup cost.
const db = getDb(config.DATABASE_URL);
await db.execute('SELECT 1' as unknown as never).catch((err) => {
  app.log.error({ err }, 'Database connection failed at startup');
  process.exit(1);
});

await registerHealthRoutes(app);
await registerChatRoutes(app, { config });
await registerScrapeRoutes(app, { config });

registerCron(app, { config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await closeDb();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Prefer WORKER_PORT (explicit, won't collide with Next.js's PORT). Fall back to 8080.
const workerPort = config.WORKER_PORT ?? 8080;
try {
  await app.listen({ port: workerPort, host: config.HOST });
  app.log.info(`Worker listening on http://${config.HOST}:${workerPort}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
