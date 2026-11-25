/**
 * Ranking adjustments applied after the SQL query (design §9.4). Pure functions, so they are easy
 * to test and to tune with the evaluation set.
 */

/** One chunk returned by the hybrid SQL query, with its fused (RRF) score. */
export interface RankedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  contextHeader: string;
  textHash: string;
  /** Reciprocal Rank Fusion score from SQL. */
  score: number;
  keywordRank: number | null;
  vectorRank: number | null;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  container: string | null;
  updatedAt: Date | null;
}

export interface SearchResult {
  documentId: string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  container: string | null;
  updatedAt: Date | null;
  /** Up to 3 snippets (plain text; the UI highlights `matchedTerms`). */
  snippets: string[];
  matchedTerms: string[];
  score: number;
}

const STOPWORDS = new Set(
  'a an and are as at be but by can did do does for from has have how i in is it its me my of on or our so than that the their there they this to was we were what when where which who why will with you your'.split(
    ' ',
  ),
);

/** Words worth highlighting: lowercase, 2+ characters, not stopwords. */
export function queryTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w)))];
}

/** Score × (1 + 0.15 · e^(−age/90 days)): recent documents get up to 15% more. */
export function recencyBoost(score: number, updatedAt: Date | null, now = new Date()): number {
  if (!updatedAt) return score;
  const ageDays = Math.max(0, (now.getTime() - updatedAt.getTime()) / 86_400_000);
  return score * (1 + 0.15 * Math.exp(-ageDays / 90));
}

/** +10% when every query term appears in the title. */
export function titleBoost(score: number, title: string | null, terms: string[]): number {
  if (!title || !terms.length) return score;
  const t = title.toLowerCase();
  return terms.every((term) => t.includes(term)) ? score * 1.1 : score;
}

/** A window of the text around the first matched term, so the snippet shows why it matched. */
export function makeSnippet(content: string, terms: string[], max = 280): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(first - 60, flat.length - max));
  const slice = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice}${start + max < flat.length ? '…' : ''}`;
}

/** Applies the per-chunk boosts and returns chunks sorted best first. */
export function rankChunks(
  chunks: RankedChunk[],
  queryText: string,
  now = new Date(),
): RankedChunk[] {
  const terms = queryTerms(queryText);
  return chunks
    .map((c) => ({
      ...c,
      score: titleBoost(recencyBoost(c.score, c.updatedAt, now), c.title, terms),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Groups ranked chunks into documents: at most 3 chunks (snippets) per document, near-identical
 * chunks across documents collapsed (same text hash, e.g. one attachment in Gmail and Drive), and
 * no single source taking more than half of the results when other sources have matches.
 */
export function groupResults(
  ranked: RankedChunk[],
  queryText: string,
  limit: number,
): SearchResult[] {
  const terms = queryTerms(queryText);
  const seenHashes = new Set<string>();
  const byDoc = new Map<string, SearchResult & { chunkCount: number }>();

  for (const c of ranked) {
    if (seenHashes.has(c.textHash) && !byDoc.has(c.documentId)) continue;
    seenHashes.add(c.textHash);
    const existing = byDoc.get(c.documentId);
    if (existing) {
      if (existing.chunkCount < 3) {
        existing.snippets.push(makeSnippet(c.content, terms));
        existing.chunkCount++;
      }
      continue;
    }
    byDoc.set(c.documentId, {
      documentId: c.documentId,
      title: c.title,
      url: c.url,
      provider: c.provider,
      type: c.type,
      author: c.author,
      container: c.container,
      updatedAt: c.updatedAt,
      snippets: [makeSnippet(c.content, terms)],
      matchedTerms: terms,
      score: c.score,
      chunkCount: 1,
    });
  }

  const docs = [...byDoc.values()].map(({ chunkCount: _c, ...rest }) => rest);
  return diversify(docs, limit);
}

/** Keeps any one source to at most half of the results, if other sources can fill the rest. */
export function diversify(docs: SearchResult[], limit: number): SearchResult[] {
  const cap = Math.max(1, Math.ceil(limit / 2));
  const providers = new Set(docs.map((d) => d.provider));
  if (providers.size < 2) return docs.slice(0, limit);

  const picked: SearchResult[] = [];
  const overflow: SearchResult[] = [];
  const perProvider = new Map<string, number>();
  for (const d of docs) {
    const n = perProvider.get(d.provider) ?? 0;
    if (n < cap) {
      picked.push(d);
      perProvider.set(d.provider, n + 1);
    } else {
      overflow.push(d);
    }
    if (picked.length === limit) break;
  }
  // Not enough variety to fill the page: top up with the best of the rest.
  for (const d of overflow) {
    if (picked.length >= limit) break;
    picked.push(d);
  }
  return picked.sort((a, b) => b.score - a.score);
}
