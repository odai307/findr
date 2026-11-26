import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, connections, invites } from '../src/db/schema.js';
import { createTestApp, devLogin, type TestContext } from './helpers.js';

describe('members, roles and invites', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let ws: string;

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const call = (
    who: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: as(who), ...(payload && { payload }) });

  async function invite(who: string, email: string, role = 'member') {
    const res = await call(who, 'POST', `/v1/workspaces/${ws}/invites`, { email, role });
    return {
      res,
      token: res.statusCode === 201 ? (res.json().inviteUrl as string).split('/invite/')[1]! : '',
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const name of ['ama', 'kofi', 'esi']) {
      tokens[name] = (await devLogin(ctx.app, `${name}@example.com`)).accessToken;
      ids[name] = (await call(name, 'GET', '/v1/me')).json().user.id;
    }
    ws = (await call('ama', 'POST', '/v1/workspaces', { name: 'Tamarind Team' })).json().id;
  });
  afterAll(() => ctx.close());

  it('lists the creator as owner', async () => {
    const res = await call('ama', 'GET', `/v1/workspaces/${ws}/members`);
    expect(res.json().data).toMatchObject([{ email: 'ama@example.com', role: 'owner' }]);
  });

  it('invites by link: preview, accept once, then the link is dead', async () => {
    const { res, token } = await invite('ama', 'Kofi@Example.com');
    expect(res.statusCode).toBe(201);
    expect(res.json().inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/[\w-]{20,}$/);

    const preview = await ctx.app.inject({ method: 'GET', url: `/v1/invites/${token}` });
    expect(preview.json()).toMatchObject({
      workspaceName: 'Tamarind Team',
      role: 'member',
      email: 'kofi@example.com',
    });

    expect((await call('esi', 'POST', `/v1/invites/${token}/accept`)).statusCode).toBe(403);
    const accepted = await call('kofi', 'POST', `/v1/invites/${token}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: ws, role: 'member' });
    expect((await call('kofi', 'POST', `/v1/invites/${token}/accept`)).statusCode).toBe(404);

    const members = (await call('ama', 'GET', `/v1/workspaces/${ws}/members`)).json().data;
    expect(members.map((m: { email: string }) => m.email)).toEqual([
      'ama@example.com',
      'kofi@example.com',
    ]);
  });

  it('refuses to invite someone who is already a member', async () => {
    expect((await invite('ama', 'kofi@example.com')).res.statusCode).toBe(409);
  });

  it('only owners and admins manage members and invites', async () => {
    expect((await invite('kofi', 'esi@example.com')).res.statusCode).toBe(403);
    expect((await call('kofi', 'GET', `/v1/workspaces/${ws}/invites`)).statusCode).toBe(403);
    expect(
      (await call('kofi', 'PATCH', `/v1/workspaces/${ws}/members/${ids.ama}`, { role: 'member' }))
        .statusCode,
    ).toBe(403);
  });

  it("admins can't touch owners or create owners", async () => {
    await call('ama', 'PATCH', `/v1/workspaces/${ws}/members/${ids.kofi}`, { role: 'admin' });
    expect(
      (await call('kofi', 'PATCH', `/v1/workspaces/${ws}/members/${ids.ama}`, { role: 'member' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('kofi', 'DELETE', `/v1/workspaces/${ws}/members/${ids.ama}`)).statusCode,
    ).toBe(403);
    expect((await invite('kofi', 'esi@example.com', 'owner')).res.statusCode).toBe(403);
    expect((await invite('kofi', 'esi@example.com', 'member')).res.statusCode).toBe(201);
  });

  it('always keeps at least one owner', async () => {
    expect(
      (await call('ama', 'PATCH', `/v1/workspaces/${ws}/members/${ids.ama}`, { role: 'admin' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('ama', 'DELETE', `/v1/workspaces/${ws}/members/${ids.ama}`)).statusCode,
    ).toBe(409);
  });

  it('revoked and expired invites stop working', async () => {
    const revoked = await invite('ama', 'esi@example.com');
    const pending = (await call('ama', 'GET', `/v1/workspaces/${ws}/invites`)).json().data;
    expect(pending.map((i: { email: string }) => i.email)).toEqual(['esi@example.com']);
    const inviteId = revoked.res.json().invite.id;
    expect(
      (await call('ama', 'DELETE', `/v1/workspaces/${ws}/invites/${inviteId}`)).statusCode,
    ).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/v1/invites/${revoked.token}` })).statusCode,
    ).toBe(404);

    const expired = await invite('ama', 'esi@example.com');
    await ctx.database.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, expired.res.json().invite.id));
    expect((await call('esi', 'POST', `/v1/invites/${expired.token}/accept`)).statusCode).toBe(404);
  });

  it('removing a member cuts access at once and deletes their personal connections', async () => {
    await ctx.database.db.insert(connections).values({
      workspaceId: ws,
      ownerUserId: ids.kofi!,
      provider: 'demo',
      externalAccountId: 'kofi-personal',
      displayName: "Kofi's mail",
      visibility: 'personal',
    });
    expect(
      (await call('ama', 'DELETE', `/v1/workspaces/${ws}/members/${ids.kofi}`)).statusCode,
    ).toBe(204);
    expect((await call('kofi', 'GET', `/v1/workspaces/${ws}`)).statusCode).toBe(404);
    const left = await ctx.database.db
      .select()
      .from(connections)
      .where(eq(connections.ownerUserId, ids.kofi!));
    expect(left.filter((c) => c.workspaceId === ws)).toHaveLength(0);
  });

  it('lets a member leave on their own', async () => {
    const { token } = await invite('ama', 'esi@example.com');
    await call('esi', 'POST', `/v1/invites/${token}/accept`);
    expect(
      (await call('esi', 'DELETE', `/v1/workspaces/${ws}/members/${ids.esi}`)).statusCode,
    ).toBe(204);
    expect((await call('esi', 'GET', `/v1/workspaces/${ws}`)).statusCode).toBe(404);
  });

  it('records an audit trail', async () => {
    const actions = (
      await ctx.database.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.workspaceId, ws))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'invite.created',
        'invite.accepted',
        'member.role_changed',
        'member.removed',
        'member.left',
        'invite.revoked',
      ]),
    );
  });

  it("deletes a workspace (owners only), but never the user's last one", async () => {
    const mine = (await call('esi', 'GET', '/v1/me')).json().workspaces;
    expect(mine).toHaveLength(1);
    expect((await call('esi', 'DELETE', `/v1/workspaces/${mine[0].id}`)).statusCode).toBe(409);
    expect((await call('esi', 'DELETE', `/v1/workspaces/${ws}`)).statusCode).toBe(404);
    expect((await call('ama', 'DELETE', `/v1/workspaces/${ws}`)).statusCode).toBe(204);
    expect((await call('ama', 'GET', `/v1/workspaces/${ws}`)).statusCode).toBe(404);
  });
});
