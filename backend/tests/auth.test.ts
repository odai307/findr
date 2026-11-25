import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, devLogin, refreshCookieFrom, type TestContext } from './helpers.js';

describe('auth', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('dev-login creates the user with a personal workspace', async () => {
    const { accessToken, refreshToken } = await devLogin(ctx.app, 'Kofi@Example.com');
    expect(refreshToken).toBeTruthy();

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe('kofi@example.com');
    expect(body.user.emailVerified).toBe(false); // dev users are never treated as verified
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]).toMatchObject({ name: "kofi's workspace", role: 'owner' });
  });

  it('sets the refresh cookie as httpOnly, SameSite=Strict, scoped to /v1/auth', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'cookie@example.com' },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/v1\/auth/);
  });

  it('rejects requests without a valid access token', async () => {
    const none = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('UNAUTHENTICATED');
    expect(none.json().error.requestId).toMatch(/^req_/);

    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('refresh rotates the cookie and returns a working access token', async () => {
    const { refreshToken } = await devLogin(ctx.app, 'rotate@example.com');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { findr_rt: refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const next = refreshCookieFrom(res.headers['set-cookie']);
    expect(next).toBeTruthy();
    expect(next).not.toBe(refreshToken);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${res.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('rejects refresh from another origin (CSRF check)', async () => {
    const { refreshToken } = await devLogin(ctx.app, 'csrf@example.com');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { findr_rt: refreshToken },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('logout revokes the session', async () => {
    const { refreshToken } = await devLogin(ctx.app, 'logout@example.com');
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { findr_rt: refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { findr_rt: refreshToken },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('reports which sign-in methods are available', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(res.json()).toEqual({ google: false, devLogin: true });
  });

  it('validates request bodies with a standard error shape', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('health endpoints report the database is up', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
    expect((await ctx.app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({
      ok: true,
      database: 'up',
    });
  });
});

describe('auth with dev login disabled', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ DEV_LOGIN_ENABLED: 'false' });
  });
  afterAll(() => ctx.close());

  it('hides the dev-login route', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/dev-login',
      payload: { email: 'x@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 501 for Google sign-in when it is not configured', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/auth/google' });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });
});
