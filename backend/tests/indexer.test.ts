import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunks, documentAcl, documents, EMBEDDING_DIMENSIONS } from '../src/db/schema.js';
import {
  backfillEmbeddings,
  indexDocument,
  softDeleteDocuments,
  type IndexTarget,
} from '../src/ingestion/indexer.js';
import { countingEmbedder, createFixture, doc, type Fixture } from './ingestion-helpers.js';

const longText = Array.from(
  { length: 6 },
  (_, s) =>
    `## Section ${s}\n\n` +
    Array.from(
      { length: 30 },
      (_, i) =>
        `Section ${s} sentence ${i} covers routes, depots and dispatch planning in detail. `,
    ).join(''),
).join('\n\n');

describe('indexDocument', () => {
  let fx: Fixture;
  let target: IndexTarget;
  beforeEach(async () => {
    fx = await createFixture();
    target = { connectionId: fx.connectionId, workspaceId: fx.workspaceId, provider: 'test' };
  });
  afterEach(() => fx.database.close());

  const chunkRows = (documentId: string) =>
    fx.database.db.select().from(chunks).where(eq(chunks.documentId, documentId));

  it('stores the document, its access list and embedded chunks', async () => {
    const { embedder, counter } = countingEmbedder();
    const r = await indexDocument(fx.database.db, embedder, target, doc('a', longText));
    expect(r.outcome).toBe('indexed');
    expect(r.chunksEmbedded).toBeGreaterThan(1);
    expect(counter.texts).toBe(r.chunksEmbedded);

    const [d] = await fx.database.db.select().from(documents);
    expect(d!.indexStatus).toBe('indexed');
    const rows = await chunkRows(d!.id);
    expect(rows).toHaveLength(r.chunksEmbedded);
    expect(rows[0]!.contextHeader).toBe(
      '[test · page] Doc a | From: Ama Mensah | In: Projects | 2026-02-01',
    );
    expect(
      rows.every(
        (c) => c.embedding?.length === EMBEDDING_DIMENSIONS && c.acl[0] === 'workspace:ws',
      ),
    ).toBe(true);
  });

  it('re-indexing unchanged text embeds nothing (gate: re-sync re-embeds 0 chunks)', async () => {
    const { embedder, counter } = countingEmbedder();
    await indexDocument(fx.database.db, embedder, target, doc('a', longText));
    const before = counter.texts;

    const later = doc('a', longText, { updatedAt: new Date('2026-03-01T00:00:00Z') });
    const r = await indexDocument(fx.database.db, embedder, target, later);
    expect(r).toMatchObject({ outcome: 'unchanged', chunksEmbedded: 0 });
    expect(counter.texts).toBe(before);
    const [d] = await fx.database.db.select().from(documents);
    expect(d!.sourceUpdatedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('an access-list change updates permissions without re-embedding (fix C2)', async () => {
    const { embedder, counter } = countingEmbedder();
    await indexDocument(fx.database.db, embedder, target, doc('a', longText));
    const before = counter.texts;

    const r = await indexDocument(
      fx.database.db,
      embedder,
      target,
      doc('a', longText, { acl: ['user:u1', 'group:slack:C1'] }),
    );
    expect(r.outcome).toBe('acl_updated');
    expect(counter.texts).toBe(before);

    const [d] = await fx.database.db.select().from(documents);
    const acl = await fx.database.db
      .select()
      .from(documentAcl)
      .where(eq(documentAcl.documentId, d!.id));
    expect(acl.map((a) => a.principal).sort()).toEqual(['group:slack:C1', 'user:u1']);
    expect(acl.every((a) => a.workspaceId === fx.workspaceId)).toBe(true);
    for (const c of await chunkRows(d!.id)) expect(c.acl).toEqual(['group:slack:C1', 'user:u1']);
  });

  it('an edit re-embeds only the chunks whose text changed (fix C3)', async () => {
    const { embedder, counter } = countingEmbedder();
    const first = await indexDocument(fx.database.db, embedder, target, doc('a', longText));
    const before = counter.texts;

    const edited = longText.replace(
      'Section 5 sentence 29',
      'Section 5 sentence twenty-nine (edited)',
    );
    const r = await indexDocument(fx.database.db, embedder, target, doc('a', edited));
    expect(r.outcome).toBe('indexed');
    expect(r.chunksEmbedded).toBeGreaterThanOrEqual(1);
    expect(r.chunksEmbedded).toBeLessThan(first.chunksEmbedded);
    // Every chunk of the new version either reused a vector or got a fresh one.
    const [d] = await fx.database.db.select().from(documents);
    expect(r.chunksReused + r.chunksEmbedded).toBe((await chunkRows(d!.id)).length);
    expect(r.chunksReused).toBeGreaterThan(0);
    expect(counter.texts - before).toBe(r.chunksEmbedded);
  });

  it('stores chunks without vectors when the embedding provider is down, then backfills', async () => {
    const { embedder, counter } = countingEmbedder();
    counter.failNext = true;
    const r = await indexDocument(
      fx.database.db,
      embedder,
      target,
      doc('a', 'Delivery is on March 15.'),
    );
    expect(r).toMatchObject({ outcome: 'indexed', chunksEmbedded: 0, chunksPending: 1 });
    const [d] = await fx.database.db.select().from(documents);
    expect((await chunkRows(d!.id))[0]!.embedding).toBeNull();

    counter.failNext = false;
    expect(await backfillEmbeddings(fx.database.db, embedder)).toBe(1);
    expect((await chunkRows(d!.id))[0]!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('soft-deletes documents and their chunks, and a re-appearing document comes back', async () => {
    const { embedder } = countingEmbedder();
    await indexDocument(fx.database.db, embedder, target, doc('a', 'Hello'));
    expect(await softDeleteDocuments(fx.database.db, fx.connectionId, ['a', 'missing'])).toBe(1);

    const live = await fx.database.db.select().from(chunks).where(isNull(chunks.deletedAt));
    expect(live).toHaveLength(0);

    await indexDocument(fx.database.db, embedder, target, doc('a', 'Hello'));
    const [d] = await fx.database.db
      .select()
      .from(documents)
      .where(and(eq(documents.externalId, 'a'), isNull(documents.deletedAt)));
    expect(d).toBeDefined();
    expect(await chunkRows(d!.id)).toHaveLength(1);
  });

  it('records binary files as awaiting the parser', async () => {
    const { embedder } = countingEmbedder();
    const r = await indexDocument(
      fx.database.db,
      embedder,
      target,
      doc('f', '', {
        type: 'file',
        content: { kind: 'file', mimeType: 'application/pdf', sizeBytes: 10 },
      }),
    );
    expect(r.outcome).toBe('awaiting_parser');
    const [d] = await fx.database.db.select().from(documents);
    expect(d!.indexStatus).toBe('awaiting_parser');
  });
});
