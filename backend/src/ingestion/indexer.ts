import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { SourceDocument } from '../connectors/types.js';
import type { Db } from '../db/client.js';
import { chunks, documentAcl, documents } from '../db/schema.js';
import { sha256 } from '../shared/crypto.js';
import { chunkText } from './chunker.js';
import { EmbeddingUnavailableError, type Embedder } from './embedder.js';
import { contextHeader, documentTextHash, normalizeAcl, normalizeText } from './normalize.js';

export interface IndexTarget {
  connectionId: string;
  workspaceId: string;
  provider: string;
}

export interface IndexResult {
  outcome: 'indexed' | 'unchanged' | 'acl_updated' | 'awaiting_parser';
  chunksEmbedded: number;
  chunksReused: number;
  /** Chunks stored without a vector because the embedding provider was down (backfilled later). */
  chunksPending: number;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function documentValues(target: IndexTarget, src: SourceDocument) {
  return {
    workspaceId: target.workspaceId,
    connectionId: target.connectionId,
    provider: target.provider,
    externalId: src.externalId,
    type: src.type,
    title: src.title,
    url: src.url,
    authorName: src.author?.name ?? null,
    authorEmail: src.author?.email?.toLowerCase() ?? null,
    container: src.container ?? null,
    mimeType: src.content.kind === 'file' ? src.content.mimeType : null,
    sourceCreatedAt: src.createdAt,
    sourceUpdatedAt: src.updatedAt,
    metadata: src.metadata ?? {},
    deletedAt: null,
  };
}

/**
 * Indexes one document: normalize → chunk → embed → store.
 *
 * - Unchanged text (same text hash) → nothing is re-embedded; only metadata and, if it changed,
 *   the access list are updated (fix C2).
 * - Changed text → only chunks whose exact text is new are embedded; the rest reuse their
 *   existing vectors (fix C3).
 * - Embedding happens before the transaction (it's a slow network call); the document, its
 *   access list and its chunks are then replaced in a single transaction, so search never sees
 *   a half-indexed document.
 */
export async function indexDocument(
  db: Db,
  embedder: Embedder,
  target: IndexTarget,
  src: SourceDocument,
  signal?: AbortSignal,
): Promise<IndexResult> {
  const acl = normalizeAcl(src.acl);
  const result: IndexResult = {
    outcome: 'indexed',
    chunksEmbedded: 0,
    chunksReused: 0,
    chunksPending: 0,
  };

  const [existing] = await db
    .select({
      id: documents.id,
      textHash: documents.textHash,
      deletedAt: documents.deletedAt,
      indexStatus: documents.indexStatus,
    })
    .from(documents)
    .where(
      and(
        eq(documents.connectionId, target.connectionId),
        eq(documents.externalId, src.externalId),
      ),
    )
    .limit(1);

  // Binary files: store metadata now (searchable by title later); the parser fills in text in phase 4.
  if (src.content.kind === 'file') {
    await db
      .insert(documents)
      .values({ ...documentValues(target, src), indexStatus: 'awaiting_parser' })
      .onConflictDoUpdate({
        target: [documents.connectionId, documents.externalId],
        set: { ...documentValues(target, src), indexStatus: 'awaiting_parser' },
      });
    return { ...result, outcome: 'awaiting_parser' };
  }

  const text = normalizeText(src.content);
  const header = contextHeader(target.provider, src);
  const textHash = documentTextHash(header, text);

  if (
    existing &&
    existing.textHash === textHash &&
    !existing.deletedAt &&
    existing.indexStatus === 'indexed'
  ) {
    const current = await db
      .select({ principal: documentAcl.principal })
      .from(documentAcl)
      .where(eq(documentAcl.documentId, existing.id));
    const aclChanged = !sameList(current.map((r) => r.principal).sort(), acl);

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set(documentValues(target, src))
        .where(eq(documents.id, existing.id));
      await tx
        .update(chunks)
        .set({ sourceUpdatedAt: src.updatedAt, ...(aclChanged && { acl }) })
        .where(eq(chunks.documentId, existing.id));
      if (aclChanged) {
        await tx.delete(documentAcl).where(eq(documentAcl.documentId, existing.id));
        if (acl.length) {
          await tx.insert(documentAcl).values(
            acl.map((principal) => ({
              documentId: existing.id,
              workspaceId: target.workspaceId,
              principal,
            })),
          );
        }
      }
    });
    return { ...result, outcome: aclChanged ? 'acl_updated' : 'unchanged' };
  }

  // --- Text changed (or new): chunk, then reuse or create embeddings. ---
  const pieces = chunkText(text).map((c) => ({
    ...c,
    textHash: sha256(`${header}\n\n${c.content}`),
  }));

  const reusable = new Map<string, number[]>();
  if (pieces.length) {
    const rows = await db
      .select({ textHash: chunks.textHash, embedding: chunks.embedding })
      .from(chunks)
      .where(
        and(
          eq(chunks.workspaceId, target.workspaceId),
          eq(chunks.embeddingModel, embedder.model),
          isNotNull(chunks.embedding),
          inArray(chunks.textHash, [...new Set(pieces.map((p) => p.textHash))]),
        ),
      );
    for (const r of rows) if (r.embedding) reusable.set(r.textHash, r.embedding);
  }

  const toEmbed = pieces.filter((p) => !reusable.has(p.textHash));
  const fresh = new Map<string, number[]>();
  if (toEmbed.length) {
    try {
      const vectors = await embedder.embed(
        toEmbed.map((p) => `${header}\n\n${p.content}`),
        { purpose: 'document', ...(signal && { signal }) },
      );
      toEmbed.forEach((p, i) => fresh.set(p.textHash, vectors[i]!));
    } catch (err) {
      // Provider down: store chunks without vectors. Keyword search still finds them, and the
      // backfill job adds vectors later (design 8.6).
      if (!(err instanceof EmbeddingUnavailableError)) throw err;
    }
  }

  const values = pieces.map((p) => {
    const embedding = reusable.get(p.textHash) ?? fresh.get(p.textHash) ?? null;
    if (reusable.has(p.textHash)) result.chunksReused++;
    else if (embedding) result.chunksEmbedded++;
    else result.chunksPending++;
    return {
      workspaceId: target.workspaceId,
      chunkIndex: p.index,
      contextHeader: header,
      content: p.content,
      tokenCount: p.tokenCount,
      textHash: p.textHash,
      embedding,
      embeddingModel: embedding ? embedder.model : null,
      acl,
      provider: target.provider,
      docType: src.type,
      sourceUpdatedAt: src.updatedAt,
    };
  });

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        ...documentValues(target, src),
        textHash,
        indexStatus: 'indexed',
        indexedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [documents.connectionId, documents.externalId],
        set: {
          ...documentValues(target, src),
          textHash,
          indexStatus: 'indexed',
          indexedAt: new Date(),
        },
      })
      .returning({ id: documents.id });
    const documentId = doc!.id;

    await tx.delete(documentAcl).where(eq(documentAcl.documentId, documentId));
    if (acl.length) {
      await tx
        .insert(documentAcl)
        .values(
          acl.map((principal) => ({ documentId, workspaceId: target.workspaceId, principal })),
        );
    }
    await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    if (values.length) await tx.insert(chunks).values(values.map((v) => ({ ...v, documentId })));
  });

  return result;
}

