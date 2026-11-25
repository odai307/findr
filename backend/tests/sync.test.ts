import { eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoConnector } from '../src/connectors/demo/index.js';
import { allDemoDocs } from '../src/connectors/demo/data.js';
import { connections, documents, syncRuns } from '../src/db/schema.js';
import { runSync } from '../src/ingestion/sync.js';
import {
  countingEmbedder,
  createFixture,
  doc,
  scriptedConnector,
  syncDeps,
  type Fixture,
} from './ingestion-helpers.js';

describe('runSync', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createFixture();
  });
  afterEach(() => fx.database.close());

  const connection = async () =>
    (
      await fx.database.db.select().from(connections).where(eq(connections.id, fx.connectionId))
    )[0]!;
  const liveDocs = () => fx.database.db.select().from(documents).where(isNull(documents.deletedAt));

  it('indexes the demo dataset, and a second full sync embeds 0 chunks (phase 1 gate)', async () => {
    const { embedder, counter } = countingEmbedder();
    const deps = syncDeps(fx.database, createDemoConnector(), embedder);

    const first = await runSync(deps, fx.connectionId, 'full');
    expect(first.status).toBe('succeeded');
    expect(await liveDocs()).toHaveLength(allDemoDocs().length);
    const embeddedFirst = counter.texts;
    expect(embeddedFirst).toBeGreaterThan(allDemoDocs().length - 1);

    // Force a full re-list.
    await fx.database.db
      .update(connections)
      .set({ syncState: {} })
      .where(eq(connections.id, fx.connectionId));
    const second = await runSync(deps, fx.connectionId, 'full');
    expect(counter.texts).toBe(embeddedFirst);

    const [run] = await fx.database.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.id, second.runId!));
    expect(run).toMatchObject({
      status: 'succeeded',
      kind: 'full',
      itemsSeen: allDemoDocs().length,
      itemsUnchanged: allDemoDocs().length,
      chunksEmbedded: 0,
    });
    const conn = await connection();
    expect(conn.status).toBe('active');
    expect(conn.lockExpiresAt).toBeNull();
    expect(conn.syncState).toEqual({ incremental: { version: 1 } });
  }, 120_000);

  it('resumes a crashed full sync from the last committed batch', async () => {
    const docs = ['a', 'b', 'c', 'd', 'e'].map((id) => doc(id, `Text of ${id}`));
    const { embedder } = countingEmbedder();
    const crashing = scriptedConnector({ docs, pageSize: 2, failAfterPages: 2 });

    await expect(
      runSync(syncDeps(fx.database, crashing.connector, embedder), fx.connectionId, 'full'),
    ).rejects.toThrow('simulated crash');
    const afterCrash = await connection();
    expect(afterCrash.status).toBe('error');
    expect(afterCrash.lockExpiresAt).toBeNull();
    expect(afterCrash.syncState.fullCursor).toEqual({ offset: 4 });
    expect(await liveDocs()).toHaveLength(4);

    const healthy = scriptedConnector({ docs, pageSize: 2 });
    await runSync(
      syncDeps(fx.database, healthy.connector, embedder),
      fx.connectionId,
      'incremental',
    );
    // It resumed at offset 4 instead of starting over, even though an incremental sync was asked for.
    expect(healthy.fetchedOffsets).toEqual([4]);
    expect(await liveDocs()).toHaveLength(5);
    expect((await connection()).status).toBe('active');
  });

  it('applies incremental upserts and deletions', async () => {
    const { embedder } = countingEmbedder();
    const scripted = scriptedConnector({
      docs: [doc('a', 'Alpha'), doc('b', 'Beta')],
      changes: [{ upserts: [doc('c', 'Gamma')], deletions: ['a'], cursor: null }],
    });
    const deps = syncDeps(fx.database, scripted.connector, embedder);
    await runSync(deps, fx.connectionId, 'full');
    const r = await runSync(deps, fx.connectionId, 'incremental');
    expect(r.kind).toBe('incremental');

    expect((await liveDocs()).map((d) => d.externalId).sort()).toEqual(['b', 'c']);
    const conn = await connection();
    expect(conn.syncState.incremental).toEqual({ change: 1 });
    expect(conn.lastIncrementalSyncAt).not.toBeNull();
  });

  it('skips a sync while another one holds the lock', async () => {
    const { embedder } = countingEmbedder();
    await fx.database.db
      .update(connections)
      .set({ lockExpiresAt: new Date(Date.now() + 60_000) })
      .where(eq(connections.id, fx.connectionId));
    const r = await runSync(
      syncDeps(fx.database, scriptedConnector({ docs: [doc('a', 'x')] }).connector, embedder),
      fx.connectionId,
      'full',
    );
    expect(r.status).toBe('skipped_locked');
  });

  it('takes over an expired lock left by a crashed worker', async () => {
    const { embedder } = countingEmbedder();
    await fx.database.db
      .update(connections)
      .set({ status: 'syncing', lockExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(connections.id, fx.connectionId));
    const r = await runSync(
      syncDeps(fx.database, scriptedConnector({ docs: [doc('a', 'x')] }).connector, embedder),
      fx.connectionId,
      'full',
    );
    expect(r.status).toBe('succeeded');
  });

  it('does not sync paused connections', async () => {
    const { embedder } = countingEmbedder();
    await fx.database.db
      .update(connections)
      .set({ status: 'paused' })
      .where(eq(connections.id, fx.connectionId));
    const r = await runSync(
      syncDeps(fx.database, scriptedConnector({ docs: [doc('a', 'x')] }).connector, embedder),
      fx.connectionId,
      'full',
    );
    expect(r.status).toBe('skipped_inactive');
  });
});
