import { ArrowRight, Sparkles, Square, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import type { AskState } from '../lib/useAskStream';
import { Button } from '../ui/Button';
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
  const btn = (value: 1 | -1, label: string, Icon: typeof ThumbsUp) => (
    <button
      type="button"
      onClick={() => send(value)}
      aria-pressed={rating === value}
      aria-label={label}
      className={cn(
        'rounded p-1.5 transition-colors hover:bg-surface-2 hover:text-fg',
        rating === value ? 'bg-accent-soft text-accent' : 'text-muted',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      {rating ? 'Thanks for the feedback' : 'Helpful?'}
      {btn(1, 'Helpful', ThumbsUp)}
      {btn(-1, 'Not helpful', ThumbsDown)}
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
      className="rounded-lg border border-accent/30 bg-surface p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent uppercase">
          <Sparkles className="size-3.5" aria-hidden />
          AI answer
        </span>
        {streaming && (
          <Button size="sm" variant="ghost" icon={<Square className="size-3" />} onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      {state.rewrittenQuery && (
        <p className="mb-2 text-xs text-muted">Searched for: “{state.rewrittenQuery}”</p>
      )}

      <div aria-live="polite" aria-busy={streaming} className="text-sm text-fg">
        {state.text ? (
          <AnswerText text={state.text} citations={state.citations} streaming={streaming} />
        ) : streaming ? (
          <div className="flex flex-col gap-2" aria-label="Reading your sources">
            <span className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
            <span className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
            <span className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        ) : null}
      </div>

      {state.error && (
        <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {state.error}
        </p>
      )}

      {state.status === 'done' && state.messageId && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <Feedback messageId={state.messageId} />
          {state.conversationId && (
            <Link
              to={`/conversations/${state.conversationId}`}
              className="flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Ask a follow-up <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
