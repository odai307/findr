import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  acceptInvite,
  auditRename,
  changeRole,
  createInvite,
  deleteWorkspace,
  listInvites,
  listMembers,
  previewInvite,
  removeMember,
  revokeInvite,
} from '../../workspaces/members.js';
import { createWorkspace, getWorkspaceForUser, renameWorkspace } from '../../workspaces/service.js';
import { userIdOf } from '../plugins/auth.js';

const role = z.enum(['owner', 'admin', 'member']);

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  role,
  createdAt: z.date(),
});

const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role,
  joinedAt: z.date(),
});

const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role,
  expiresAt: z.date(),
  createdAt: z.date(),
});

const nameBody = z.object({ name: z.string().trim().min(1).max(80) });
const idParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const workspaceRoutes: FastifyPluginAsync<{ db: Db; webOrigin: string }> = async (
  fastify,
  { db, webOrigin },
) => {
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
    async (request) => {
      const ws = await renameWorkspace(db, request.params.id, userIdOf(request), request.body.name);
      await auditRename(db, ws.id, userIdOf(request));
      return ws;
    },
  );

  app.delete('/:id', { schema: { params: idParams } }, async (request, reply) => {
    await deleteWorkspace(db, request.params.id, userIdOf(request));
    return reply.status(204).send();
  });

  // --- Members ---
  app.get(
    '/:id/members',
    { schema: { params: idParams, response: { 200: z.object({ data: z.array(memberSchema) }) } } },
    async (request) => ({ data: await listMembers(db, request.params.id, userIdOf(request)) }),
  );

  app.patch(
    '/:id/members/:userId',
    { schema: { params: memberParams, body: z.object({ role }) } },
    async (request, reply) => {
      const { id, userId } = request.params;
      await changeRole(db, id, userIdOf(request), userId, request.body.role);
      return reply.status(204).send();
    },
  );

  /** Removes a member. Members may remove themselves (leave the workspace). */
  app.delete(
    '/:id/members/:userId',
    { schema: { params: memberParams } },
    async (request, reply) => {
      const { id, userId } = request.params;
      await removeMember(db, id, userIdOf(request), userId);
      return reply.status(204).send();
    },
  );

  // --- Invites ---
  app.get(
    '/:id/invites',
    { schema: { params: idParams, response: { 200: z.object({ data: z.array(inviteSchema) }) } } },
    async (request) => ({ data: await listInvites(db, request.params.id, userIdOf(request)) }),
  );

  /** Returns a one-time invite link to share (Findr doesn't send email). */
  app.post(
    '/:id/invites',
    {
      schema: {
        params: idParams,
        body: z.object({ email: z.email(), role: role.default('member') }),
        response: { 201: z.object({ invite: inviteSchema, inviteUrl: z.string() }) },
      },
    },
    async (request, reply) => {
      const { invite, token } = await createInvite(
        db,
        request.params.id,
        userIdOf(request),
        request.body,
      );
      return reply.status(201).send({ invite, inviteUrl: `${webOrigin}/invite/${token}` });
    },
  );

  app.delete(
    '/:id/invites/:inviteId',
    { schema: { params: z.object({ id: z.uuid(), inviteId: z.uuid() }) } },
    async (request, reply) => {
      await revokeInvite(db, request.params.id, userIdOf(request), request.params.inviteId);
      return reply.status(204).send();
    },
  );
};

/** Routes under /v1/invites: preview (just the secret link) and accept (signed in). */
export const inviteRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tokenParams = z.object({ token: z.string().min(20).max(100) });

  app.get(
    '/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: tokenParams,
        response: {
          200: z.object({
            workspaceName: z.string(),
            role,
            email: z.string(),
            invitedBy: z.string().nullable(),
            expiresAt: z.date(),
          }),
        },
      },
    },
    async (request) => previewInvite(db, request.params.token),
  );

  app.post(
    '/:token/accept',
    {
      onRequest: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParams, response: { 200: workspaceSchema } },
    },
    async (request) => acceptInvite(db, request.params.token, userIdOf(request)),
  );
};
