import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chunks, connections, documents, syncRuns, type Connection } from '../db/schema.js';
import { AppError } from '../shared/errors.js';
import { getWorkspaceForUser } from '../workspaces/service.js';

export interface ConnectionView {
  id: string;
  provider: string;
  displayName: string;
  visibility: 'personal' | 'workspace';
  status: Connection['status'];
  isOwner: boolean;
  documentCount: number;
  chunkCount: number;
  lastFullSyncAt: Date | null;
  lastIncrementalSyncAt: Date | null;
  errorMessage: string | null;
  lastRun: {
    kind: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    itemsSeen: number;
    itemsUpserted: number;
    itemsUnchanged: number;
    itemsDeleted: number;
    chunksEmbedded: number;
    chunksReused: number;
    error: string | null;
  } | null;
}

/** A user sees workspace-shared connections plus their own personal ones. */
const visibleTo = (workspaceId: string, userId: string) =>
  and(
    eq(connections.workspaceId, workspaceId),
    or(eq(connections.visibility, 'workspace'), eq(connections.ownerUserId, userId)),
  );

async function toView(db: Db, conn: Connection, userId: string): Promise<ConnectionView> {
  const [docs] = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.connectionId, conn.id), isNull(documents.deletedAt)));
  const [chunkCount] = await db
    .select({ n: count() })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(documents.connectionId, conn.id), isNull(chunks.deletedAt)));
  const [lastRun] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, conn.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  return {
    id: conn.id,
    provider: conn.provider,
    displayName: conn.displayName,
    visibility: conn.visibility,
    status: conn.status,
    isOwner: conn.ownerUserId === userId,
    documentCount: docs?.n ?? 0,
    chunkCount: chunkCount?.n ?? 0,
    lastFullSyncAt: conn.lastFullSyncAt,
    lastIncrementalSyncAt: conn.lastIncrementalSyncAt,
    errorMessage: conn.errorMessage,
    lastRun: lastRun
      ? {
          kind: lastRun.kind,
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          itemsSeen: lastRun.itemsSeen,
          itemsUpserted: lastRun.itemsUpserted,
          itemsUnchanged: lastRun.itemsUnchanged,
          itemsDeleted: lastRun.itemsDeleted,
          chunksEmbedded: lastRun.chunksEmbedded,
          chunksReused: lastRun.chunksReused,
          error: lastRun.error,
        }
      : null,
  };
}

export async function listConnections(db: Db, workspaceId: string, userId: string) {
  await getWorkspaceForUser(db, workspaceId, userId);
  const rows = await db
    .select()
    .from(connections)
    .where(visibleTo(workspaceId, userId))
    .orderBy(connections.createdAt);
  return Promise.all(rows.map((c) => toView(db, c, userId)));
}

async function findVisible(db: Db, workspaceId: string, connectionId: string, userId: string) {
  await getWorkspaceForUser(db, workspaceId, userId);
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), visibleTo(workspaceId, userId)))
    .limit(1);
  if (!conn) throw new AppError('NOT_FOUND', 'Connection not found.');
  return conn;
}

export async function getConnection(
  db: Db,
  workspaceId: string,
  connectionId: string,
  userId: string,
) {
  return toView(db, await findVisible(db, workspaceId, connectionId, userId), userId);
}

/** Only the owner of a connection, or a workspace owner/admin, may change or remove it. */
async function findManageable(db: Db, workspaceId: string, connectionId: string, userId: string) {
  const conn = await findVisible(db, workspaceId, connectionId, userId);
  const ws = await getWorkspaceForUser(db, workspaceId, userId);
  if (conn.ownerUserId !== userId && ws.role === 'member') {
    throw new AppError('FORBIDDEN', 'Only the connection owner or a workspace admin can do this.');
  }
  return conn;
}

/** Connects the fictional demo dataset, shared with the whole workspace. */
export async function createDemoConnection(db: Db, workspaceId: string, userId: string) {
  await getWorkspaceForUser(db, workspaceId, userId);
  const [conn] = await db
    .insert(connections)
    .values({
      workspaceId,
      ownerUserId: userId,
      provider: 'demo',
      visibility: 'workspace',
      externalAccountId: 'tamarind-labs',
      displayName: 'Tamarind Labs (demo data)',
    })
    .onConflictDoNothing()
    .returning();
  if (!conn)
    throw new AppError('CONFLICT', 'The demo data is already connected in this workspace.');
  return toView(db, conn, userId);
}

export async function assertCanSync(
  db: Db,
  workspaceId: string,
  connectionId: string,
  userId: string,
) {
  const conn = await findManageable(db, workspaceId, connectionId, userId);
  if (conn.status === 'revoked') throw new AppError('CONFLICT', 'Reconnect this account first.');
  return conn;
}

/** Forces the next sync to be a full one, starting from scratch. */
export async function resetSyncState(db: Db, connectionId: string) {
  await db
    .update(connections)
    .set({ syncState: sql`'{}'::jsonb` })
    .where(eq(connections.id, connectionId));
}

/** Disconnect: the database cascade deletes its documents, access lists, chunks and sync runs. */
export async function deleteConnection(
  db: Db,
  workspaceId: string,
  connectionId: string,
  userId: string,
) {
  await findManageable(db, workspaceId, connectionId, userId);
  await db.delete(connections).where(eq(connections.id, connectionId));
}
