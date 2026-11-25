import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalsFor } from '../../auth/principals.js';
import type { Db } from '../../db/client.js';
import type { Embedder } from '../../ingestion/embedder.js';
import { basicSearch } from '../../search/basic.js';
import { getWorkspaceForUser } from '../../workspaces/service.js';
import { userIdOf } from '../plugins/auth.js';

const hitSchema = z.object({
  documentId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  provider: z.string(),
  type: z.string(),
  author: z.string().nullable(),
  container: z.string().nullable(),
  updatedAt: z.date().nullable(),
  snippet: z.string(),
  score: z.number(),
});

/** Routes under /v1/workspaces/:workspaceId/search */
export const searchRoutes: FastifyPluginAsync<{ db: Db; embedder: Embedder }> = async (
  fastify,
  { db, embedder },
) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        querystring: z.object({
          q: z.string().trim().min(1).max(500),
          mode: z.enum(['keyword', 'semantic']).default('keyword'),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        }),
        response: { 200: z.object({ data: z.array(hitSchema), tookMs: z.number() }) },
      },
    },
    async (request) => {
      const started = performance.now();
      const userId = userIdOf(request);
      const { workspaceId } = request.params;
      await getWorkspaceForUser(db, workspaceId, userId);
      const principals = await principalsFor(db, userId, workspaceId);
      const data = await basicSearch(db, embedder, {
        workspaceId,
        principals,
        query: request.query.q,
        mode: request.query.mode,
        limit: request.query.limit,
      });
      return { data, tookMs: Math.round(performance.now() - started) };
    },
  );
};
