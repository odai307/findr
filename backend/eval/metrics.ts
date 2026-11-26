/**
 * Retrieval metrics with binary relevance:
 * - Recall@k: share of the relevant documents that appear in the top k.
 * - Reciprocal rank: 1 / position of the first relevant document (0 if none); averaged → MRR.
 * - nDCG@k: rewards relevant documents near the top, normalized to 1 for a perfect ranking.
 */
export function scoreRanking(ranked: string[], relevant: string[], k = 10) {
  const top = ranked.slice(0, k);
  const hits = top.filter((id) => relevant.includes(id)).length;
  const firstHit = ranked.findIndex((id) => relevant.includes(id));
  const dcg = top.reduce((s, id, i) => s + (relevant.includes(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = relevant.slice(0, k).reduce((s, _id, i) => s + 1 / Math.log2(i + 2), 0);
  return {
    recall: relevant.length ? hits / relevant.length : 0,
    rr: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    ndcg: idcg ? dcg / idcg : 0,
  };
}
