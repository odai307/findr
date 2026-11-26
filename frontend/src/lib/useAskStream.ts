import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, authorizedFetch, type Citation } from './api';

export interface AskState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  question: string;
  text: string;
  citations: Citation[];
  conversationId: string | null;
  messageId: string | null;
  rewrittenQuery: string | null;
  error: string | null;
  model: string | null;
}

const initial: AskState = {
  status: 'idle',
  question: '',
  text: '',
  citations: [],
  conversationId: null,
  messageId: null,
  rewrittenQuery: null,
  error: null,
  model: null,
};

/**
 * Asks a question and streams the answer. Uses fetch + a ReadableStream rather than EventSource,
 * because EventSource can't send POST requests or an Authorization header.
 */
export function useAskStream(
  workspaceId: string,
  onDone?: (state: AskState, helpers: { reset: () => void }) => void,
) {
  const [state, setState] = useState<AskState>(initial);
  const controller = useRef<AbortController | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  // Stop streaming if the component goes away.
  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setState(initial);
  }, [cancel]);

  const ask = useCallback(
    async (question: string, conversationId?: string | null) => {
      cancel();
      const ac = new AbortController();
      controller.current = ac;
      let current: AskState = { ...initial, status: 'streaming', question };
      const update = (patch: Partial<AskState>) => {
        current = { ...current, ...patch };
        setState(current);
      };
      update({});

      try {
        const res = await authorizedFetch(`/v1/workspaces/${workspaceId}/ask`, {
          method: 'POST',
          body: JSON.stringify({ question, ...(conversationId && { conversationId }) }),
          signal: ac.signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const raw = /^data: (.+)$/m.exec(block)?.[1];
            if (!event || !raw) continue;
            const data = JSON.parse(raw);
            if (event === 'meta') {
              update({
                conversationId: data.conversationId,
                messageId: data.messageId,
                rewrittenQuery: data.rewrittenQuery !== question ? data.rewrittenQuery : null,
              });
            } else if (event === 'token') {
              update({ text: current.text + data.t });
            } else if (event === 'citations') {
              update({ citations: data });
            } else if (event === 'error') {
              update({ error: data.message });
            } else if (event === 'done') {
              update({ model: data.model });
            }
          }
        }
        update({ status: current.error ? 'error' : 'done' });
        onDoneRef.current?.(current, { reset });
      } catch (err) {
        if (ac.signal.aborted) {
          update({ status: current.text ? 'done' : 'idle' });
          return;
        }
        update({
          status: 'error',
          error: err instanceof ApiError ? err.message : 'Could not reach the server.',
        });
      } finally {
        if (controller.current === ac) controller.current = null;
      }
    },
    [workspaceId, cancel, reset],
  );

  return { state, ask, cancel, reset };
}
