import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allDemoDocs } from '../src/connectors/demo/data.js';
import { createTestApp, devLogin, type TestContext } from './helpers.js';

describe('demo connection + search API', () => {
  let ctx: TestContext;
  let token: string;
  let workspaceId: string;
  let connectionId: string;

  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await createTestApp();
    token = (await devLogin(ctx.app, 'ama@example.com')).accessToken;
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: as(token) });
    workspaceId = me.json().workspaces[0].id;

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/connections/demo`,
      headers: as(token),
    });
    expect(created.statusCode).toBe(201);
    connectionId = created.json().id;

    // The in-process scheduler syncs in the background; wait for it to finish.
    for (let i = 0; i < 600; i++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/workspaces/${workspaceId}/connections/${connectionId}`,
        headers: as(token),
      });
      const c = res.json();
      if (c.lastRun?.status === 'succeeded' && c.status === 'active') break;
      if (c.lastRun?.status === 'failed') throw new Error(`sync failed: ${c.lastRun.error}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 180_000);
  afterAll(() => ctx.close());

  const search = (q: string, mode = 'keyword', t = token, ws = workspaceId) =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${ws}/search?q=${encodeURIComponent(q)}&mode=${mode}`,
      headers: as(t),
    });

  it('lists the connection with document counts and the last run', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/connections`,
      headers: as(token),
    });
    const [conn] = res.json().data;
    expect(conn).toMatchObject({ provider: 'demo', status: 'active', isOwner: true });
    expect(conn.documentCount).toBe(allDemoDocs().length);
    expect(conn.chunkCount).toBeGreaterThanOrEqual(allDemoDocs().length);
    expect(conn.lastRun).toMatchObject({ status: 'succeeded', kind: 'full' });
  });

  it('refuses to connect the demo data twice', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/connections/demo`,
      headers: as(token),
    });
    expect(res.statusCode).toBe(409);
  });

  it('finds exact facts by keyword', async () => {
    const res = await search('INC-2041 outage');
    expect(res.statusCode).toBe(200);
    const titles = res.json().data.map((h: { title: string }) => h.title);
    expect(titles).toContain('INC-2041 database outage');
  });

  it('finds documents by semantic search', async () => {
    const res = await search('route planning module delivery timeline for Harbor', 'semantic');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it("shows the owner's private items only to the owner", async () => {
    const res = await search('staff engineer promotion');
    expect(res.json().data.map((h: { title: string }) => h.title)).toContain(
      'My notes: 1:1 with Kofi',
    );
  });

  it('never returns documents restricted to a group the user is not in', async () => {
    for (const q of ['Series A runway', 'compensation review increase pool']) {
      for (const mode of ['keyword', 'semantic']) {
        const titles = (await search(q, mode)).json().data.map((h: { title: string }) => h.title);
        expect(titles).not.toContain('Board update – February 2026');
        expect(titles).not.toContain('Compensation review');
      }
    }
  });

  it("keeps other users out of the workspace's connections and search", async () => {
    const other = (await devLogin(ctx.app, 'stranger@example.com')).accessToken;
    expect((await search('Project Alpha', 'keyword', other)).statusCode).toBe(404);
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/connections`,
      headers: as(other),
    });
    expect(list.statusCode).toBe(404);
  });

  it('disconnecting removes all of its documents', async () => {
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/${workspaceId}/connections/${connectionId}`,
      headers: as(token),
    });
    expect(del.statusCode).toBe(204);
    expect((await search('Project Alpha')).json().data).toHaveLength(0);
  });
});
