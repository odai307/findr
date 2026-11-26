/**
 * Chat models for AI answers. A model streams text; the answer pipeline doesn't care which
 * provider is behind it. Gemini (free tier) in real use; a deterministic fake in tests.
 */

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; model: string; promptTokens: number; completionTokens: number };

export interface ChatModel {
  /** Name of the first-choice model (the one that actually answered is in the `done` event). */
  readonly model: string;
  stream(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent>;
}

/** The provider is overloaded, rate-limited or unreachable after trying every fallback model. */
export class ChatUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatUnavailableError';
  }
}

/** A request the provider rejected for good (bad key, bad request): no fallback will help. */
class FatalChatError extends Error {}

/** Reads a complete answer (for short internal calls like rewriting follow-up questions). */
export async function completeText(model: ChatModel, request: ChatRequest, signal?: AbortSignal) {
  let text = '';
  for await (const e of model.stream(request, signal)) if (e.type === 'text') text += e.text;
  return text.trim();
}

/** Splits a fetch body into server-sent-event `data:` payloads. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Gemini via `streamGenerateContent` (server-sent events). Tries each model in `models` in order.
 * The next model is used when one is overloaded (503), rate-limited (429) or retired (404), or
 * when it hasn't produced any text within `perModelFirstTokenMs` (busy free-tier models often
 * accept a request and then stall). Once text has started, there is no switching. Hidden
 * "thinking" parts are never passed on.
 */
export function createGeminiChatModel(opts: {
  apiKey: string;
  models: string[];
  perModelFirstTokenMs?: number;
  fetchImpl?: typeof fetch;
}): ChatModel {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const models = opts.models.filter(Boolean);
  const firstTokenMs = opts.perModelFirstTokenMs ?? 6000;
  if (!models.length) throw new Error('At least one Gemini chat model is required');

  return {
    model: models[0]!,
    async *stream(request, signal) {
      const failures: string[] = [];
      for (const model of models) {
        signal?.throwIfAborted();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
        // This attempt stops if the caller aborts, or if this model is too slow to start.
        const attempt = new AbortController();
        const onAbort = () => attempt.abort(signal?.reason);
        signal?.addEventListener('abort', onAbort);
        const slow = setTimeout(() => attempt.abort(new Error('slow')), firstTokenMs);
        let started = false;
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.system }] },
              contents: request.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
              generationConfig: {
                temperature: request.temperature ?? 0.2,
                maxOutputTokens: request.maxOutputTokens ?? 1024,
              },
            }),
            signal: attempt.signal,
          });

          if (!res.ok) {
            const body = await res.text();
            failures.push(`${model}: HTTP ${res.status}`);
            if ([404, 429, 500, 503].includes(res.status)) continue;
            throw new FatalChatError(
              `Gemini request failed (${model}): HTTP ${res.status} ${body.slice(0, 200)}`,
            );
          }

          let promptTokens = 0;
          let completionTokens = 0;
          for await (const data of sseData(res.body!)) {
            const chunk = JSON.parse(data) as GeminiChunk;
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
              if (part.thought || !part.text) continue;
              if (!started) {
                started = true;
                clearTimeout(slow);
              }
              yield { type: 'text', text: part.text };
            }
            if (chunk.usageMetadata) {
              promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
              completionTokens = chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
            }
          }
          yield { type: 'done', model, promptTokens, completionTokens };
          return;
        } catch (err) {
          if (signal?.aborted || started || err instanceof FatalChatError) throw err;
          failures.push(
            `${model}: ${attempt.signal.aborted ? `no text within ${firstTokenMs} ms` : 'network error'}`,
          );
        } finally {
          clearTimeout(slow);
          signal?.removeEventListener('abort', onAbort);
        }
      }
      throw new ChatUnavailableError(`No chat model available (${failures.join('; ')})`);
    },
  };
}

/**
 * Deterministic stand-in for tests and for development without a key. It "answers" by quoting the
 * first source's first sentence and citing it as [1]; with no sources it says it couldn't find it.
 * For rewrite requests it returns the last question unchanged.
 */
export function createFakeChatModel(opts: { delayMs?: number; failWith?: Error } = {}): ChatModel {
  return {
    model: 'fake-chat',
    async *stream(request) {
      if (opts.failWith) throw opts.failWith;
      const last = request.messages.at(-1)?.text ?? '';
      let answer: string;
      if (request.system.includes('standalone search query')) {
        answer =
          last
            .split('\n')
            .at(-1)
            ?.replace(/^Follow-up question:\s*/, '') ?? last;
      } else {
        const source = /\[1\][^\n]*\n<content>\n?([\s\S]*?)<\/content>/.exec(last);
        const sentence = source?.[1]?.trim().split(/(?<=[.!?])\s/)[0];
        answer = sentence
          ? `According to the sources, ${sentence} [1]`
          : "I couldn't find anything about that in your connected apps.";
      }
      for (const word of answer.split(/(?<= )/)) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        yield { type: 'text', text: word };
      }
      yield { type: 'done', model: 'fake-chat', promptTokens: 0, completionTokens: 0 };
    },
  };
}
