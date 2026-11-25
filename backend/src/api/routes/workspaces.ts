import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { createWorkspace, getWorkspaceForUser, renameWorkspace } from '../../workspaces/service.js';
import { userIdOf } from '../plugins/auth.js';

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.date(),
});

const nameBody = z.object({ name: z.string().trim().min(1).max(80) });
const idParams = z.object({ id: z.uuid() });

export const workspaceRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/',
    { schema: { body: nameBody, response: { 201: workspaceSchema } } },
    async (request, reply) => {
      const ws = await createWorkspace(db, userIdOf(request), request.body.name);
      return reply.status(201).send(ws);
    },
  );

  app.get(
    '/:id',
    { schema: { params: idParams, response: { 200: workspaceSchema } } },
    async (request) => getWorkspaceForUser(db, request.params.id, userIdOf(request)),
  );

  app.patch(
    '/:id',
    { schema: { params: idParams, body: nameBody, response: { 200: workspaceSchema } } },
    async (request) => renameWorkspace(db, request.params.id, userIdOf(request), request.body.name),
  );
};
