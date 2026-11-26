import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '../../auth/api-keys.js';
import type { Db } from '../../db/client.js';
import { userIdOf } from '../plugins/auth.js';

const scope = z.enum(['search', 'ask']);
const keySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(scope),
  createdByName: z.string().nullable(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
});
const wsParams = z.object({ workspaceId: z.uuid() });

/** Routes under /v1/workspaces/:workspaceId/api-keys (owners and admins). */
export const apiKeyRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    { schema: { params: wsParams, response: { 200: z.object({ data: z.array(keySchema) }) } } },
    async (request) => ({
      data: await listApiKeys(db, request.params.workspaceId, userIdOf(request)),
    }),
  );

  /** The full key is returned only here, once. */
  app.post(
    '/',
    {
      schema: {
        params: wsParams,
        body: z.object({
          name: z.string().trim().min(1).max(80),
          scopes: z.array(scope).min(1).default(['search']),
        }),
        response: { 201: z.object({ key: z.string(), apiKey: keySchema }) },
      },
    },
    async (request, reply) => {
      const created = await createApiKey(
        db,
        request.params.workspaceId,
        userIdOf(request),
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/:keyId',
    { schema: { params: z.object({ workspaceId: z.uuid(), keyId: z.uuid() }) } },
    async (request, reply) => {
      await revokeApiKey(db, request.params.workspaceId, userIdOf(request), request.params.keyId);
      return reply.status(204).send();
    },
  );
};
