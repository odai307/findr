import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listWorkspaceSyncRuns } from '../../connections/service.js';
import type { Db } from '../../db/client.js';
import { listAudit } from '../../shared/audit.js';
import { requireAdmin } from '../../workspaces/members.js';
import { getUsage } from '../../workspaces/usage.js';
import { userIdOf } from '../plugins/auth.js';

const wsParams = z.object({ workspaceId: z.uuid() });

export const syncRunSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  kind: z.string(),
  status: z.string(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  itemsSeen: z.number(),
  itemsUpserted: z.number(),
  itemsUnchanged: z.number(),
  itemsDeleted: z.number(),
  chunksEmbedded: z.number(),
  chunksReused: z.number(),
  error: z.string().nullable(),
});

/** Routes under /v1/workspaces/:workspaceId for owners and admins: usage, sync runs, audit log. */
export const adminRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/usage',
    {
      schema: {
        params: wsParams,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
        response: {
          200: z.object({
            days: z.number(),
            daily: z.array(
              z.object({
                day: z.string(),
                searches: z.number(),
                asks: z.number(),
                tokens: z.number(),
              }),
            ),
            totals: z.object({ searches: z.number(), asks: z.number(), tokens: z.number() }),
            models: z.array(
              z.object({
                model: z.string(),
                kind: z.string(),
                calls: z.number(),
                promptTokens: z.number(),
                completionTokens: z.number(),
              }),
            ),
            feedback: z.object({ up: z.number(), down: z.number() }),
          }),
        },
      },
    },
    async (request) =>
      getUsage(db, request.params.workspaceId, userIdOf(request), request.query.days),
  );

  app.get(
    '/sync-runs',
    {
      schema: {
        params: wsParams,
        querystring: z.object({ failed: z.enum(['true', 'false']).default('false') }),
        response: {
          200: z.object({
            data: z.array(
              syncRunSchema.extend({ connectionName: z.string(), provider: z.string() }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      data: await listWorkspaceSyncRuns(db, request.params.workspaceId, userIdOf(request), {
        failedOnly: request.query.failed === 'true',
      }),
    }),
  );

  app.get(
    '/audit-log',
    {
      schema: {
        params: wsParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: z.uuid().optional(),
          action: z.string().max(40).optional(),
        }),
        response: {
          200: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                action: z.string(),
                targetType: z.string().nullable(),
                targetId: z.string().nullable(),
                ip: z.string().nullable(),
                createdAt: z.date(),
                actorName: z.string().nullable(),
                actorEmail: z.string().nullable(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      await requireAdmin(db, request.params.workspaceId, userIdOf(request));
      return listAudit(db, request.params.workspaceId, {
        limit: request.query.limit,
        ...(request.query.before && { before: request.query.before }),
        ...(request.query.action && { actionPrefix: request.query.action }),
      });
    },
  );
};
