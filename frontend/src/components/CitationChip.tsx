import { useId } from 'react';
import { providerLabel, type Citation } from '../lib/api';
import { safeUrl } from '../lib/safe-url';

/** A [n] marker in an answer. Hovering or focusing it shows the source: title, where, when, snippet. */
export function CitationChip({ citation }: { citation: Citation }) {
  const id = useId();
  const url = safeUrl(citation.url);
  return (
    <span className="group relative inline-block align-super">
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        aria-describedby={id}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent no-underline hover:bg-accent hover:text-accent-fg"
      >
        {citation.n}
      </a>
      <span
        id={id}
        role="tooltip"
        className="invisible absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-left text-xs leading-snug text-muted opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <span className="block font-semibold text-fg">{citation.title ?? 'Untitled'}</span>
        <span className="mt-0.5 block">
          {[
            providerLabel[citation.provider] ?? citation.provider,
            citation.type.replace('_', ' '),
            citation.author,
            citation.updatedAt && new Date(citation.updatedAt).toLocaleDateString(),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="mt-1.5 block text-fg">{citation.snippet}…</span>
        {url && <span className="mt-1.5 block font-medium text-accent">Open in app ↗</span>}
      </span>
    </span>
  );
}
