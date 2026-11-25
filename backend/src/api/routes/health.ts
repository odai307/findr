import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db/client.js';

/** /healthz: the process is up. /readyz: it can also reach the database (used by the load balancer). */
export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));

  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true, database: 'up' };
    } catch {
      return reply.status(503).send({ ok: false, database: 'down' });
    }
  });
};
