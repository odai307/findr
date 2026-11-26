import { exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/api/app.js';
import { openDatabase, type Database } from '../src/db/client.js';
import { parseConfig, type Config } from '../src/shared/config.js';

const encode = async (key: CryptoKey) =>
  Buffer.from(JSON.stringify(await exportJWK(key))).toString('base64');

export async function testKeys() {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  return { JWT_PRIVATE_KEY: await encode(privateKey), JWT_PUBLIC_KEY: await encode(publicKey) };
}

export async function testConfig(overrides: Record<string, string> = {}): Promise<Config> {
  return parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite:memory',
    WEB_ORIGIN: 'http://localhost:5173',
    API_PUBLIC_URL: 'http://localhost:5173',
    DEV_LOGIN_ENABLED: 'true',
    ...(await testKeys()),
    ...overrides,
  });
}

export interface TestContext {
  app: FastifyInstance;
  database: Database;
  close(): Promise<void>;
}

/** A fresh app with its own in-memory Postgres (PGlite), fully migrated. */
export async function createTestApp(
  overrides: Record<string, string> = {},
  deps: Pick<AppDeps, 'chat'> = {},
): Promise<TestContext> {
  const config = await testConfig(overrides);
  const database = await openDatabase(config.DATABASE_URL);
  await database.migrate();
  const app = await buildApp({ config, db: database.db, ...deps });
  await app.ready();
  return {
    app,
    database,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

/** Pulls the refresh token value out of a Set-Cookie header. */
export function refreshCookieFrom(setCookie: string | string[] | undefined): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of all) {
    const match = /^findr_rt=([^;]*)/.exec(c);
    if (match && match[1]) return match[1];
  }
  return undefined;
}

export async function devLogin(app: FastifyInstance, email = 'ama@example.com') {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email } });
  if (res.statusCode !== 200) throw new Error(`dev-login failed: ${res.statusCode} ${res.body}`);
  return {
    accessToken: res.json<{ accessToken: string }>().accessToken,
    refreshToken: refreshCookieFrom(res.headers['set-cookie'])!,
  };
}

/** Connects the demo data for the user's first workspace and waits for the sync to finish. */
export async function connectDemoAndWait(app: FastifyInstance, accessToken: string) {
  const headers = { authorization: `Bearer ${accessToken}` };
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers });
  const workspaceId: string = me.json().workspaces[0].id;
  const created = await app.inject({
    method: 'POST',
    url: `/v1/workspaces/${workspaceId}/connections/demo`,
    headers,
  });
  const connectionId: string = created.json().id;
  for (let i = 0; i < 600; i++) {
    const c = (
      await app.inject({
        method: 'GET',
        url: `/v1/workspaces/${workspaceId}/connections/${connectionId}`,
        headers,
      })
    ).json();
    if (c.lastRun?.status === 'succeeded' && c.status === 'active') break;
    if (c.lastRun?.status === 'failed') throw new Error(`sync failed: ${c.lastRun.error}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { workspaceId, connectionId };
}

/** Splits a server-sent-events body into { event, data } objects. */
export function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null');
      return { event, data };
    });
}
