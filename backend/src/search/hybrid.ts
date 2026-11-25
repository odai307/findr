import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { Embedder } from '../ingestion/embedder.js';
import type { SearchFilters } from './query-parser.js';
import { groupResults, rankChunks, type RankedChunk, type SearchResult } from './ranking.js';

/**
 * Hybrid search (design §9.3 with fixes Q1, Q4): keyword and vector search each take their top 50
 * chunks — with permissions, deleted documents and filters applied BEFORE the limit — and
 * Reciprocal Rank Fusion merges the two lists by rank position, so their different score scales
 * never need to be compared. One SQL round trip.
 */

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';

export interface HybridSearchOptions {
  workspaceId: string;
  principals: string[];
  /** Query text with filter syntax already removed. */
  text: string;
  filters: SearchFilters;
  mode: SearchMode;
  /** Documents to return. */
  limit: number;
}

export interface HybridSearchResponse {
  results: SearchResult[];
  /** Best chunks overall (not grouped), for building AI answers. */
  chunks: RankedChunk[];
  /** True when meaning search was unavailable and only keyword search ran. */
  degraded: boolean;
}

const CANDIDATES = 50;
const RRF_K = 60;
/** A search never waits longer than this for the query's embedding; it falls back to keywords. */
const QUERY_EMBED_TIMEOUT_MS = 4000;

const textArray = (values: string[]) =>
  sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

const likePattern = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Conditions shared by both halves of the query, applied before each LIMIT (fix Q1). */
function chunkFilters(o: HybridSearchOptions): SQL {
  const f = o.filters;
  const parts: SQL[] = [
    sql`c.workspace_id = ${o.workspaceId}`,
    sql`c.deleted_at IS NULL`,
    sql`c.acl && ${textArray(o.principals)}`,
  ];
  if (f.sources?.length) parts.push(sql`c.provider = ANY(${textArray(f.sources)})`);
  if (f.types?.length) parts.push(sql`c.doc_type = ANY(${textArray(f.types)})`);
  if (f.after) parts.push(sql`c.source_updated_at >= ${f.after.toISOString()}::timestamptz`);
  if (f.before) parts.push(sql`c.source_updated_at < ${f.before.toISOString()}::timestamptz`);
  if (f.from) {
    parts.push(sql`EXISTS (SELECT 1 FROM documents d WHERE d.id = c.document_id
      AND (d.author_name ILIKE ${likePattern(f.from)} OR d.author_email ILIKE ${likePattern(f.from)}))`);
  }
  if (f.in) {
    parts.push(sql`EXISTS (SELECT 1 FROM documents d WHERE d.id = c.document_id
      AND d.container ILIKE ${likePattern(f.in)})`);
  }
  return sql.join(parts, sql` AND `);
}

// --- Query embedding cache: the same question shouldn't spend free-tier quota twice. ---
const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 500;
const queryCache = new Map<string, { vector: number[]; at: number }>();

async function embedQuery(embedder: Embedder, text: string): Promise<number[] | null> {
  const key = createHash('sha256').update(`${embedder.model}\n${text}`).digest('hex');
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.vector;
  try {
    const [vector] = await embedder.embed([text], {
      purpose: 'query',
      signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
    });
    if (!vector || vector.every((x) => x === 0)) return null;
    if (queryCache.size >= CACHE_MAX) queryCache.delete(queryCache.keys().next().value!);
    queryCache.set(key, { vector, at: Date.now() });
    return vector;
  } catch {
    return null;
  }
}

interface Row extends Record<string, unknown> {
  chunk_id: string;
  document_id: string;
  content: string;
  context_header: string;
  text_hash: string;
  score: number | string;
  kw_rank: number | string | null;
  vec_rank: number | string | null;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author_name: string | null;
  container: string | null;
  source_updated_at: Date | string | null;
}

export async function hybridSearch(
  db: Db,
  embedder: Embedder,
  opts: HybridSearchOptions,
): Promise<HybridSearchResponse> {
  if (!opts.principals.length) return { results: [], chunks: [], degraded: false };
  const where = chunkFilters(opts);
  const hasText = opts.text.trim().length > 0;

  const wantVector = hasText && opts.mode !== 'keyword';
  const wantKeyword = opts.mode !== 'semantic' || !hasText;
  const vector = wantVector ? await embedQuery(embedder, opts.text) : null;
  const degraded = wantVector && vector === null;

  // With no words at all (only filters), "keyword" lists the newest matching chunks.
  const kw =
    !wantKeyword && !degraded
      ? sql`SELECT NULL::uuid AS id, NULL::bigint AS rnk WHERE false`
      : hasText
        ? sql`SELECT id, row_number() OVER (ORDER BY s DESC) AS rnk FROM (
          SELECT c.id, ts_rank_cd(c.tsv, q) AS s
          FROM chunks c, websearch_to_tsquery('english', ${opts.text}) q
          WHERE ${where} AND c.tsv @@ q
          ORDER BY s DESC LIMIT ${CANDIDATES}) k`
        : sql`SELECT id, row_number() OVER (ORDER BY t DESC NULLS LAST) AS rnk FROM (
          SELECT c.id, c.source_updated_at AS t FROM chunks c
          WHERE ${where}
          ORDER BY t DESC NULLS LAST LIMIT ${CANDIDATES}) k`;

  const vec = vector
    ? sql`SELECT id, row_number() OVER (ORDER BY dist) AS rnk FROM (
        SELECT c.id, c.embedding <=> ${`[${vector.join(',')}]`}::halfvec AS dist
        FROM chunks c
        WHERE ${where} AND c.embedding IS NOT NULL AND c.embedding_model = ${embedder.model}
        ORDER BY dist LIMIT ${CANDIDATES}) v`
    : sql`SELECT NULL::uuid AS id, NULL::bigint AS rnk WHERE false`;

  const result = await db.execute<Row>(sql`
    WITH kw AS (${kw}), vec AS (${vec}),
    fused AS (
      SELECT id,
             SUM(1.0 / (${RRF_K} + rnk)) AS score,
             MIN(CASE WHEN src = 'kw' THEN rnk END) AS kw_rank,
             MIN(CASE WHEN src = 'vec' THEN rnk END) AS vec_rank
      FROM (SELECT id, rnk, 'kw' AS src FROM kw UNION ALL SELECT id, rnk, 'vec' AS src FROM vec) r
      GROUP BY id
    )
    SELECT c.id AS chunk_id, c.document_id, c.content, c.context_header, c.text_hash,
           f.score, f.kw_rank, f.vec_rank,
           d.title, d.url, d.provider, d.type, d.author_name, d.container, d.source_updated_at
    FROM fused f
    JOIN chunks c ON c.id = f.id
    JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    ORDER BY f.score DESC
    LIMIT ${CANDIDATES * 2}`);

  const rows = (Array.isArray(result) ? result : (result as { rows: Row[] }).rows) as Row[];
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  const chunks: RankedChunk[] = rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    content: r.content,
    contextHeader: r.context_header,
    textHash: r.text_hash,
    score: Number(r.score),
    keywordRank: num(r.kw_rank),
    vectorRank: num(r.vec_rank),
    title: r.title,
    url: r.url,
    provider: r.provider,
    type: r.type,
    author: r.author_name,
    container: r.container,
    updatedAt: r.source_updated_at ? new Date(r.source_updated_at) : null,
  }));

  const ranked = rankChunks(chunks, opts.text);
  return { results: groupResults(ranked, opts.text, opts.limit), chunks: ranked, degraded };
}
