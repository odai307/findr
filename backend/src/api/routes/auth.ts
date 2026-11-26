import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AccessTokenService } from '../../auth/access-tokens.js';
import type { GoogleAuth } from '../../auth/google.js';
import type { IssuedRefreshToken, RefreshTokenService } from '../../auth/refresh-tokens.js';
import { upsertDevUser, upsertGoogleUser } from '../../auth/users.js';
import { recordAudit } from '../../shared/audit.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../shared/config.js';
import { constantTimeEqual } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';

export const REFRESH_COOKIE = 'findr_rt';
const OAUTH_COOKIE = 'findr_oauth';

interface Options {
  config: Config;
  db: Db;
  accessTokens: AccessTokenService;
  refreshTokens: RefreshTokenService;
  google: GoogleAuth | null;
}

const tokenResponse = z.object({ accessToken: z.string(), expiresIn: z.number() });

export const authRoutes: FastifyPluginAsync<Options> = async (fastify, opts) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { config, db, accessTokens, refreshTokens, google } = opts;
  const secure = config.API_PUBLIC_URL.startsWith('https://');
  const authRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  function setRefreshCookie(reply: FastifyReply, issued: IssuedRefreshToken) {
    reply.setCookie(REFRESH_COOKIE, issued.token, {
      httpOnly: true,
      secure,
      // Strict: the browser never sends it on requests started by another site (CSRF protection).
      sameSite: 'strict',
      // Only sent to /v1/auth/*, not to every API call.
      path: '/v1/auth',
      expires: issued.expiresAt,
    });
  }

  function clearRefreshCookie(reply: FastifyReply) {
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }

  /** Extra CSRF check for cookie-authenticated routes: a browser Origin header must be our web app. */
  function assertSameOrigin(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== config.WEB_ORIGIN &&
      origin !== new URL(config.API_PUBLIC_URL).origin
    ) {
      throw new AppError('FORBIDDEN', 'Cross-origin request rejected.');
    }
  }

  const client = (request: FastifyRequest) => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });

  /** Tells the login page which sign-in buttons to show. */
  app.get(
    '/providers',
    { schema: { response: { 200: z.object({ google: z.boolean(), devLogin: z.boolean() }) } } },
    async () => ({ google: google !== null, devLogin: config.DEV_LOGIN_ENABLED }),
  );

  /** Step 1 of Google sign-in: redirect the browser to Google's consent screen. */
  app.get('/google', { config: authRateLimit }, async (_request, reply) => {
    if (!google) throw new AppError('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured.');
    const { url, state, codeVerifier } = google.createAuthorization();
    // Lax, not Strict: the callback is a top-level redirect from google.com, and a Strict
    // cookie would not be sent with it.
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier }), {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/v1/auth/google',
      maxAge: 600,
    });
    return reply.redirect(url);
  });

  /** Step 2: Google redirects back here with ?code&state. */
  app.get(
    '/google/callback',
    {
      config: authRateLimit,
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const fail = (reason: string) => {
        request.log.warn({ reason }, 'Google sign-in failed');
        return reply.redirect(`${config.WEB_ORIGIN}/login?error=google_failed`);
      };
      if (!google) return fail('not_configured');

      const raw = request.cookies[OAUTH_COOKIE];
      reply.clearCookie(OAUTH_COOKIE, { path: '/v1/auth/google' });
      const { code, state, error } = request.query;
      if (error || !code || !state || !raw) return fail(error ?? 'missing_params');

      let stored: { state: string; codeVerifier: string };
      try {
        stored = JSON.parse(raw);
      } catch {
        return fail('bad_cookie');
      }
      if (!constantTimeEqual(stored.state, state)) return fail('state_mismatch');

      try {
        const profile = await google.exchange(code, stored.codeVerifier);
        const user = await upsertGoogleUser(db, profile);
        const issued = await refreshTokens.issue(user.id, client(request).userAgent);
        await recordAudit(db, {
          action: 'auth.login.google',
          actorUserId: user.id,
          ...client(request),
        });
        setRefreshCookie(reply, issued);
        return reply.redirect(`${config.WEB_ORIGIN}/`);
      } catch (err) {
        return fail(err instanceof AppError ? err.message : 'exchange_failed');
      }
    },
  );

  /** Local development only: sign in with just an email address. */
  app.post(
    '/dev-login',
    {
      config: authRateLimit,
      schema: {
        body: z.object({ email: z.email(), name: z.string().min(1).max(100).optional() }),
        response: { 200: tokenResponse },
      },
    },
    async (request, reply) => {
      if (!config.DEV_LOGIN_ENABLED) throw new AppError('NOT_FOUND', 'Not found.');
      assertSameOrigin(request);
      const user = await upsertDevUser(db, request.body.email, request.body.name);
      const issued = await refreshTokens.issue(user.id, client(request).userAgent);
      await recordAudit(db, { action: 'auth.login.dev', actorUserId: user.id, ...client(request) });
      setRefreshCookie(reply, issued);
      return accessTokens.sign(user.id);
    },
  );

  /** Exchanges the refresh cookie for a new access token, rotating the cookie. */
  app.post(
    '/refresh',
    { config: authRateLimit, schema: { response: { 200: tokenResponse } } },
    async (request, reply) => {
      assertSameOrigin(request);
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw new AppError('REFRESH_TOKEN_INVALID', 'Please sign in again.');
      try {
        const issued = await refreshTokens.rotate(token, client(request).userAgent);
        setRefreshCookie(reply, issued);
        return accessTokens.sign(issued.userId);
      } catch (err) {
        clearRefreshCookie(reply);
        throw err;
      }
    },
  );

  app.post('/logout', { config: authRateLimit }, async (request, reply) => {
    assertSameOrigin(request);
    const token = request.cookies[REFRESH_COOKIE];
    if (token) await refreshTokens.revokeFamilyOf(token);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  /** Signs the user out on every device (all refresh tokens). Access tokens expire within 15 min. */
  app.post(
    '/logout-all',
    { onRequest: app.authenticate, config: authRateLimit },
    async (request, reply) => {
      assertSameOrigin(request);
      const userId = request.auth!.userId;
      await refreshTokens.revokeAllForUser(userId);
      await recordAudit(db, { action: 'auth.logout_all', actorUserId: userId, ...client(request) });
      clearRefreshCookie(reply);
      return reply.status(204).send();
    },
  );
};
