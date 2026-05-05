import type { FastifyInstance } from 'fastify';
import { getDb } from '@fba/db';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/healthz', async (_req, reply) => {
    try {
      await getDb().execute('SELECT 1' as unknown as never);
      reply.code(200).send({ status: 'ok' });
    } catch (err) {
      app.log.error({ err }, 'Health check DB query failed');
      reply.code(503).send({ status: 'degraded', error: 'db' });
    }
  });
}
