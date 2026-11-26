import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assertCanSync,
  createDemoConnection,
  deleteConnection,
  getConnection,
  listConnections,
  listSyncRuns,
  resetSyncState,
  updateConnection,
} from '../../connections/service.js';
import type { Db } from '../../db/client.js';
import type { SyncScheduler } from '../../ingestion/scheduler.js';
import { userIdOf } from '../plugins/auth.js';
import { syncRunSchema } from './admin.js';

const runSchema = z
  .object({
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
  })
  .nullable();

export const connectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  visibility: z.enum(['personal', 'workspace']),
  status: z.enum(['active', 'syncing', 'paused', 'error', 'revoked']),
  isOwner: z.boolean(),
  documentCount: z.number(),
  chunkCount: z.number(),
  lastFullSyncAt: z.date().nullable(),
  lastIncrementalSyncAt: z.date().nullable(),
  errorMessage: z.string().nullable(),
  lastRun: runSchema,
});

const wsParams = z.object({ workspaceId: z.uuid() });
const connParams = z.object({ workspaceId: z.uuid(), connectionId: z.uuid() });

/** Routes under /v1/workspaces/:workspaceId/connections */
export const connectionRoutes: FastifyPluginAsync<{ db: Db; scheduler: SyncScheduler }> = async (
  fastify,
  { db, scheduler },
) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        params: wsParams,
        response: { 200: z.object({ data: z.array(connectionSchema) }) },
      },
    },
    async (request) => ({
      data: await listConnections(db, request.params.workspaceId, userIdOf(request)),
    }),
  );

  /** Connects the demo dataset and starts its first sync. */
  app.post(
    '/demo',
    { schema: { params: wsParams, response: { 201: connectionSchema } } },
    async (request, reply) => {
      const conn = await createDemoConnection(db, request.params.workspaceId, userIdOf(request));
      await scheduler.enqueue(conn.id, 'full');
      return reply.status(201).send(conn);
    },
  );

  app.get(
    '/:connectionId',
    { schema: { params: connParams, response: { 200: connectionSchema } } },
    async (request) =>
      getConnection(db, request.params.workspaceId, request.params.connectionId, userIdOf(request)),
  );

  /** Triggers a sync. `full` re-lists everything; unchanged documents are still not re-embedded. */
  app.post(
    '/:connectionId/sync',
    {
      schema: {
        params: connParams,
        body: z.object({ kind: z.enum(['incremental', 'full']).default('incremental') }).default({
          kind: 'incremental',
        }),
        response: { 202: z.object({ queued: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const { workspaceId, connectionId } = request.params;
      const conn = await assertCanSync(db, workspaceId, connectionId, userIdOf(request));
      if (request.body.kind === 'full' && conn.status !== 'syncing') {
        await resetSyncState(db, connectionId);
      }
      await scheduler.enqueue(connectionId, request.body.kind);
      return reply.status(202).send({ queued: true });
    },
  );

  /** Pause/resume syncing, or switch between personal and shared with the workspace. */
  app.patch(
    '/:connectionId',
    {
      schema: {
        params: connParams,
        body: z
          .object({
            paused: z.boolean().optional(),
            visibility: z.enum(['personal', 'workspace']).optional(),
          })
          .refine((b) => b.paused !== undefined || b.visibility !== undefined, 'nothing to change'),
        response: { 200: connectionSchema },
      },
    },
    async (request) => {
      const { workspaceId, connectionId } = request.params;
      return updateConnection(db, workspaceId, connectionId, userIdOf(request), {
        ...(request.body.paused !== undefined && { paused: request.body.paused }),
        ...(request.body.visibility && { visibility: request.body.visibility }),
      });
    },
  );

  app.get(
    '/:connectionId/sync-runs',
    {
      schema: { params: connParams, response: { 200: z.object({ data: z.array(syncRunSchema) }) } },
    },
    async (request) => {
      const { workspaceId, connectionId } = request.params;
      return { data: await listSyncRuns(db, workspaceId, connectionId, userIdOf(request)) };
    },
  );

  app.delete('/:connectionId', { schema: { params: connParams } }, async (request, reply) => {
    const { workspaceId, connectionId } = request.params;
    await deleteConnection(db, workspaceId, connectionId, userIdOf(request));
    return reply.status(204).send();
  });
};
