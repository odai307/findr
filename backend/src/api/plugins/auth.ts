import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AccessTokenService } from '../../auth/access-tokens.js';
import { AppError } from '../../shared/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `app.authenticate`. Null on public routes. */
    auth: { userId: string } | null;
  }
  interface FastifyInstance {
    /** Route hook: requires `Authorization: Bearer <access token>`. */
    authenticate(request: FastifyRequest): Promise<void>;
  }
}

/** The authenticated user's ID. Only call inside routes that use `onRequest: app.authenticate`. */
export function userIdOf(request: FastifyRequest): string {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
  return request.auth.userId;
}

const plugin: FastifyPluginAsync<{ accessTokens: AccessTokenService }> = async (
  app,
  { accessTokens },
) => {
  app.decorateRequest('auth', null);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    }
    request.auth = await accessTokens.verify(header.slice('Bearer '.length));
  });
};

// fastify-plugin makes the decorators visible to routes registered outside this plugin.
export const authPlugin = fp(plugin, { name: 'auth' });
