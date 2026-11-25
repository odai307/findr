import { getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Splits a document into chunks of roughly `target` tokens (never more than `max`), counting
 * tokens with the embedding model's own tokenizer (cl100k_base for OpenAI's embedding models).
 *
 * Structure-aware: it splits between headings first, then paragraphs, then sentences, and only
 * cuts mid-sentence when a single sentence is longer than `max`. Tables stay whole when they
 * fit; a larger table is split by rows with its header repeated in every piece. Consecutive
 * prose chunks overlap by about `overlap` tokens so a fact on a boundary isn't lost.
 */

export interface ChunkOptions {
  target: number;
  max: number;
  overlap: number;
}

export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { target: 400, max: 512, overlap: 60 };

let encoder: Tiktoken | undefined;
function enc(): Tiktoken {
  encoder ??= getEncoding('cl100k_base');
  return encoder;
}

export function countTokens(text: string): number {
  return enc().encode(text).length;
}

type BlockKind = 'heading' | 'para' | 'table';
interface Block {
  kind: BlockKind;
  text: string;
  tokens: number;
}

function block(kind: BlockKind, text: string): Block {
  return { kind, text, tokens: countTokens(text) };
}

/** Splits Markdown-ish text into headings, tables and paragraphs. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let table: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(block('para', para.join('\n')));
    para = [];
  };
  const flushTable = () => {
    if (table.length) blocks.push(block('table', table.join('\n')));
    table = [];
  };

  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line)) {
      flushPara();
      table.push(line);
      continue;
    }
    flushTable();
    if (/^#{1,6}\s/.test(line)) {
      flushPara();
      blocks.push(block('heading', line.trim()));
    } else if (line.trim() === '') {
      flushPara();
    } else {
      para.push(line);
    }
  }
  flushPara();
  flushTable();
  return blocks;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function sentences(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment).filter((s) => s.trim() !== '');
}

/** Last resort for a single sentence longer than `max`: cut on token boundaries. */
function hardSplit(text: string, max: number): Block[] {
  const tokens = enc().encode(text);
  const out: Block[] = [];
  for (let i = 0; i < tokens.length; i += max) {
    out.push(
      block(
        'para',
        enc()
          .decode(tokens.slice(i, i + max))
          .trim(),
      ),
    );
  }
  return out;
}

/** Breaks one oversized block into pieces that each fit within `max`. */
function splitOversized(b: Block, max: number): Block[] {
  if (b.kind === 'table') {
    const [header = '', separator = '', ...rows] = b.text.split('\n');
    const head = separator.includes('---') ? `${header}\n${separator}` : header;
    const body = separator.includes('---') ? rows : [separator, ...rows].filter(Boolean);
    const pieces: Block[] = [];
    let current: string[] = [];
    for (const row of body) {
      const candidate = [head, ...current, row].join('\n');
      if (current.length && countTokens(candidate) > max) {
        pieces.push(block('table', [head, ...current].join('\n')));
        current = [];
      }
      current.push(row);
    }
    if (current.length) pieces.push(block('table', [head, ...current].join('\n')));
    return pieces.flatMap((p) => (p.tokens > max ? hardSplit(p.text, max) : [p]));
  }

  const out: Block[] = [];
  let current = '';
  for (const s of sentences(b.text)) {
    if (countTokens(s) > max) {
      if (current.trim()) out.push(block('para', current.trim()));
      current = '';
      out.push(...hardSplit(s, max));
      continue;
    }
    if (current && countTokens(current + s) > max) {
      out.push(block('para', current.trim()));
      current = '';
    }
    current += s;
  }
  if (current.trim()) out.push(block('para', current.trim()));
  return out;
}

/** The trailing sentences of a paragraph, up to `budget` tokens, to start the next chunk with. */
function overlapTail(b: Block | undefined, budget: number): string {
  if (!b || b.kind !== 'para' || budget <= 0) return '';
  const parts = sentences(b.text);
  let tail = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = parts[i]! + tail;
    if (countTokens(next) > budget) break;
    tail = next;
  }
  // Never repeat the whole paragraph; that would duplicate rather than overlap.
  return tail.trim() === b.text.trim() ? '' : tail.trim();
}

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const { target, max, overlap } = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  // Oversized paragraphs are cut to at most `target - overlap` tokens, leaving room for the
  // overlap tail carried into the next chunk. Tables may use the full `max`.
  const paraLimit = Math.max(1, Math.min(target, max - overlap));
  const blocks = parseBlocks(text).flatMap((b) =>
    b.tokens > max ? splitOversized(b, b.kind === 'table' ? max : paraLimit) : [b],
  );

  const chunks: string[] = [];
  // The chunk being built. It may start with carried-over context (the section heading and an
  // overlap tail); `fresh` becomes true once it also holds new content.
  let parts: string[] = [];
  let fresh = false;
  let lastBlock: Block | undefined;
  let heading: string | undefined;
  const size = () => countTokens(parts.join('\n\n'));

  const startNextChunk = (carryOverlap: boolean) => {
    chunks.push(parts.join('\n\n'));
    const tail = carryOverlap ? overlapTail(lastBlock, overlap) : '';
    // A chunk that continues a section starts with that section's heading, for context.
    parts = heading ? [heading] : [];
    if (tail) parts.push(tail);
    fresh = false;
  };

  for (const b of blocks) {
    if (b.kind === 'heading') {
      // A new section: close the current chunk if it already holds a good amount of text.
      if (fresh && size() >= target / 2) startNextChunk(false);
      // Context carried from the previous section is irrelevant to the new one.
      if (!fresh) parts = [];
      heading = b.text;
      parts.push(b.text);
      lastBlock = b;
      continue;
    }

    if (fresh && (size() + b.tokens + 2 > max || size() >= target)) {
      startNextChunk(b.kind === 'para' && lastBlock?.kind === 'para');
    }
    if (!fresh && size() + b.tokens + 2 > max) {
      // Not enough room for the carried context plus this block: keep only what fits.
      parts = heading && countTokens(heading) + b.tokens + 2 <= max ? [heading] : [];
    }
    parts.push(b.text);
    fresh = true;
    lastBlock = b;
  }
  if (parts.length && (fresh || chunks.length === 0)) chunks.push(parts.join('\n\n'));

  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((content, index) => ({ index, content, tokenCount: countTokens(content) }));
}
