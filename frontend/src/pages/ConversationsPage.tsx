import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Feedback } from '../components/AnswerPanel';
import { AnswerText } from '../components/AnswerText';
import { api, type Conversation, type ConversationSummary } from '../lib/api';
import { useAskStream } from '../lib/useAskStream';
import { useWorkspace } from '../lib/workspace';

/** Threaded Q&A: a sidebar of past conversations and the selected (or a new) conversation. */
export function ConversationsPage() {
  const { conversationId } = useParams();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/v1/workspaces/${workspace.id}/conversations`;
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: ['conversations', workspace.id],
    queryFn: () => api<{ data: ConversationSummary[] }>(base),
  });
  const conversation = useQuery({
    queryKey: ['conversation', workspace.id, conversationId],
    enabled: Boolean(conversationId),
    queryFn: () => api<Conversation>(`${base}/${conversationId}`),
  });

  const { state, ask, cancel, reset } = useAskStream(workspace.id, (finished, helpers) => {
    void queryClient.invalidateQueries({ queryKey: ['conversations', workspace.id] });
    if (finished.conversationId) {
      void queryClient
        .invalidateQueries({ queryKey: ['conversation', workspace.id, finished.conversationId] })
        .then(() => helpers.reset());
      if (finished.conversationId !== conversationId) {
        navigate(`/conversations/${finished.conversationId}`);
      }
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspace.id] });
      if (id === conversationId) navigate('/conversations');
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.text, conversation.data?.messages.length]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || state.status === 'streaming') return;
    setInput('');
    void ask(q, conversationId ?? null);
  }

  const messages = conversationId ? (conversation.data?.messages ?? []) : [];
  const streaming = state.status === 'streaming';

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside aria-label="Conversations" className="flex flex-col gap-2">
        <Link
          to="/conversations"
          onClick={() => reset()}
          className="rounded-md border border-zinc-300 px-3 py-2 text-center text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + New conversation
        </Link>
        <ul className="flex flex-col gap-1 text-sm">
          {list.data?.data.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <Link
                to={`/conversations/${c.id}`}
                className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 ${
                  c.id === conversationId
                    ? 'bg-zinc-200 dark:bg-zinc-800'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                }`}
                title={c.title}
              >
                {c.title}
              </Link>
              <button
                type="button"
                aria-label={`Delete conversation: ${c.title}`}
                onClick={() => {
                  if (confirm('Delete this conversation?')) remove.mutate(c.id);
                }}
                className="rounded px-1 text-zinc-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
          {list.data?.data.length === 0 && (
            <li className="px-2 text-zinc-500">No conversations yet.</li>
          )}
        </ul>
      </aside>

      <section className="flex min-h-[60vh] flex-col">
        <div className="flex flex-1 flex-col gap-5">
          {!conversationId && !streaming && state.status === 'idle' && (
            <p className="text-sm text-zinc-500">
              Ask a question about your connected apps. Follow-up questions keep the context.
            </p>
          )}
          {conversation.isError && <p className="text-sm text-red-600">Conversation not found.</p>}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div
                key={m.id}
                className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                {m.content}
              </div>
            ) : (
              <div
                key={m.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                {m.rewrittenQuery && (
                  <p className="mb-2 text-xs text-zinc-500">Searched for: “{m.rewrittenQuery}”</p>
                )}
                {m.status === 'error' && !m.content ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    The AI answer was unavailable.
                  </p>
                ) : (
                  <AnswerText text={m.content} citations={m.citations} />
                )}
                {m.status === 'complete' && (
                  <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <Feedback messageId={m.id} />
                  </div>
                )}
              </div>
            ),
          )}

          {state.status !== 'idle' && (
            <>
              <div className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                {state.question}
              </div>
              <div
                aria-live="polite"
                aria-busy={streaming}
                className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30"
              >
                {state.rewrittenQuery && (
                  <p className="mb-2 text-xs text-zinc-500">
                    Searched for: “{state.rewrittenQuery}”
                  </p>
                )}
                {state.text ? (
                  <AnswerText text={state.text} citations={state.citations} streaming={streaming} />
                ) : (
                  streaming && <p className="text-zinc-500">Reading your sources…</p>
                )}
                {state.error && (
                  <p className="mt-2 text-amber-700 dark:text-amber-400">{state.error}</p>
                )}
              </div>
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={onSubmit}
          className="sticky bottom-0 mt-6 flex gap-2 bg-zinc-50 py-3 dark:bg-zinc-950"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={conversationId ? 'Ask a follow-up…' : 'Ask a question…'}
            aria-label="Question"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {streaming ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
            >
              Ask
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
