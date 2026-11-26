import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { AnswerPanel } from '../components/AnswerPanel';
import { Highlight } from '../components/Highlight';
import { api, type Connection, type SearchFilters, type SearchResponse } from '../lib/api';
import { safeUrl } from '../lib/safe-url';
import { useAskStream } from '../lib/useAskStream';
import { useWorkspace } from '../lib/workspace';

const TYPES = [
  { value: '', label: 'All types' },
  { value: 'email', label: 'Emails' },
  { value: 'page', label: 'Docs' },
  { value: 'message_thread', label: 'Messages' },
];
const DATES = [
  { value: '', label: 'Any time' },
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last 12 months' },
];
const providerLabel: Record<string, string> = {
  demo: 'Demo',
  gmail: 'Gmail',
  gdrive: 'Drive',
  slack: 'Slack',
  notion: 'Notion',
  github: 'GitHub',
};

/** The date N days ago as YYYY-MM-DD, computed when a date chip is clicked. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function readAskPreference(): boolean {
  try {
    return localStorage.getItem('findr.askAi') !== 'off';
  } catch {
    return true;
  }
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
          : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

/** Remounts per workspace, so switching workspace starts a fresh search. */
export function SearchPage() {
  const { workspace } = useWorkspace();
  return <SearchView key={workspace.id} />;
}

function SearchView() {
  const { workspace } = useWorkspace();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [date, setDate] = useState({ value: '', after: '' });
  const [source, setSource] = useState('');
  const [askAi, setAskAi] = useState(readAskPreference);
  const { state: answer, ask, cancel, reset } = useAskStream(workspace.id);

  // Ctrl/Cmd+K focuses the search box (the header shortcut navigates here with focus: true).
  useEffect(() => {
    if ((location.state as { focus?: boolean } | null)?.focus) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location.state]);

  const connections = useQuery({
    queryKey: ['connections', workspace.id],
    queryFn: () => api<{ data: Connection[] }>(`/v1/workspaces/${workspace.id}/connections`),
  });
  const providers = [...new Set((connections.data?.data ?? []).map((c) => c.provider))];

  const filters: SearchFilters = {
    ...(type && { types: [type] }),
    ...(source && { sources: [source] }),
    ...(date.after && { after: date.after }),
  };

  const results = useQuery({
    queryKey: ['search', workspace.id, query, filters],
    enabled: query.length > 0,
    queryFn: () =>
      api<SearchResponse>(`/v1/workspaces/${workspace.id}/search`, {
        method: 'POST',
        body: JSON.stringify({ query, filters, limit: 20 }),
      }),
  });

  function run(q: string) {
    setInput(q);
    setQuery(q);
    if (askAi) void ask(q);
    else reset();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (q) run(q);
  }

  function pickDate(value: string) {
    setDate({ value, after: value ? daysAgo(Number(value)) : '' });
  }

  function toggleAsk(on: boolean) {
    setAskAi(on);
    try {
      localStorage.setItem('findr.askAi', on ? 'on' : 'off');
    } catch {
      // Not saved; the choice lasts for this visit.
    }
  }

  const typedFilters = results.data?.parsed.filters;
  const typedChips = typedFilters
    ? [
        ...(typedFilters.sources ?? []).map((s) => `source: ${providerLabel[s] ?? s}`),
        ...(typedFilters.types ?? []).map((t) => `type: ${t.replace('_', ' ')}`),
        ...(typedFilters.from ? [`from: ${typedFilters.from}`] : []),
        ...(typedFilters.in ? [`in: ${typedFilters.in}`] : []),
        ...(typedFilters.after ? [`after: ${typedFilters.after.slice(0, 10)}`] : []),
        ...(typedFilters.before ? [`before: ${typedFilters.before.slice(0, 10)}`] : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask or search, e.g. When is the Project Alpha delivery?"
            aria-label="Search"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={askAi} onChange={(e) => toggleAsk(e.target.checked)} />
            Ask AI (answers with sources)
          </label>
          <span>
            Filters you can type: <code>source:demo</code> <code>type:email</code>{' '}
            <code>from:esi</code> <code>in:#sales</code> <code>after:2026-02-01</code> ·{' '}
            <kbd>Ctrl</kbd>+<kbd>K</kbd> to focus
          </span>
        </div>
      </form>

      {!query && (
        <div className="rounded-md border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
          {connections.data && connections.data.data.length === 0 ? (
            <p>
              Nothing to search yet.{' '}
              <Link to="/connections" className="underline">
                Add the demo data
              </Link>{' '}
              to try Findr with a fictional company.
            </p>
          ) : (
            <>
              <p className="mb-2">Try asking:</p>
              <ul className="flex flex-col gap-1">
                {[
                  'When will Harbor get the route optimizer, and did the date change?',
                  'How many vacation days do I get?',
                  'What caused the INC-2041 outage?',
                  'budget from:esi',
                ].map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="text-left text-blue-700 hover:underline dark:text-blue-400"
                      onClick={() => run(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {query && askAi && <AnswerPanel state={answer} onStop={cancel} />}

      {query && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            {TYPES.map((t) => (
              <Chip key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
                {t.label}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
            {DATES.map((d) => (
              <Chip key={d.value} active={date.value === d.value} onClick={() => pickDate(d.value)}>
                {d.label}
              </Chip>
            ))}
            {providers.length > 1 && (
              <>
                <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
                <Chip active={source === ''} onClick={() => setSource('')}>
                  All sources
                </Chip>
                {providers.map((p) => (
                  <Chip key={p} active={source === p} onClick={() => setSource(p)}>
                    {providerLabel[p] ?? p}
                  </Chip>
                ))}
              </>
            )}
          </div>

          {typedChips.length > 0 && (
            <p className="text-xs text-zinc-500">
              Filtering by {typedChips.join(', ')}
              {results.data?.parsed.text ? ` · searching for “${results.data.parsed.text}”` : ''}
            </p>
          )}

          {results.isFetching && <p className="text-sm text-zinc-500">Searching…</p>}
          {results.isError && <p className="text-sm text-red-600">Search failed. Try again.</p>}
          {results.data && !results.isFetching && (
            <>
              <p className="text-xs text-zinc-500">
                {results.data.data.length} results · {results.data.tookMs} ms
                {results.data.degraded && ' · meaning search unavailable, showing keyword matches'}
              </p>
              {results.data.data.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No results. Try other words or remove a filter.
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {results.data.data.map((hit) => {
                  const url = safeUrl(hit.url);
                  return (
                    <li
                      key={hit.documentId}
                      className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800">
                          {providerLabel[hit.provider] ?? hit.provider}
                        </span>
                        <span>{hit.type.replace('_', ' ')}</span>
                        {hit.container && <span>· {hit.container}</span>}
                        {hit.author && <span>· {hit.author}</span>}
                        {hit.updatedAt && (
                          <span>· {new Date(hit.updatedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      <h3 className="mt-1 font-medium">
                        {url ? (
                          <a
                            href={url}
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
                      {hit.snippets.map((s, i) => (
                        <p key={i} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          <Highlight text={s} terms={hit.matchedTerms} />
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
