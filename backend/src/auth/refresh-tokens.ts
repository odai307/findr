import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { randomToken, sha256 } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';

/**
 * Two browser tabs can refresh with the same cookie at nearly the same moment. A token
 * reused within this window is treated as that race, not as theft.
 */
const REUSE_GRACE_MS = 10_000;

export interface IssuedRefreshToken {
  token: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
}

export interface RefreshTokenService {
  /** Starts a new token family (one per login). */
  issue(userId: string, userAgent?: string): Promise<IssuedRefreshToken>;
  /** Exchanges a valid token for a new one. Detects reuse of old tokens. */
  rotate(token: string, userAgent?: string): Promise<IssuedRefreshToken>;
  /** Logs out: revokes every token from the same login. Unknown tokens are ignored. */
  revokeFamilyOf(token: string): Promise<void>;
  /** "Sign out everywhere": revokes every active token the user has. */
  revokeAllForUser(userId: string): Promise<void>;
}

export function createRefreshTokenService(
  db: Db,
  opts: { ttlDays: number; now?: () => Date },
): RefreshTokenService {
  const now = opts.now ?? (() => new Date());

  async function insert(userId: string, familyId: string, userAgent?: string) {
    const token = randomToken();
    const id = uuidv7();
    const expiresAt = new Date(now().getTime() + opts.ttlDays * 86_400_000);
    await db.insert(refreshTokens).values({
      id,
      userId,
      familyId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: userAgent ?? null,
    });
    return { id, issued: { token, userId, familyId, expiresAt } };
  }

  async function revokeFamily(familyId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: now() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async function rotate(token: string, userAgent?: string): Promise<IssuedRefreshToken> {
    const invalid = () => new AppError('REFRESH_TOKEN_INVALID', 'Please sign in again.');
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(token)))
      .limit(1);
    if (!row) throw invalid();

    if (row.revokedAt) {
      // Already used. A rotation a few seconds ago is a two-tab race; anything else is reuse.
      const recentlyRotated =
        row.replacedBy !== null && now().getTime() - row.revokedAt.getTime() < REUSE_GRACE_MS;
      if (recentlyRotated) return (await insert(row.userId, row.familyId, userAgent)).issued;
      await revokeFamily(row.familyId);
      throw invalid();
    }
    if (row.expiresAt.getTime() <= now().getTime()) throw invalid();

    const next = await insert(row.userId, row.familyId, userAgent);
    // Conditional update: if another request rotated this token first, we lose the race.
    const claimed = await db
      .update(refreshTokens)
      .set({ revokedAt: now(), replacedBy: next.id })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, next.id));
      return rotate(token, userAgent);
    }
    return next.issued;
  }

  return {
    async issue(userId, userAgent) {
      return (await insert(userId, uuidv7(), userAgent)).issued;
    },

    rotate,

    async revokeFamilyOf(token) {
      const [row] = await db
        .select({ familyId: refreshTokens.familyId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(token)))
        .limit(1);
      if (row) await revokeFamily(row.familyId);
    },

    async revokeAllForUser(userId) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    },
  };
}
