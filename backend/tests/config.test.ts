import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/shared/config.js';

const base = {
  DATABASE_URL: 'pglite:memory',
  WEB_ORIGIN: 'http://localhost:5173',
  API_PUBLIC_URL: 'http://localhost:5173',
  JWT_PRIVATE_KEY: 'x',
  JWT_PUBLIC_KEY: 'y',
};

describe('config', () => {
  it('applies defaults', () => {
    const c = parseConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.DEV_LOGIN_ENABLED).toBe(false);
  });

  it('lists every missing variable at once', () => {
    expect(() => parseConfig({})).toThrow(/DATABASE_URL[\s\S]*WEB_ORIGIN/);
  });

  it('refuses dev login in production', () => {
    expect(() =>
      parseConfig({ ...base, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow(/DEV_LOGIN_ENABLED/);
  });

  it('requires both Google credentials or neither', () => {
    expect(() => parseConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('rejects unknown database URL schemes', () => {
    expect(() => parseConfig({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
