import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectDemoAndWait,
  createTestApp,
  devLogin,
  parseSse,
  type TestContext,
} from './helpers.js';

describe('API keys', () => {
  let ctx: TestContext;
  let owner: string;
  let ws: string;

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const createKey = async (scopes: string[], token = owner) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${ws}/api-keys`,
      headers: bearer(token),
      payload: { name: 'CI bot', scopes },
    });
  const searchWithKey = (key: string, query: string, workspaceId = ws) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/search`,
      headers: { 'x-api-key': key },
      payload: { query },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = (await devLogin(ctx.app, 'ama@example.com')).accessToken;
    ({ workspaceId: ws } = await connectDemoAndWait(ctx.app, owner));
  }, 180_000);
  afterAll(() => ctx.close());

  it('shows the full key once and stores only a prefix for display', async () => {
    const res = await createKey(['search']);
    expect(res.statusCode).toBe(201);
    const { key, apiKey } = res.json();
    expect(key).toMatch(/^fdr_[A-Za-z0-9]{8}_[\w-]{20,}$/);
    expect(key.startsWith(`fdr_${apiKey.prefix}_`)).toBe(true);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${ws}/api-keys`,
      headers: bearer(owner),
    });
    expect(JSON.stringify(list.json())).not.toContain(key);
    expect(list.json().data[0]).toMatchObject({
      name: 'CI bot',
      scopes: ['search'],
      createdByName: 'ama',
    });
  });

  it('searches shared content only, never personal items', async () => {
    const { key } = (await createKey(['search'])).json();
    const shared = await searchWithKey(key, 'INC-2041 outage');
    expect(shared.statusCode).toBe(200);
    expect(shared.json().data.map((h: { title: string }) => h.title)).toContain(
      'INC-2041 database outage',
    );

    // The owner's private note is visible to her in the app, but not to a key.
    const asUser = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${ws}/search`,
      headers: bearer(owner),
      payload: { query: 'staff engineer promotion' },
    });
    expect(asUser.json().data.map((h: { title: string }) => h.title)).toContain(
      'My notes: 1:1 with Kofi',
    );
    const asKey = await searchWithKey(key, 'staff engineer promotion');
    expect(asKey.json().data.map((h: { title: string }) => h.title)).not.toContain(
      'My notes: 1:1 with Kofi',
    );
  });

  it('checks scopes', async () => {
    const { key } = (await createKey(['search'])).json();
    const ask = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${ws}/ask`,
      headers: { 'x-api-key': key },
      payload: { question: 'When is the Alpha delivery?' },
    });
    expect(ask.statusCode).toBe(403);

    const { key: askKey } = (await createKey(['ask'])).json();
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${ws}/ask`,
      headers: { 'x-api-key': askKey },
      payload: { question: 'When is the Alpha delivery?' },
    });
    expect(ok.statusCode).toBe(200);
    expect(parseSse(ok.body).map((e) => e.event)).toContain('done');
  });

  it('rejects unknown, malformed, revoked and other-workspace keys', async () => {
    expect((await searchWithKey('fdr_abcdefgh_not-a-real-key-at-all-xx', 'x')).statusCode).toBe(
      401,
    );
    expect((await searchWithKey('nope', 'x')).statusCode).toBe(401);

    const created = (await createKey(['search'])).json();
    const other = (
      await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(owner) })
    ).json();
    const otherWs = (
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/workspaces',
        headers: bearer(owner),
        payload: { name: 'Other' },
      })
    ).json().id;
    expect(other.workspaces.length).toBeGreaterThan(0);
    expect((await searchWithKey(created.key, 'x', otherWs)).statusCode).toBe(404);

    const revoke = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/${ws}/api-keys/${created.apiKey.id}`,
      headers: bearer(owner),
    });
    expect(revoke.statusCode).toBe(204);
    expect((await searchWithKey(created.key, 'x')).statusCode).toBe(401);
  });

  it("can't be used for account endpoints like conversations", async () => {
    const { key } = (await createKey(['search', 'ask'])).json();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${ws}/conversations`,
      headers: { 'x-api-key': key },
    });
    expect(res.statusCode).toBe(401);
  });

  it('only owners and admins manage keys', async () => {
    const member = (await devLogin(ctx.app, 'kofi@example.com')).accessToken;
    expect((await createKey(['search'], member)).statusCode).toBe(404); // not even a member here
  });
});
