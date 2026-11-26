import { and, desc, eq, like, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, users } from '../db/schema.js';

export interface AuditEntry {
  action: string;
  actorUserId: string | null;
  workspaceId?: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Records a security-relevant event (design §11.6): logins, members and roles, invites,
 * connections, API keys, workspace changes. Never stores document content or query text.
 */
export async function recordAudit(db: Db, entry: AuditEntry) {
  await db.insert(auditLog).values({
    action: entry.action,
    actorUserId: entry.actorUserId,
    workspaceId: entry.workspaceId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}

/** Newest first, `limit` at a time; pass the last row's id as `before` for the next page. */
export async function listAudit(
  db: Db,
  workspaceId: string,
  opts: { limit: number; before?: string; actionPrefix?: string },
) {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        // UUIDv7 ids are time-ordered, so "before this id" means "older than this row".
        opts.before ? lt(auditLog.id, opts.before) : undefined,
        opts.actionPrefix
          ? like(auditLog.action, `${opts.actionPrefix.replace(/[%_]/g, '')}%`)
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(opts.limit + 1);
  const hasMore = rows.length > opts.limit;
  const data = rows.slice(0, opts.limit);
  return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
}
