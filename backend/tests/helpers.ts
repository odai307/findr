import { exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.js';
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
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const config = await testConfig(overrides);
  const database = await openDatabase(config.DATABASE_URL);
  await database.migrate();
  const app = await buildApp({ config, db: database.db });
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
