import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceMembers } from '../src/db/schema.js';
import { createTestApp, devLogin, type TestContext } from './helpers.js';

describe('workspaces', () => {
  let ctx: TestContext;
  let ama: string;
  let kofi: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    ama = (await devLogin(ctx.app, 'ama@example.com')).accessToken;
    kofi = (await devLogin(ctx.app, 'kofi@example.com')).accessToken;
  });
  afterAll(() => ctx.close());

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  async function create(token: string, name: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: as(token),
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; slug: string; role: string }>();
  }

  it('creates a workspace with the creator as owner', async () => {
    const ws = await create(ama, 'Project Alpha');
    expect(ws.role).toBe('owner');
    expect(ws.slug).toMatch(/^project-alpha-[a-z0-9]+$/);

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: as(ama) });
    expect(me.json().workspaces.map((w: { name: string }) => w.name)).toContain('Project Alpha');
  });

  it("hides other people's workspaces (404, not 403)", async () => {
    const ws = await create(ama, 'Private');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${ws.id}`,
      headers: as(kofi),
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets owners rename but not plain members', async () => {
    const ws = await create(ama, 'Team');
    const kofiId = (
      await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: as(kofi) })
    ).json().user.id;
    await ctx.database.db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: kofiId, role: 'member' });

    const byMember = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/workspaces/${ws.id}`,
      headers: as(kofi),
      payload: { name: 'Hijacked' },
    });
    expect(byMember.statusCode).toBe(403);

    const byOwner = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/workspaces/${ws.id}`,
      headers: as(ama),
      payload: { name: 'Team Alpha' },
    });
    expect(byOwner.statusCode).toBe(200);
    expect(byOwner.json().name).toBe('Team Alpha');
  });

  it('rejects empty names and malformed IDs', async () => {
    const empty = await ctx.app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: as(ama),
      payload: { name: '  ' },
    });
    expect(empty.statusCode).toBe(400);
    const badId = await ctx.app.inject({
      method: 'GET',
      url: '/v1/workspaces/not-a-uuid',
      headers: as(ama),
    });
    expect(badId.statusCode).toBe(400);
  });
});
