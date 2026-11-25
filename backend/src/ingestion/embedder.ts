import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '../db/schema.js';

/**
 * Turns text into vectors that capture meaning, so "deadline" can find "due date".
 * Every chunk records which model made its vector, so models can be switched later.
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** Thrown when the provider is down after retries. Chunks are then stored without vectors. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

const MAX_BATCH = 100;
const MAX_ATTEMPTS = 4;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/** OpenAI's embeddings endpoint, called directly (it's one small HTTP request). */
export function createOpenAIEmbedder(opts: {
  apiKey: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}): Embedder {
  const dimensions = opts.dimensions ?? EMBEDDING_DIMENSIONS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function embedBatch(input: string[], signal?: AbortSignal): Promise<number[][]> {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: opts.model, input, dimensions, encoding_format: 'float' }),
          signal: signal ?? null,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = `network error: ${(err as Error).message}`;
        await sleep(backoff(attempt), signal);
        continue;
      }

      if (res.ok) {
        const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }
      lastError = `HTTP ${res.status}`;
      // 4xx other than 429 won't fix itself (bad key, bad input): fail fast.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`OpenAI embeddings request failed: ${lastError}`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt), signal);
    }
    throw new EmbeddingUnavailableError(`OpenAI embeddings unavailable (${lastError})`);
  }

  return {
    model: opts.model,
    dimensions,
    async embed(texts, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += MAX_BATCH) {
        out.push(...(await embedBatch(texts.slice(i, i + MAX_BATCH), signal)));
      }
      return out;
    },
  };
}

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s… */
function backoff(attempt: number) {
  return 1000 * 2 ** (attempt - 1) * (0.5 + Math.random());
}

/**
 * A local stand-in used in tests and when no API key is set. It hashes word stems into a vector,
 * so similar wording gives similar vectors, but it doesn't understand meaning like a real model.
 */
export function createFakeEmbedder(dimensions = EMBEDDING_DIMENSIONS): Embedder {
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
  return {
    model: `fake-hash-${dimensions}`,
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Array<number>(dimensions).fill(0);
        for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          if (word.length < 2) continue;
          const h = createHash('sha256').update(stem(word)).digest();
          const slot = h.readUInt32BE(0) % dimensions;
          v[slot]! += h[4]! & 1 ? 1 : -1;
        }
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}