/** Soft-deletes documents removed at the source; a nightly job hard-deletes them later. */
export async function softDeleteDocuments(
  db: Db,
  connectionId: string,
  externalIds: string[],
): Promise<number> {
  if (!externalIds.length) return 0;
  const now = new Date();
  return db.transaction(async (tx) => {
    const deleted = await tx
      .update(documents)
      .set({ deletedAt: now })
      .where(
        and(
          eq(documents.connectionId, connectionId),
          inArray(documents.externalId, externalIds),
          isNull(documents.deletedAt),
        ),
      )
      .returning({ id: documents.id });
    if (deleted.length) {
      await tx
        .update(chunks)
        .set({ deletedAt: now })
        .where(
          inArray(
            chunks.documentId,
            deleted.map((d) => d.id),
          ),
        );
    }
    return deleted.length;
  });
}

/**
 * Adds vectors to chunks that have none (provider outage, used-up quota) or that were embedded by
 * a different model (after switching models). Returns how many it filled in this call.
 */
export async function backfillEmbeddings(
  db: Db,
  embedder: Embedder,
  opts: { workspaceId?: string; limit?: number } = {},
): Promise<number> {
  const pending = await db
    .select({ id: chunks.id, header: chunks.contextHeader, content: chunks.content })
    .from(chunks)
    .where(
      and(
        or(isNull(chunks.embedding), ne(chunks.embeddingModel, embedder.model)),
        isNull(chunks.deletedAt),
        opts.workspaceId ? eq(chunks.workspaceId, opts.workspaceId) : undefined,
      ),
    )
    .limit(opts.limit ?? 500);
  if (!pending.length) return 0;

  const vectors = await embedder.embed(
    pending.map((c) => `${c.header}\n\n${c.content}`),
    { purpose: 'document' },
  );
  await db.transaction(async (tx) => {
    for (const [i, c] of pending.entries()) {
      await tx
        .update(chunks)
        .set({ embedding: vectors[i]!, embeddingModel: embedder.model })
        .where(eq(chunks.id, c.id));
    }
  });
  return pending.length;
}
