import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, type SearchHit, type SearchMode } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

/**
 * Phase 1 search: keyword or meaning, one at a time, so each can be checked on its own.
 * Phase 2 merges both into one hybrid search and adds filters.
 */
export function SearchPage() {
  const { workspace } = useWorkspace();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [query, setQuery] = useState('');

  const results = useQuery({
    queryKey: ['search', workspace.id, mode, query],
    enabled: query.length > 0,
    queryFn: () =>
      api<{ data: SearchHit[]; tookMs: number }>(`/v1/workspaces/${workspace.id}/search`, {
        method: 'POST',
        body: JSON.stringify({ query, mode }),
      }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setQuery(input.trim());
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search your apps, e.g. Project Alpha delivery date"
          aria-label="Search"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div
          role="radiogroup"
          aria-label="Search mode"
          className="flex rounded-md border border-zinc-300 p-0.5 text-sm dark:border-zinc-700"
        >
          {(['hybrid', 'keyword', 'semantic'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 ${
                mode === m
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {m === 'hybrid' ? 'Best' : m === 'keyword' ? 'Keyword' : 'Meaning'}
            </button>
          ))}
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          Search
        </button>
      </form>

      <div className="mt-6" aria-live="polite">
        {!query && (
          <p className="text-sm text-zinc-500">
            Nothing indexed yet? Add the demo data on the{' '}
            <Link to="/connections" className="underline">
              Connections
            </Link>{' '}
            page.
          </p>
        )}
        {results.isFetching && <p className="text-sm text-zinc-500">Searching…</p>}
        {results.isError && <p className="text-sm text-red-600">Search failed. Try again.</p>}
        {results.data && !results.isFetching && (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              {results.data.data.length} results in {results.data.tookMs} ms
            </p>
            {results.data.data.length === 0 && (
              <p className="text-sm text-zinc-500">
                No results. Try other words or the other mode.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {results.data.data.map((hit) => (
                <li
                  key={hit.documentId}
                  className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium uppercase dark:bg-zinc-800">
                      {hit.provider}
                    </span>
                    <span>{hit.type.replace('_', ' ')}</span>
                    {hit.container && <span>· {hit.container}</span>}
                    {hit.author && <span>· {hit.author}</span>}
                    {hit.updatedAt && <span>· {new Date(hit.updatedAt).toLocaleDateString()}</span>}
                  </div>
                  <h3 className="mt-1 font-medium">
                    {hit.url ? (
                      <a
                        href={hit.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                      >
                        {hit.title ?? 'Untitled'}
                      </a>
                    ) : (
                      (hit.title ?? 'Untitled')
                    )}
                  </h3>
                  {/* Rendered as plain text: indexed content is never trusted as HTML. */}
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{hit.snippets[0]}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
