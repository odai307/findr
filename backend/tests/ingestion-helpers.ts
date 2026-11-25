import pino from 'pino';
import type { Connector, SourceDocument, SyncBatch } from '../src/connectors/types.js';
import { openDatabase, type Database } from '../src/db/client.js';
import { connections } from '../src/db/schema.js';
import { upsertDevUser } from '../src/auth/users.js';
import {
  createFakeEmbedder,
  EmbeddingUnavailableError,
  type Embedder,
} from '../src/ingestion/embedder.js';
import type { SyncDeps } from '../src/ingestion/sync.js';
import { listWorkspacesForUser } from '../src/workspaces/service.js';

export const silentLog = pino({ level: 'silent' });

/** A fake embedder that counts how many texts it was asked to embed. */
export function countingEmbedder(base: Embedder = createFakeEmbedder()) {
  const counter = { calls: 0, texts: 0, failNext: false };
  const embedder: Embedder = {
    model: base.model,
    dimensions: base.dimensions,
    async embed(texts, options) {
      counter.calls++;
      if (counter.failNext) throw new EmbeddingUnavailableError('simulated outage');
      counter.texts += texts.length;
      return base.embed(texts, options);
    },
  };
  return { embedder, counter };
}

export interface Fixture {
  database: Database;
  userId: string;
  workspaceId: string;
  connectionId: string;
}

/** Fresh in-memory database with one user, their workspace and one connection. */
export async function createFixture(provider = 'test'): Promise<Fixture> {
  const database = await openDatabase('pglite:memory');
  await database.migrate();
  const user = await upsertDevUser(database.db, 'ama@example.com');
  const [ws] = await listWorkspacesForUser(database.db, user.id);
  const [conn] = await database.db
    .insert(connections)
    .values({
      workspaceId: ws!.id,
      ownerUserId: user.id,
      provider,
      externalAccountId: 'acct-1',
      displayName: 'Test',
      visibility: 'workspace',
    })
    .returning();
  return { database, userId: user.id, workspaceId: ws!.id, connectionId: conn!.id };
}

export function doc(
  id: string,
  text: string,
  overrides: Partial<SourceDocument> = {},
): SourceDocument {
  return {
    externalId: id,
    type: 'page',
    title: `Doc ${id}`,
    url: `https://example.com/${id}`,
    author: { name: 'Ama Mensah' },
    container: 'Projects',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    acl: ['workspace:ws'],
    content: { kind: 'text', text, format: 'markdown' },
    ...overrides,
  };
}

/**
 * A scriptable connector: full sync serves `docs` in pages of `pageSize`; `failAfterPages`
 * makes it throw (like a crash) after that many pages; `changes` feeds incremental syncs.
 */
export function scriptedConnector(opts: {
  docs: SourceDocument[];
  pageSize?: number;
  failAfterPages?: number;
  changes?: SyncBatch[];
}) {
  const pageSize = opts.pageSize ?? 2;
  const fetchedOffsets: number[] = [];
  const connector: Connector = {
    provider: 'test',
    async getIncrementalCursor() {
      return { change: 0 };
    },
    async *fullSync(_ctx, resume) {
      let offset = (resume as { offset: number } | undefined)?.offset ?? 0;
      let pages = 0;
      while (offset < opts.docs.length) {
        if (opts.failAfterPages !== undefined && pages >= opts.failAfterPages) {
          throw new Error('simulated crash');
        }
        fetchedOffsets.push(offset);
        const page = opts.docs.slice(offset, offset + pageSize);
        offset += page.length;
        pages++;
        yield { upserts: page, deletions: [], cursor: { offset } };
      }
    },
    async *incrementalSync(_ctx, cursor) {
      const start = (cursor as { change: number }).change;
      const pending = (opts.changes ?? []).slice(start);
      if (!pending.length) yield { upserts: [], deletions: [], cursor };
      for (const [i, batch] of pending.entries())
        yield { ...batch, cursor: { change: start + i + 1 } };
    },
  };
  return { connector, fetchedOffsets, opts };
}

export function syncDeps(database: Database, connector: Connector, embedder: Embedder): SyncDeps {
  return { db: database.db, embedder, connectors: () => connector, log: silentLog };
}
