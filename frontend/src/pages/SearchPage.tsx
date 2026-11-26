import { useQuery } from '@tanstack/react-query';
import { FileText, Mail, MessageSquare, Search, SearchX, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { AnswerPanel } from '../components/AnswerPanel';
import { Highlight } from '../components/Highlight';
import {
  api,
  providerLabel,
  type Connection,
  type SearchFilters,
  type SearchResponse,
} from '../lib/api';
import { cn } from '../lib/cn';
import { isOnboarded } from '../lib/onboarding';
import { safeUrl } from '../lib/safe-url';
import { useAskStream } from '../lib/useAskStream';
import { useWorkspace } from '../lib/workspace';
import { Button, buttonClass } from '../ui/Button';
import { Badge, EmptyState, ErrorNote, Spinner } from '../ui/Surface';

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
const SUGGESTIONS = [
  'When will Harbor get the route optimizer, and did the date change?',
  'How many vacation days do I get?',
  'What caused the INC-2041 outage?',
  'budget from:esi',
];
const typeIcon: Record<string, ReactNode> = {
  email: <Mail className="size-4" />,
  page: <FileText className="size-4" />,
  file: <FileText className="size-4" />,
  message_thread: <MessageSquare className="size-4" />,
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
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-accent bg-accent-soft font-medium text-accent'
          : 'border-line text-muted hover:bg-surface-2 hover:text-fg',
      )}
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
  const [params] = useSearchParams();
  const initial = params.get('q')?.trim() ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [type, setType] = useState('');
  const [date, setDate] = useState({ value: '', after: '' });
  const [source, setSource] = useState('');
  const [askAi, setAskAi] = useState(readAskPreference);
  const { state: answer, ask, cancel, reset } = useAskStream(workspace.id);
  const started = useRef(false);

  // A question passed in the URL (?q=…, e.g. from onboarding) runs once on arrival.
  useEffect(() => {
    if (started.current || !initial) return;
    started.current = true;
    if (askAi) void ask(initial);
  }, [initial, askAi, ask]);

  // Ctrl/Cmd+K focuses the search box (the shell navigates here with focus: true from other pages).
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

  // A brand-new workspace with nothing connected goes through onboarding first.
  if (connections.data?.data.length === 0 && !isOnboarded(workspace.id)) {
    return <Navigate to="/welcome" replace />;
  }

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
    if (!on) cancel();
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
  const nothingConnected = connections.data?.data.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/25">
          <Search className="size-5 shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question or search, e.g. When is the Project Alpha delivery?"
            aria-label="Search"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-muted focus:outline-none"
          />
          <kbd className="hidden text-muted sm:inline">Ctrl K</kbd>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={askAi}
              onChange={(e) => toggleAsk(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <Sparkles className="size-3.5" aria-hidden />
            AI answer with sources
          </label>
          <span>
            Type filters: <code>source:demo</code> <code>type:email</code> <code>from:esi</code>{' '}
            <code>in:#sales</code> <code>after:2026-02-01</code>
          </span>
        </div>
      </form>

      {!query &&
        (nothingConnected ? (
          <EmptyState
            title="Nothing to search yet"
            action={
              <Link to="/connections" className={buttonClass('primary')}>
                Connect data
              </Link>
            }
          >
            Add the demo data (a fictional company) on the Connections page to try Findr.
          </EmptyState>
        ) : (
          <div>
            <p className="mb-3 text-sm font-medium text-muted">Try asking</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => run(s)}
                  className="rounded-lg border border-line bg-surface p-3 text-left text-sm text-fg transition-colors hover:border-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))}

      {query && askAi && <AnswerPanel state={answer} onStop={cancel} />}

      {query && (
        <section aria-label="Search results" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            {TYPES.map((t) => (
              <Chip key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
                {t.label}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            {DATES.map((d) => (
              <Chip key={d.value} active={date.value === d.value} onClick={() => pickDate(d.value)}>
                {d.label}
              </Chip>
            ))}
            {providers.length > 1 && (
              <>
                <span className="mx-1 h-4 w-px bg-line" aria-hidden />
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
            <p className="text-xs text-muted">
              Filtering by {typedChips.join(', ')}
              {results.data?.parsed.text ? ` · searching for “${results.data.parsed.text}”` : ''}
            </p>
          )}

          {results.isFetching && <Spinner label="Searching…" />}
          {results.isError && <ErrorNote>Search failed. Try again.</ErrorNote>}
          {results.data && !results.isFetching && (
            <>
              <p className="text-xs text-muted">
                {results.data.data.length} results · {results.data.tookMs} ms
                {results.data.degraded && ' · meaning search unavailable, showing keyword matches'}
              </p>
              {results.data.data.length === 0 && (
                <EmptyState icon={<SearchX className="size-7" />} title="No results">
                  Try other words, or remove a filter.
                </EmptyState>
              )}
              <ul className="flex flex-col gap-2">
                {results.data.data.map((hit) => {
                  const url = safeUrl(hit.url);
                  return (
                    <li
                      key={hit.documentId}
                      className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent/50"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted"
                          aria-hidden
                        >
                          {typeIcon[hit.type] ?? <FileText className="size-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-fg">
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <Badge>{providerLabel[hit.provider] ?? hit.provider}</Badge>
                            <span>{hit.type.replace('_', ' ')}</span>
                            {hit.container && <span>· {hit.container}</span>}
                            {hit.author && <span>· {hit.author}</span>}
                            {hit.updatedAt && (
                              <span>· {new Date(hit.updatedAt).toLocaleDateString()}</span>
                            )}
                          </div>
                          {hit.snippets.map((s, i) => (
                            <p key={i} className="mt-2 text-sm text-muted">
                              <Highlight text={s} terms={hit.matchedTerms} />
                            </p>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
