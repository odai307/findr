import { describe, expect, it } from 'vitest';
import { mergeFilters, parseQuery } from '../src/search/query-parser.js';
import {
  diversify,
  groupResults,
  makeSnippet,
  queryTerms,
  rankChunks,
  recencyBoost,
  titleBoost,
  type RankedChunk,
  type SearchResult,
} from '../src/search/ranking.js';

describe('parseQuery', () => {
  it('pulls filters out of the text', () => {
    const p = parseQuery('budget source:gmail type:email from:esi after:2026-01-01 before:2026-03');
    expect(p.text).toBe('budget');
    expect(p.filters).toEqual({
      sources: ['gmail'],
      types: ['email'],
      from: 'esi',
      after: new Date('2026-01-01T00:00:00Z'),
      before: new Date('2026-03-01T00:00:00Z'),
    });
  });

  it('supports quoted values, # channels and aliases', () => {
    const p = parseQuery('plan in:"Projects/Alpha" source:drive type:doc in:#sales');
    expect(p.text).toBe('plan');
    expect(p.filters).toMatchObject({ sources: ['gdrive'], types: ['page'], in: 'sales' });
  });

  it('leaves unknown keys and invalid dates in the text', () => {
    const p = parseQuery('error code:500 after:yesterday https://example.com');
    expect(p.text).toBe('error code:500 after:yesterday https://example.com');
    expect(p.filters).toEqual({});
  });

  it('lets API fields override typed filters', () => {
    const merged = mergeFilters(
      { types: ['email'], from: 'ama' },
      { types: ['page'], sources: [] },
    );
    expect(merged).toEqual({ types: ['page'], from: 'ama' });
  });
});

const chunk = (over: Partial<RankedChunk>): RankedChunk => ({
  chunkId: Math.random().toString(36),
  documentId: 'd1',
  content: 'text',
  contextHeader: 'h',
  textHash: Math.random().toString(36),
  score: 0.03,
  keywordRank: 1,
  vectorRank: 1,
  title: 'Doc',
  url: null,
  provider: 'demo',
  type: 'page',
  author: null,
  container: null,
  updatedAt: null,
  ...over,
});

describe('ranking', () => {
  const now = new Date('2026-03-15T00:00:00Z');

  it('drops stopwords from highlight terms', () => {
    expect(queryTerms('When is the Alpha delivery?')).toEqual(['alpha', 'delivery']);
  });

  it('boosts recent documents by up to 15%', () => {
    expect(recencyBoost(1, now, now)).toBeCloseTo(1.15);
    expect(recencyBoost(1, new Date('2025-03-15'), now)).toBeLessThan(1.01);
    expect(recencyBoost(1, null, now)).toBe(1);
  });

  it('boosts titles containing every query term', () => {
    expect(titleBoost(1, 'Project Alpha – Plan', ['alpha', 'plan'])).toBeCloseTo(1.1);
    expect(titleBoost(1, 'Project Alpha', ['alpha', 'budget'])).toBe(1);
  });

  it('snippets show the matched part of long text', () => {
    const text = `${'filler words here. '.repeat(40)}The delivery is on March 15. ${'more filler. '.repeat(40)}`;
    const s = makeSnippet(text, ['delivery']);
    expect(s).toContain('delivery is on March 15');
    expect(s.startsWith('…')).toBe(true);
  });

  it('re-sorts chunks after boosts', () => {
    const ranked = rankChunks(
      [
        chunk({ chunkId: 'old', score: 0.0325, updatedAt: new Date('2024-01-01') }),
        chunk({ chunkId: 'new', score: 0.031, updatedAt: now }),
      ],
      'anything',
      now,
    );
    expect(ranked.map((c) => c.chunkId)).toEqual(['new', 'old']);
  });

  it('groups up to 3 chunks per document and collapses duplicate text', () => {
    const results = groupResults(
      [
        chunk({ documentId: 'a', content: 'one', score: 0.05 }),
        chunk({ documentId: 'a', content: 'two', score: 0.04 }),
        chunk({ documentId: 'a', content: 'three', score: 0.03 }),
        chunk({ documentId: 'a', content: 'four', score: 0.02 }),
        chunk({ documentId: 'b', content: 'copy', textHash: 'same', score: 0.02 }),
        chunk({ documentId: 'c', content: 'copy', textHash: 'same', score: 0.01 }),
      ],
      'q',
      10,
    );
    expect(results.map((r) => r.documentId)).toEqual(['a', 'b']);
    expect(results[0]!.snippets).toEqual(['one', 'two', 'three']);
  });

  it('keeps one source to half the page when others have results', () => {
    const doc = (id: string, provider: string, score: number) =>
      ({ documentId: id, provider, score }) as SearchResult;
    const docs = [
      doc('g1', 'gmail', 9),
      doc('g2', 'gmail', 8),
      doc('g3', 'gmail', 7),
      doc('s1', 'slack', 1),
    ];
    expect(diversify(docs, 4).map((d) => d.documentId)).toEqual(['g1', 'g2', 'g3', 's1']);
    expect(diversify(docs, 2).map((d) => d.documentId)).toEqual(['g1', 's1']);
  });
});
