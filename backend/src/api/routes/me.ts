import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { AppError } from '../../shared/errors.js';
import { listWorkspacesForUser } from '../../workspaces/service.js';
import { userIdOf } from '../plugins/auth.js';
import { workspaceSchema } from './workspaces.js';

export const meRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        response: {
          200: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
              avatarUrl: z.string().nullable(),
              emailVerified: z.boolean(),
            }),
            workspaces: z.array(workspaceSchema),
          }),
        },
      },
    },
    async (request) => {
      const userId = userIdOf(request);
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          emailVerified: user.emailVerifiedAt !== null,
        },
        workspaces: await listWorkspacesForUser(db, userId),
      };
    },
  );
};
