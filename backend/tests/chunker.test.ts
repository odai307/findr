import { describe, expect, it } from 'vitest';
import { chunkText, countTokens } from '../src/ingestion/chunker.js';

const sentence = (i: number) =>
  `Sentence number ${i} talks about delivery routes, warehouses and dispatch schedules. `;
const paragraph = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => sentence(from + i)).join('');

describe('chunkText', () => {
  it('keeps a short document in one chunk', () => {
    const chunks = chunkText('Hello Lena,\n\nWe confirm delivery on March 15.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain('March 15');
    expect(chunks[0]!.index).toBe(0);
  });

  it('never exceeds the max token count', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i * 20, 20)).join('\n\n');
    const chunks = chunkText(text, { target: 120, max: 160, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(160);
      expect(c.tokenCount).toBe(countTokens(c.content));
    }
  });

  it('does not cut sentences in half', () => {
    const text = paragraph(0, 60);
    for (const c of chunkText(text, { target: 100, max: 140, overlap: 0 })) {
      expect(c.content.trim()).toMatch(/schedules\.$/);
    }
  });

  it('overlaps consecutive prose chunks', () => {
    const text = paragraph(0, 40);
    const [first, second] = chunkText(text, { target: 100, max: 140, overlap: 30 });
    const lastSentenceOfFirst = first!.content.trim().split('. ').at(-1)!;
    expect(second!.content).toContain(lastSentenceOfFirst.replace(/\.$/, ''));
  });

  it('starts a new chunk at a heading and repeats the heading when a section continues', () => {
    const text = `# Plan\n\n## Goal\n\n${paragraph(0, 25)}\n\n${paragraph(100, 25)}\n\n## Risks\n\nThe dataset may arrive late.`;
    const chunks = chunkText(text, { target: 150, max: 200, overlap: 0 });
    const risks = chunks.find((c) => c.content.includes('## Risks'))!;
    expect(risks.content).toContain('dataset may arrive late');
    // A chunk in the middle of "Goal" still says which section it belongs to.
    const continuation = chunks.filter((c) => c.content.includes('Sentence number 110'));
    expect(continuation.every((c) => c.content.startsWith('## Goal'))).toBe(true);
  });

  it('keeps a small table whole', () => {
    const table =
      '| Milestone | Date |\n| --- | --- |\n| API freeze | 2026-02-27 |\n| Delivery | 2026-03-15 |';
    const chunks = chunkText(`Intro.\n\n${table}`);
    expect(chunks[0]!.content).toContain(table);
  });

  it('splits a large table by rows and repeats the header row', () => {
    const rows = Array.from(
      { length: 80 },
      (_, i) =>
        `| Task ${i} for the routing service | Owner ${i} | 2026-03-${String((i % 28) + 1).padStart(2, '0')} |`,
    );
    const table = ['| Task | Owner | Due |', '| --- | --- | --- |', ...rows].join('\n');
    const chunks = chunkText(table, { target: 150, max: 200, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.content.startsWith('| Task | Owner | Due |\n| --- | --- | --- |')).toBe(true);
      expect(c.tokenCount).toBeLessThanOrEqual(200);
    }
    // Every row appears exactly once across the pieces.
    const all = chunks.map((c) => c.content).join('\n');
    for (const r of rows) expect(all.split(r).length - 1).toBe(1);
  });

  it('cuts a single enormous sentence on token boundaries as a last resort', () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(words, { target: 100, max: 150, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(150);
  });

  it('returns nothing for empty text', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});
