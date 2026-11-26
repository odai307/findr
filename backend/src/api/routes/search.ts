import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { Embedder } from '../../ingestion/embedder.js';
import { hybridSearch } from '../../search/hybrid.js';
import { mergeFilters, parseDate, parseQuery } from '../../search/query-parser.js';
import { usageEvents } from '../../db/schema.js';
import { accessFor } from '../plugins/auth.js';
import { apiRateLimit } from '../plugins/rate-limits.js';

const isoDate = z
  .string()
  .refine((v) => parseDate(v) !== undefined, 'use YYYY-MM-DD')
  .transform((v) => parseDate(v)!);

export const filtersSchema = z.object({
  sources: z.array(z.string().min(1).max(40)).max(10).optional(),
  types: z.array(z.string().min(1).max(40)).max(10).optional(),
  from: z.string().min(1).max(100).optional(),
  in: z.string().min(1).max(200).optional(),
  after: isoDate.optional(),
  before: isoDate.optional(),
});

const resultSchema = z.object({
  documentId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  provider: z.string(),
  type: z.string(),
  author: z.string().nullable(),
  container: z.string().nullable(),
  updatedAt: z.date().nullable(),
  snippets: z.array(z.string()),
  matchedTerms: z.array(z.string()),
  score: z.number(),
});

const parsedFiltersOut = z.object({
  sources: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  from: z.string().optional(),
  in: z.string().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

/** Routes under /v1/workspaces/:workspaceId/search */
export const searchRoutes: FastifyPluginAsync<{ db: Db; embedder: Embedder }> = async (
  fastify,
  { db, embedder },
) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** Signed-in users, or API keys with the `search` scope (shared content only). */
  app.post(
    '/',
    {
      onRequest: app.authenticateUserOrKey('search'),
      config: { rateLimit: apiRateLimit({ perUser: 60, perKey: 120 }) },
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        body: z.object({
          query: z.string().trim().max(500).default(''),
          filters: filtersSchema.optional(),
          mode: z.enum(['hybrid', 'keyword', 'semantic']).default('hybrid'),
          limit: z.number().int().min(1).max(50).default(10),
        }),
        response: {
          200: z.object({
            data: z.array(resultSchema),
            degraded: z.boolean(),
            parsed: z.object({ text: z.string(), filters: parsedFiltersOut }),
            tookMs: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const started = performance.now();
      const { workspaceId } = request.params;
      const { userId, principals } = await accessFor(db, request, workspaceId);

      const typed = parseQuery(request.body.query);
      const filters = mergeFilters(typed.filters, request.body.filters);
      const { results, degraded } = await hybridSearch(db, embedder, {
        workspaceId,
        principals,
        text: typed.text,
        filters,
        mode: request.body.mode,
        limit: request.body.limit,
      });
      // Counted for the usage page (no query text is stored).
      await db
        .insert(usageEvents)
        .values({ workspaceId, userId, kind: 'search', model: embedder.model });
      return {
        data: results,
        degraded,
        parsed: { text: typed.text, filters },
        tookMs: Math.round(performance.now() - started),
      };
    },
  );
};
