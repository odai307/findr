import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys, users, type ApiScope } from '../db/schema.js';
import { recordAudit } from '../shared/audit.js';
import { randomToken, sha256 } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { requireAdmin } from '../workspaces/members.js';

/**
 * Keys for the public API: `fdr_<prefix>_<secret>`. The prefix (not secret) is shown in the UI so
 * keys can be told apart; only a SHA-256 hash of the whole key is stored, so a database leak
 * doesn't leak usable keys. Requests made with a key only see content shared with the whole
 * workspace (`workspace:` principal), never anyone's personal items (design §11.2).
 */

export const API_KEY_HEADER = 'x-api-key';

export interface VerifiedKey {
  id: string;
  workspaceId: string;
  scopes: ApiScope[];
  createdBy: string;
}

const toView = (k: typeof apiKeys.$inferSelect & { createdByName?: string | null }) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes as ApiScope[],
  createdByName: k.createdByName ?? null,
  lastUsedAt: k.lastUsedAt,
  createdAt: k.createdAt,
});

export async function createApiKey(
  db: Db,
  workspaceId: string,
  actorId: string,
  input: { name: string; scopes: ApiScope[] },
) {
  await requireAdmin(db, workspaceId, actorId);
  const prefix = randomToken(6)
    .replace(/[^a-zA-Z0-9]/g, 'x')
    .slice(0, 8);
  const key = `fdr_${prefix}_${randomToken(32)}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      workspaceId,
      name: input.name,
      prefix,
      keyHash: sha256(key),
      scopes: [...new Set(input.scopes)],
      createdBy: actorId,
    })
    .returning();
  await recordAudit(db, {
    action: 'api_key.created',
    actorUserId: actorId,
    workspaceId,
    targetType: 'api_key',
    targetId: row!.id,
  });
  return { key, apiKey: toView(row!) };
}

export async function listApiKeys(db: Db, workspaceId: string, actorId: string) {
  await requireAdmin(db, workspaceId, actorId);
  const rows = await db
    .select({ key: apiKeys, createdByName: users.name })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => toView({ ...r.key, createdByName: r.createdByName }));
}

export async function revokeApiKey(db: Db, workspaceId: string, actorId: string, keyId: string) {
  await requireAdmin(db, workspaceId, actorId);
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)),
    )
    .returning({ id: apiKeys.id });
  if (!row) throw new AppError('NOT_FOUND', 'API key not found.');
  await recordAudit(db, {
    action: 'api_key.revoked',
    actorUserId: actorId,
    workspaceId,
    targetType: 'api_key',
    targetId: keyId,
  });
}

/** Checks a presented key. Throws UNAUTHENTICATED for unknown/revoked keys, FORBIDDEN for scope. */
export async function verifyApiKey(
  db: Db,
  presented: string,
  scope: ApiScope,
): Promise<VerifiedKey> {
  if (!/^fdr_[A-Za-z0-9]{8}_[\w-]{20,}$/.test(presented)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid API key.');
  }
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(presented)), isNull(apiKeys.revokedAt)));
  if (!row) throw new AppError('UNAUTHENTICATED', 'Invalid API key.');
  if (!row.scopes.includes(scope)) {
    throw new AppError('FORBIDDEN', `This API key doesn't have the "${scope}" scope.`);
  }
  // Record use, at most once a minute per key.
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, row.id),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(Date.now() - 60_000))),
      ),
    );
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scopes: row.scopes as ApiScope[],
    createdBy: row.createdBy,
  };
}
