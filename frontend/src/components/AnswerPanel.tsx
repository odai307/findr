import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import type { AskState } from '../lib/useAskStream';
import { AnswerText } from './AnswerText';

/** Thumbs up/down on an answer. */
export function Feedback({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const send = (value: 1 | -1) => {
    setRating(value);
    void api(`/v1/messages/${messageId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating: value }),
    }).catch(() => setRating(null));
  };
  const btn = (value: 1 | -1, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => send(value)}
      aria-pressed={rating === value}
      aria-label={label}
      className={`rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        rating === value ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}
    >
      {icon}
    </button>
  );
  return (
    <span className="flex items-center gap-1 text-sm text-zinc-500">
      {rating ? 'Thanks for the feedback' : 'Helpful?'}
      {btn(1, 'Helpful', '👍')}
      {btn(-1, 'Not helpful', '👎')}
    </span>
  );
}

/** The streaming AI answer shown above search results. */
export function AnswerPanel({ state, onStop }: { state: AskState; onStop: () => void }) {
  if (state.status === 'idle') return null;
  const streaming = state.status === 'streaming';

  return (
    <section
      aria-label="AI answer"
      className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-blue-800 dark:text-blue-300">
        <span>AI answer</span>
        {streaming && (
          <button type="button" onClick={onStop} className="normal-case underline">
            Stop
          </button>
        )}
      </div>
      {state.rewrittenQuery && (
        <p className="mb-2 text-xs text-zinc-500">Searched for: “{state.rewrittenQuery}”</p>
      )}

      <div
        aria-live="polite"
        aria-busy={streaming}
        className="text-sm text-zinc-800 dark:text-zinc-200"
      >
        {state.text ? (
          <AnswerText text={state.text} citations={state.citations} streaming={streaming} />
        ) : streaming ? (
          <p className="text-zinc-500">Reading your sources…</p>
        ) : null}
      </div>

      {state.error && (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{state.error}</p>
      )}

      {state.status === 'done' && state.messageId && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-blue-100 pt-2 dark:border-blue-900">
          <Feedback messageId={state.messageId} />
          {state.conversationId && (
            <Link
              to={`/conversations/${state.conversationId}`}
              className="text-sm text-blue-700 underline dark:text-blue-400"
            >
              Ask a follow-up →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
