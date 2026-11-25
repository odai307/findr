import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRefreshTokenService } from '../src/auth/refresh-tokens.js';
import { upsertDevUser } from '../src/auth/users.js';
import { openDatabase, type Database } from '../src/db/client.js';
import { refreshTokens } from '../src/db/schema.js';

describe('refresh token rotation', () => {
  let database: Database;
  let userId: string;
  let clock = new Date('2026-11-12T10:00:00Z');
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  beforeAll(async () => {
    database = await openDatabase('pglite:memory');
    await database.migrate();
    userId = (await upsertDevUser(database.db, 'esi@example.com')).id;
  });
  afterAll(() => database.close());

  const service = () => createRefreshTokenService(database.db, { ttlDays: 30, now: () => clock });

  it('stores only a hash of the token', async () => {
    const issued = await service().issue(userId);
    const rows = await database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, issued.familyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(issued.token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the same family across rotations', async () => {
    const first = await service().issue(userId);
    const second = await service().rotate(first.token);
    expect(second.familyId).toBe(first.familyId);
    expect(second.token).not.toBe(first.token);
  });

  it('tolerates a second use within 10 s (two tabs refreshing at once)', async () => {
    const first = await service().issue(userId);
    await service().rotate(first.token);
    advance(2_000);
    await expect(service().rotate(first.token)).resolves.toMatchObject({
      familyId: first.familyId,
    });
  });

  it('revokes the whole family when an old token is reused later (theft signal)', async () => {
    const stolen = await service().issue(userId);
    const legit = await service().rotate(stolen.token);
    advance(60_000);

    await expect(service().rotate(stolen.token)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
    // The legitimate user's newer token is now dead too, forcing a fresh sign-in.
    await expect(service().rotate(legit.token)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('rejects expired tokens', async () => {
    const issued = await service().issue(userId);
    advance(31 * 86_400_000);
    await expect(service().rotate(issued.token)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('rejects unknown tokens', async () => {
    await expect(service().rotate('made-up')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });
});
