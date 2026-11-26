import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Send, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Feedback } from '../components/AnswerPanel';
import { AnswerText } from '../components/AnswerText';
import { api, type Conversation, type ConversationSummary } from '../lib/api';
import { cn } from '../lib/cn';
import { useAskStream } from '../lib/useAskStream';
import { useWorkspace } from '../lib/workspace';
import { Button, buttonClass } from '../ui/Button';
import { useConfirm } from '../ui/Dialog';
import { ErrorNote } from '../ui/Surface';
import { useToast } from '../ui/Toast';

function AnswerCard({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface p-4 text-sm',
        live ? 'border-accent/30' : 'border-line',
      )}
    >
      <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent uppercase">
        <Sparkles className="size-3.5" aria-hidden />
        Findr
      </span>
      {children}
    </div>
  );
}

function Question({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] self-end rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg">
      {children}
    </div>
  );
}

/** Threaded Q&A: a sidebar of past conversations and the selected (or a new) conversation. */
export function ConversationsPage() {
  const { conversationId } = useParams();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
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
      if (finished.conversationId !== conversationId)
        navigate(`/conversations/${finished.conversationId}`);
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', workspace.id] });
      toast('Conversation deleted');
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
  const empty = !conversationId && state.status === 'idle';

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside aria-label="Conversations" className="flex flex-col gap-2">
        <Link
          to="/conversations"
          onClick={() => reset()}
          className={buttonClass('secondary', 'md', 'w-full')}
        >
          <Plus className="size-4" aria-hidden /> New conversation
        </Link>
        <ul className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto text-sm lg:max-h-none">
          {list.data?.data.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <Link
                to={`/conversations/${c.id}`}
                title={c.title}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5',
                  c.id === conversationId
                    ? 'bg-surface-2 font-medium text-fg'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {c.title}
              </Link>
              <button
                type="button"
                aria-label={`Delete conversation: ${c.title}`}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Delete this conversation?',
                      description: c.title,
                      confirmLabel: 'Delete',
                      danger: true,
                    })
                  ) {
                    remove.mutate(c.id);
                  }
                }}
                className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
          {list.data?.data.length === 0 && (
            <li className="px-2.5 py-1.5 text-muted">No conversations yet.</li>
          )}
        </ul>
      </aside>

      <section className="flex min-h-[70vh] min-w-0 flex-col">
        <div className="flex flex-1 flex-col gap-4">
          {empty && (
            <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
              <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                <MessageSquare className="size-6" aria-hidden />
              </span>
              <h1 className="text-lg font-semibold">Ask about your work</h1>
              <p className="mt-1 max-w-sm text-sm text-muted">
                Answers come from your connected apps, with sources. Follow-up questions keep the
                context.
              </p>
            </div>
          )}
          {conversation.isError && <ErrorNote>Conversation not found.</ErrorNote>}

          {messages.map((m) =>
            m.role === 'user' ? (
              <Question key={m.id}>{m.content}</Question>
            ) : (
              <AnswerCard key={m.id}>
                {m.rewrittenQuery && (
                  <p className="mb-2 text-xs text-muted">Searched for: “{m.rewrittenQuery}”</p>
                )}
                {m.status === 'error' && !m.content ? (
                  <p className="text-warning">The AI answer was unavailable.</p>
                ) : (
                  <AnswerText text={m.content} citations={m.citations} />
                )}
                {m.status === 'complete' && (
                  <div className="mt-3 border-t border-line pt-2">
                    <Feedback messageId={m.id} />
                  </div>
                )}
              </AnswerCard>
            ),
          )}

          {state.status !== 'idle' && (
            <>
              <Question>{state.question}</Question>
              <AnswerCard live>
                <div aria-live="polite" aria-busy={streaming}>
                  {state.rewrittenQuery && (
                    <p className="mb-2 text-xs text-muted">
                      Searched for: “{state.rewrittenQuery}”
                    </p>
                  )}
                  {state.text ? (
                    <AnswerText
                      text={state.text}
                      citations={state.citations}
                      streaming={streaming}
                    />
                  ) : (
                    streaming && <p className="text-muted">Reading your sources…</p>
                  )}
                  {state.error && <p className="mt-2 text-warning">{state.error}</p>}
                </div>
              </AnswerCard>
            </>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={onSubmit} className="sticky bottom-0 mt-6 bg-bg pt-2 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5 pl-3 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/25">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={conversationId ? 'Ask a follow-up…' : 'Ask a question…'}
              aria-label="Question"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
            />
            {streaming ? (
              <Button icon={<Square className="size-3" />} onClick={cancel}>
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                icon={<Send className="size-4" />}
                disabled={!input.trim()}
              >
                Ask
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
