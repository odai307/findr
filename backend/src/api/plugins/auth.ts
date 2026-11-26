import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AccessTokenService } from '../../auth/access-tokens.js';
import { API_KEY_HEADER, verifyApiKey, type VerifiedKey } from '../../auth/api-keys.js';
import { principalsFor } from '../../auth/principals.js';
import type { Db } from '../../db/client.js';
import type { ApiScope } from '../../db/schema.js';
import { AppError } from '../../shared/errors.js';
import { getWorkspaceForUser } from '../../workspaces/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by `app.authenticate` (a signed-in user) or `app.authenticateUserOrKey` (a user or an
     * API key). For an API key, `userId` is the key's creator and `apiKey` is set.
     */
    auth: { userId: string; apiKey?: VerifiedKey } | null;
  }
  interface FastifyInstance {
    /** Route hook: requires `Authorization: Bearer <access token>`. */
    authenticate(request: FastifyRequest): Promise<void>;
    /** Route hook: a signed-in user, or an `X-API-Key` with `scope` for this workspace. */
    authenticateUserOrKey(scope: ApiScope): (request: FastifyRequest) => Promise<void>;
  }
}

/** The authenticated user's ID. Only call inside routes that use an authenticate hook. */
export function userIdOf(request: FastifyRequest): string {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
  return request.auth.userId;
}

/**
 * Checks access to a workspace and returns the principals the request may see. A user gets
 * their own principals; an API key gets only `workspace:<id>` (shared content, never personal).
 */
export async function accessFor(db: Db, request: FastifyRequest, workspaceId: string) {
  const userId = userIdOf(request);
  const key = request.auth?.apiKey;
  if (key && key.workspaceId !== workspaceId)
    throw new AppError('NOT_FOUND', 'Workspace not found.');
  // A key stops working if the person who created it is no longer a member.
  await getWorkspaceForUser(db, workspaceId, userId);
  const principals = key
    ? [`workspace:${workspaceId}`]
    : await principalsFor(db, userId, workspaceId);
  return { userId, principals, viaApiKey: Boolean(key) };
}

const plugin: FastifyPluginAsync<{ accessTokens: AccessTokenService; db: Db }> = async (
  app,
  { accessTokens, db },
) => {
  app.decorateRequest('auth', null);

  async function authenticate(request: FastifyRequest) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    }
    request.auth = await accessTokens.verify(header.slice('Bearer '.length));
  }

  app.decorate('authenticate', authenticate);
  app.decorate('authenticateUserOrKey', (scope: ApiScope) => async (request: FastifyRequest) => {
    const key = request.headers[API_KEY_HEADER];
    if (typeof key === 'string' && key) {
      const verified = await verifyApiKey(db, key, scope);
      request.auth = { userId: verified.createdBy, apiKey: verified };
      return;
    }
    await authenticate(request);
  });
};

// fastify-plugin makes the decorators visible to routes registered outside this plugin.
export const authPlugin = fp(plugin, { name: 'auth' });
