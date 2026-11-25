import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '../db/schema.js';

/**
 * Turns text into vectors that capture meaning, so "deadline" can find "due date".
 * Every chunk records which model made its vector, so models can be switched later.
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
}

export interface EmbedOptions {
  /**
   * Search models embed questions and documents slightly differently ("asymmetric" search).
   * Chunks being indexed are documents; what the user types is a query. Default: document.
   */
  purpose?: 'document' | 'query';
  signal?: AbortSignal;
}

/** Thrown when the provider is down or out of quota. Chunks are then stored without vectors. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s… */
function backoff(attempt: number) {
  return 1000 * 2 ** (attempt - 1) * (0.5 + Math.random());
}

function normalize(v: number[]): number[] {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Rough token estimate (about 4 characters per token) for staying under per-minute quotas. */
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Keeps calls under a requests-per-minute and tokens-per-minute budget (sliding 60 s window),
 * so free-tier quotas aren't hit in the first place.
 */
export function createRateLimiter(limits: { requestsPerMinute: number; tokensPerMinute: number }) {
  const window: { at: number; tokens: number }[] = [];
  return async function take(tokens: number, signal?: AbortSignal) {
    for (;;) {
      const now = Date.now();
      while (window.length && now - window[0]!.at >= 60_000) window.shift();
      const used = window.reduce((sum, w) => sum + w.tokens, 0);
      const fits =
        window.length < limits.requestsPerMinute &&
        (used + tokens <= limits.tokensPerMinute || window.length === 0);
      if (fits) {
        window.push({ at: now, tokens });
        return;
      }
      await sleep(window[0]!.at + 60_000 - now + 50, signal);
    }
  };
}

/**
 * Google's Gemini embeddings (free tier available). Supports `gemini-embedding-2` (current) and
 * `gemini-embedding-001` (older, text-only).
 */
export function createGeminiEmbedder(opts: {
  apiKey: string;
  model: string;
  dimensions?: number;
  /** Free-tier defaults, kept a little under Google's ~100 requests and ~30k tokens per minute. */
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  fetchImpl?: typeof fetch;
}): Embedder {
  const dimensions = opts.dimensions ?? EMBEDDING_DIMENSIONS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tokensPerMinute = opts.tokensPerMinute ?? 25_000;
  const take = createRateLimiter({
    requestsPerMinute: opts.requestsPerMinute ?? 90,
    tokensPerMinute,
  });
  const usesPrefixes = !opts.model.endsWith('-001');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:batchEmbedContents`;

  /** gemini-embedding-2 takes the task as a text prefix; 001 takes a taskType field instead. */
  function request(text: string, purpose: 'document' | 'query') {
    if (usesPrefixes) {
      const prefixed =
        purpose === 'query'
          ? `task: search result | query: ${text}`
          : `title: none | text: ${text}`;
      return {
        model: `models/${opts.model}`,
        content: { parts: [{ text: prefixed }] },
        outputDimensionality: dimensions,
      };
    }
    return {
      model: `models/${opts.model}`,
      content: { parts: [{ text }] },
      taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
      outputDimensionality: dimensions,
    };
  }

  async function embedBatch(texts: string[], purpose: 'document' | 'query', signal?: AbortSignal) {
    let lastError = '';
    for (let attempt = 1; attempt <= 6; attempt++) {
      await take(
        texts.reduce((n, t) => n + estimateTokens(t), 0),
        signal,
      );
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: texts.map((t) => request(t, purpose)) }),
          signal: signal ?? null,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = `network error: ${(err as Error).message}`;
        await sleep(backoff(attempt), signal);
        continue;
      }

      if (res.ok) {
        const body = (await res.json()) as { embeddings: { values: number[] }[] };
        const vectors = body.embeddings.map((e) => normalize(e.values));
        if (vectors.length !== texts.length || vectors.some((v) => v.length !== dimensions)) {
          throw new Error(
            `Gemini returned ${vectors.length} vectors of size ${vectors[0]?.length}; expected ${texts.length} of size ${dimensions}`,
          );
        }
        return vectors;
      }

      const errorBody = await res.text();
      lastError = `HTTP ${res.status}`;
      if (res.status === 429) {
        // Out of today's quota: stop now; the backfill job adds vectors after the daily reset.
        if (/per ?day|PerDay|daily/i.test(errorBody)) {
          throw new EmbeddingUnavailableError('Gemini daily embedding quota used up');
        }
        // Per-minute limit: wait as long as Google asks ("retryDelay": "17s"), or back off.
        const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(errorBody);
        await sleep(delay ? Number(delay[1]) * 1000 + 250 : backoff(attempt) * 4, signal);
        continue;
      }
      if (res.status >= 500) {
        await sleep(backoff(attempt), signal);
        continue;
      }
      // Other 4xx (bad key, bad request) won't fix itself.
      throw new Error(`Gemini embeddings request failed: ${lastError} ${errorBody.slice(0, 300)}`);
    }
    throw new EmbeddingUnavailableError(`Gemini embeddings unavailable (${lastError})`);
  }

  return {
    model: opts.model,
    dimensions,
    async embed(texts, options = {}) {
      const purpose = options.purpose ?? 'document';
      const out: number[][] = [];
      // Batches of up to 100 texts, each well under one minute's token budget.
      let batch: string[] = [];
      let batchTokens = 0;
      for (const text of texts) {
        const t = estimateTokens(text);
        if (batch.length && (batch.length >= 100 || batchTokens + t > tokensPerMinute / 2)) {
          out.push(...(await embedBatch(batch, purpose, options.signal)));
          batch = [];
          batchTokens = 0;
        }
        batch.push(text);
        batchTokens += t;
      }
      if (batch.length) out.push(...(await embedBatch(batch, purpose, options.signal)));
      return out;
    },
  };
}

/** OpenAI's embeddings endpoint (paid), called directly: it's one small HTTP request. */
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
    for (let attempt = 1; attempt <= 4; attempt++) {
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
    async embed(texts, options = {}) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        out.push(...(await embedBatch(texts.slice(i, i + 100), options.signal)));
      }
      return out;
    },
  };
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
        return normalize(v);
      });
    },
  };
}
