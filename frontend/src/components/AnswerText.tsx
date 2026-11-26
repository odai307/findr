import type { ReactNode } from 'react';
import type { Citation } from '../lib/api';
import { safeUrl } from '../lib/safe-url';
import { CitationChip } from './CitationChip';

/**
 * Renders an AI answer safely (fix S1). It understands only a tiny Markdown subset — paragraphs,
 * bullet/numbered lists, **bold**, [n] citations and [label](url) links — and builds React
 * elements, never HTML. Images are never rendered, so an injected `![](https://evil…)` can't
 * make the browser send data anywhere. A link is clickable only if its URL belongs to a cited
 * source; otherwise just its label is shown. This also holds while the answer is still streaming.
 */
export function AnswerText({
  text,
  citations,
  streaming = false,
}: {
  text: string;
  citations: Citation[];
  streaming?: boolean;
}) {
  const clean = text.replace(/!\[[^\]]*\]\([^)]*\)?/g, '').replace(/<img\b[^>]*>?/gi, '');
  const blocks = clean.split(/\n\s*\n/).filter((b) => b.trim());
  const allowedUrls = new Set(citations.map((c) => safeUrl(c.url)).filter(Boolean));
  const byNumber = new Map(citations.map((c) => [c.n, c]));

  const inline = (line: string, key: string): ReactNode[] =>
    line
      .split(/(\*\*[^*]+\*\*|\[\d{1,3}\]|\[[^\]]+\]\([^)\s]+\))/g)
      .filter(Boolean)
      .map((part, i) => {
        const k = `${key}-${i}`;
        const cite = /^\[(\d{1,3})\]$/.exec(part);
        if (cite) {
          const c = byNumber.get(Number(cite[1]));
          if (c) return <CitationChip key={k} citation={c} />;
          // Numbers are only known once the answer is complete.
          return streaming ? (
            <sup key={k} className="text-xs text-muted">
              {part}
            </sup>
          ) : null;
        }
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link) {
          const url = safeUrl(link[2]);
          return url && allowedUrls.has(url) ? (
            <a key={k} href={url} target="_blank" rel="noreferrer noopener" className="underline">
              {link[1]}
            </a>
          ) : (
            <span key={k}>{link[1]}</span>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={k}>{part.slice(2, -2)}</strong>;
        }
        return <span key={k}>{part}</span>;
      });

  return (
    <div className="flex flex-col gap-3 leading-relaxed">
      {blocks.map((block, b) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
        if (lines.length && lines.every((l) => bullet.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]!);
          const items = lines.map((l, i) => (
            <li key={i}>{inline(l.replace(bullet, ''), `${b}-${i}`)}</li>
          ));
          return ordered ? (
            <ol key={b} className="list-decimal space-y-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={b} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={b}>
            {lines.flatMap((l, i) => [
              ...(i ? [<br key={`br${i}`} />] : []),
              ...inline(l, `${b}-${i}`),
            ])}
          </p>
        );
      })}
      {streaming && <span className="inline-block h-4 w-2 animate-pulse bg-muted" aria-hidden />}
    </div>
  );
}
