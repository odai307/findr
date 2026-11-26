import { useId } from 'react';
import type { Citation } from '../lib/api';
import { safeUrl } from '../lib/safe-url';

const providerLabel: Record<string, string> = {
  demo: 'Demo',
  gmail: 'Gmail',
  gdrive: 'Drive',
  slack: 'Slack',
  notion: 'Notion',
  github: 'GitHub',
};

/** A [n] marker in an answer. Hovering or focusing it shows the source: title, where, when, snippet. */
export function CitationChip({ citation }: { citation: Citation }) {
  const id = useId();
  return (
    <span className="group relative inline-block align-super">
      <a
        href={safeUrl(citation.url)}
        target="_blank"
        rel="noreferrer noopener"
        aria-describedby={id}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-800 hover:bg-blue-200 focus:outline-2 focus:outline-blue-500 dark:bg-blue-950 dark:text-blue-300"
      >
        {citation.n}
      </a>
      <span
        id={id}
        role="tooltip"
        className="invisible absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-3 text-left text-xs leading-snug text-zinc-700 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        <span className="block font-semibold text-zinc-900 dark:text-zinc-100">
          {citation.title ?? 'Untitled'}
        </span>
        <span className="mt-0.5 block text-zinc-500">
          {[
            providerLabel[citation.provider] ?? citation.provider,
            citation.type.replace('_', ' '),
            citation.author,
            citation.updatedAt && new Date(citation.updatedAt).toLocaleDateString(),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="mt-1.5 block">{citation.snippet}…</span>
        {safeUrl(citation.url) && (
          <span className="mt-1.5 block text-blue-700 dark:text-blue-400">Open in app ↗</span>
        )}
      </span>
    </span>
  );
}
