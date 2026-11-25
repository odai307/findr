import { and, eq, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger as Logger } from 'fastify';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { SyncBatch, SyncContext } from '../connectors/types.js';
import type { Db } from '../db/client.js';
import { connections, syncRuns, type Connection, type SyncState } from '../db/schema.js';
import {
  backfillEmbeddings,
  indexDocument,
  softDeleteDocuments,
  type IndexTarget,
} from './indexer.js';
import type { Embedder } from './embedder.js';

export type SyncKind = 'full' | 'incremental';

export interface SyncDeps {
  db: Db;
  embedder: Embedder;
  connectors: ConnectorRegistry;
  log: Logger;
  /**
   * Documents indexed in parallel within one batch (default 4). Their embedding calls overlap;
   * their transactions are still safe on PGlite, which queues queries behind an open transaction.
   */
  indexConcurrency?: number;
}

export interface SyncOutcome {
  status: 'succeeded' | 'skipped_locked' | 'skipped_inactive';
  runId?: string;
  kind?: SyncKind;
}

/** A sync owns its connection for this long; a heartbeat keeps renewing it while it runs. */
const LOCK_TTL_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;

/**
 * Database-level lock (no Redis needed): claim the connection only if no other sync holds an
 * unexpired lock. If a worker crashes, its lock simply expires and the next attempt takes over.
 */
async function acquireLock(db: Db, connectionId: string): Promise<Connection | undefined> {
  const [row] = await db
    .update(connections)
    .set({
      status: 'syncing',
      lockExpiresAt: sql`now() + make_interval(secs => ${LOCK_TTL_MS / 1000})`,
    })
    .where(
      and(
        eq(connections.id, connectionId),
        notInArray(connections.status, ['paused', 'revoked']),
        or(isNull(connections.lockExpiresAt), lt(connections.lockExpiresAt, sql`now()`)),
      ),
    )
    .returning();
  return row;
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/**
 * Runs one sync for a connection. Safe to call twice at once (the second is skipped) and safe to
 * retry after a crash: the cursor is saved only after each batch commits, and indexing is
 * idempotent, so a retry re-processes at most one batch and never loses data.
 */
export async function runSync(
  deps: SyncDeps,
  connectionId: string,
  requestedKind: SyncKind,
  signal: AbortSignal = new AbortController().signal,
): Promise<SyncOutcome> {
  const { db, log } = deps;
  const exists = await db
    .select({ status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!exists[0] || exists[0].status === 'paused' || exists[0].status === 'revoked') {
    return { status: 'skipped_inactive' };
  }

  const conn = await acquireLock(db, connectionId);
  if (!conn) return { status: 'skipped_locked' };

  const state: SyncState = { ...conn.syncState };
  // An unfinished full sync is always resumed; an incremental sync needs a starting point.
  const kind: SyncKind =
    state.fullCursor !== undefined || state.incremental === undefined ? 'full' : requestedKind;

  const [run] = await db
    .insert(syncRuns)
    .values({ connectionId, kind, status: 'running' })
    .returning({ id: syncRuns.id });
  const runId = run!.id;
  const runLog = log.child({ connectionId, runId, kind });

  const heartbeat = setInterval(() => {
    void db
      .update(connections)
      .set({ lockExpiresAt: sql`now() + make_interval(secs => ${LOCK_TTL_MS / 1000})` })
      .where(eq(connections.id, connectionId))
      .catch((err: unknown) => runLog.warn({ err }, 'Lock heartbeat failed'));
  }, HEARTBEAT_MS);

  const ctx: SyncContext = {
    connectionId,
    workspaceId: conn.workspaceId,
    ownerUserId: conn.ownerUserId,
    signal,
  };
  const target: IndexTarget = {
    connectionId,
    workspaceId: conn.workspaceId,
    provider: conn.provider,
  };
  const totals = {
    itemsSeen: 0,
    itemsUpserted: 0,
    itemsUnchanged: 0,
    itemsDeleted: 0,
    chunksEmbedded: 0,
    chunksReused: 0,
  };

  try {
    const connector = deps.connectors(conn.provider);
    let batches: AsyncGenerator<SyncBatch>;
    if (kind === 'full') {
      if (state.fullCursor === undefined) {
        // Fresh full sync: capture the change token first so nothing changed during it is missed.
        state.pendingIncremental = await connector.getIncrementalCursor(ctx);
        await saveState(db, connectionId, state);
      }
      runLog.info({ resuming: state.fullCursor !== undefined }, 'Full sync started');
      batches = connector.fullSync(ctx, state.fullCursor);
    } else {
      runLog.info('Incremental sync started');
      batches = connector.incrementalSync(ctx, state.incremental);
    }

    for await (const batch of batches) {
      signal.throwIfAborted();
      totals.itemsSeen += batch.upserts.length;
      await mapWithConcurrency(batch.upserts, deps.indexConcurrency ?? 4, async (doc) => {
        const r = await indexDocument(db, deps.embedder, target, doc, signal);
        if (r.outcome === 'unchanged') totals.itemsUnchanged++;
        else totals.itemsUpserted++;
        totals.chunksEmbedded += r.chunksEmbedded;
        totals.chunksReused += r.chunksReused;
      });
      totals.itemsDeleted += await softDeleteDocuments(db, connectionId, batch.deletions);

      // Only now that the batch is committed does the cursor move forward.
      if (kind === 'full') state.fullCursor = batch.cursor;
      else state.incremental = batch.cursor;
      await saveState(db, connectionId, state);
      await db.update(syncRuns).set(totals).where(eq(syncRuns.id, runId));
    }

    if (kind === 'full') {
      state.incremental = state.pendingIncremental;
      delete state.fullCursor;
      delete state.pendingIncremental;
    }
    // Fill in vectors that are missing (outage, quota) or from an older model, a page at a time.
    try {
      for (let round = 0; round < 20; round++) {
        const filled = await backfillEmbeddings(db, deps.embedder, {
          workspaceId: conn.workspaceId,
        });
        totals.chunksEmbedded += filled;
        if (filled === 0) break;
      }
    } catch (err) {
      runLog.warn({ err }, 'Embedding backfill stopped; it continues on the next sync');
    }

    const now = new Date();
    await db
      .update(connections)
      .set({
        syncState: state,
        status: 'active',
        lockExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        ...(kind === 'full' ? { lastFullSyncAt: now } : { lastIncrementalSyncAt: now }),
      })
      .where(eq(connections.id, connectionId));
    await db
      .update(syncRuns)
      .set({ ...totals, status: 'succeeded', finishedAt: now })
      .where(eq(syncRuns.id, runId));
    runLog.info(totals, 'Sync finished');
    return { status: 'succeeded', runId, kind };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runLog.error({ err }, 'Sync failed');
    await db
      .update(connections)
      .set({
        status: 'error',
        lockExpiresAt: null,
        errorCode: 'SYNC_FAILED',
        errorMessage: message,
      })
      .where(and(eq(connections.id, connectionId), ne(connections.status, 'revoked')));
    await db
      .update(syncRuns)
      .set({ ...totals, status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, runId));
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

async function saveState(db: Db, connectionId: string, state: SyncState) {
  await db.update(connections).set({ syncState: state }).where(eq(connections.id, connectionId));
}
