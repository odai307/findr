import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDemoAndWait, createTestApp, devLogin, type TestContext } from './helpers.js';

describe('connection controls, usage, admin and account', () => {
  let ctx: TestContext;
  let ama: string;
  let kofi: string;
  let ws: string;
  let connectionId: string;

  const as = (t: string) => ({ authorization: `Bearer ${t}` });
  const call = (
    t: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: as(t), ...(payload && { payload }) });

  beforeAll(async () => {
    ctx = await createTestApp();
    ama = (await devLogin(ctx.app, 'ama@example.com')).accessToken;
    kofi = (await devLogin(ctx.app, 'kofi@example.com')).accessToken;
    ({ workspaceId: ws, connectionId } = await connectDemoAndWait(ctx.app, ama));
    const invite = await call(ama, 'POST', `/v1/workspaces/${ws}/invites`, {
      email: 'kofi@example.com',
    });
    const token = (invite.json().inviteUrl as string).split('/invite/')[1];
    await call(kofi, 'POST', `/v1/invites/${token}/accept`);
  }, 180_000);
  afterAll(() => ctx.close());

  const conn = `/v1/workspaces/${'WS'}/connections`;
  const connUrl = (suffix = '') => `${conn.replace('WS', ws)}/${connectionId}${suffix}`;

  it('pauses and resumes a connection; paused connections refuse to sync', async () => {
    const paused = await call(ama, 'PATCH', connUrl(), { paused: true });
    expect(paused.json().status).toBe('paused');
    expect((await call(ama, 'POST', connUrl('/sync'), { kind: 'incremental' })).statusCode).toBe(
      409,
    );
    expect((await call(ama, 'PATCH', connUrl(), { paused: false })).json().status).toBe('active');
  });

  it('lists sync history for a connection', async () => {
    const runs = (await call(kofi, 'GET', connUrl('/sync-runs'))).json().data;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]).toMatchObject({ kind: 'full', status: 'succeeded' });
  });

  it('a personal connection is hidden from other members', async () => {
    expect((await call(kofi, 'PATCH', connUrl(), { visibility: 'personal' })).statusCode).toBe(403);
    await call(ama, 'PATCH', connUrl(), { visibility: 'personal' });
    expect((await call(kofi, 'GET', connUrl())).statusCode).toBe(404);
    await call(ama, 'PATCH', connUrl(), { visibility: 'workspace' });
    expect((await call(kofi, 'GET', connUrl())).statusCode).toBe(200);
  });

  it('reports usage per day to owners and admins only', async () => {
    for (const q of ['Project Alpha', 'INC-2041']) {
      await call(kofi, 'POST', `/v1/workspaces/${ws}/search`, { query: q });
    }
    await call(kofi, 'POST', `/v1/workspaces/${ws}/ask`, {
      question: 'When is the Alpha delivery?',
    });

    const usage = await call(ama, 'GET', `/v1/workspaces/${ws}/usage?days=7`);
    expect(usage.statusCode).toBe(200);
    const body = usage.json();
    expect(body.daily).toHaveLength(7);
    expect(body.daily.at(-1).day).toBe(new Date().toISOString().slice(0, 10));
    expect(body.totals.searches).toBeGreaterThanOrEqual(2);
    expect(body.totals.asks).toBeGreaterThanOrEqual(1);
    expect(body.models.map((m: { model: string }) => m.model)).toContain('fake-chat');

    expect((await call(kofi, 'GET', `/v1/workspaces/${ws}/usage`)).statusCode).toBe(403);
  });

  it('shows workspace sync runs to admins', async () => {
    const runs = await call(ama, 'GET', `/v1/workspaces/${ws}/sync-runs`);
    expect(runs.json().data[0]).toMatchObject({
      provider: 'demo',
      connectionName: 'Tamarind Labs (demo data)',
    });
    expect(
      (await call(ama, 'GET', `/v1/workspaces/${ws}/sync-runs?failed=true`)).json().data,
    ).toEqual([]);
    expect((await call(kofi, 'GET', `/v1/workspaces/${ws}/sync-runs`)).statusCode).toBe(403);
  });

  it('pages through the audit log, newest first, admins only', async () => {
    const first = (await call(ama, 'GET', `/v1/workspaces/${ws}/audit-log?limit=2`)).json();
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBe(first.data[1].id);
    const next = (
      await call(ama, 'GET', `/v1/workspaces/${ws}/audit-log?limit=50&before=${first.nextCursor}`)
    ).json();
    const all = [...first.data, ...next.data].map((e: { action: string }) => e.action);
    expect(all).toEqual(
      expect.arrayContaining([
        'connection.created',
        'connection.updated',
        'invite.created',
        'invite.accepted',
      ]),
    );
    const filtered = (
      await call(ama, 'GET', `/v1/workspaces/${ws}/audit-log?action=invite.`)
    ).json().data;
    expect(filtered.every((e: { action: string }) => e.action.startsWith('invite.'))).toBe(true);
    expect((await call(kofi, 'GET', `/v1/workspaces/${ws}/audit-log`)).statusCode).toBe(403);
  });

  it('renames the account', async () => {
    expect((await call(kofi, 'PATCH', '/v1/me', { name: 'Kofi Boateng' })).statusCode).toBe(204);
    expect((await call(kofi, 'GET', '/v1/me')).json().user.name).toBe('Kofi Boateng');
  });

  it('signs out of every device', async () => {
    const a = await devLogin(ctx.app, 'esi@example.com');
    const b = await devLogin(ctx.app, 'esi@example.com');
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: as(a.accessToken),
    });
    expect(out.statusCode).toBe(204);
    for (const rt of [a.refreshToken, b.refreshToken]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        cookies: { findr_rt: rt },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
