import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { Embedder } from '../ingestion/embedder.js';

/**
 * Phase 1 search: keyword OR meaning, one at a time, so each can be checked on its own.
 * Phase 2 replaces this with the hybrid query (both combined with Reciprocal Rank Fusion).
 *
 * Permissions are enforced inside the SQL (`acl && principals`), never filtered afterwards.
 */

export type SearchMode = 'keyword' | 'semantic';

export interface SearchHit {
  documentId: string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  container: string | null;
  updatedAt: Date | null;
  snippet: string;
  score: number;
}

const CANDIDATES = 50;

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

function snippet(content: string, max = 280): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

interface Row extends Record<string, unknown> {
  document_id: string;
  content: string;
  score: number | string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author_name: string | null;
  container: string | null;
  source_updated_at: Date | string | null;
}

export async function basicSearch(
  db: Db,
  embedder: Embedder,
  opts: {
    workspaceId: string;
    principals: string[];
    query: string;
    mode: SearchMode;
    limit: number;
  },
): Promise<SearchHit[]> {
  if (!opts.principals.length) return [];
  // Each principal is a bound parameter, never spliced into the SQL text.
  const principals = sql`ARRAY[${sql.join(
    opts.principals.map((p) => sql`${p}`),
    sql`, `,
  )}]::text[]`;
  let candidates;

  if (opts.mode === 'keyword') {
    candidates = sql`
      SELECT c.document_id, c.content, ts_rank_cd(c.tsv, q) AS score
      FROM chunks c, websearch_to_tsquery('english', ${opts.query}) q
      WHERE c.workspace_id = ${opts.workspaceId}
        AND c.deleted_at IS NULL
        AND c.acl && ${principals}
        AND c.tsv @@ q
      ORDER BY score DESC
      LIMIT ${CANDIDATES}`;
  } else {
    const [vector] = await embedder.embed([opts.query]);
    if (!vector || vector.every((x) => x === 0)) return [];
    candidates = sql`
      SELECT c.document_id, c.content, 1 - (c.embedding <=> ${toVectorLiteral(vector)}::halfvec) AS score
      FROM chunks c
      WHERE c.workspace_id = ${opts.workspaceId}
        AND c.deleted_at IS NULL
        AND c.embedding IS NOT NULL
        AND c.embedding_model = ${embedder.model}
        AND c.acl && ${principals}
      ORDER BY c.embedding <=> ${toVectorLiteral(vector)}::halfvec
      LIMIT ${CANDIDATES}`;
  }

  // Best chunk per document, then the top documents.
  const result = await db.execute<Row>(sql`
    WITH candidates AS (${candidates}),
    best AS (
      SELECT DISTINCT ON (document_id) document_id, content, score
      FROM candidates
      ORDER BY document_id, score DESC
    )
    SELECT b.document_id, b.content, b.score, d.title, d.url, d.provider, d.type,
           d.author_name, d.container, d.source_updated_at
    FROM best b
    JOIN documents d ON d.id = b.document_id AND d.deleted_at IS NULL
    ORDER BY b.score DESC
    LIMIT ${opts.limit}`);

  const rows = (Array.isArray(result) ? result : (result as { rows: Row[] }).rows) as Row[];
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    url: r.url,
    provider: r.provider,
    type: r.type,
    author: r.author_name,
    container: r.container,
    updatedAt: r.source_updated_at ? new Date(r.source_updated_at) : null,
    snippet: snippet(r.content),
    score: Number(r.score),
  }));
}
