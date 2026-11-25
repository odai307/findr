import { describe, expect, it } from 'vitest';
import {
  createGeminiEmbedder,
  createRateLimiter,
  EmbeddingUnavailableError,
} from '../src/ingestion/embedder.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { requests: Record<string, unknown>[] };
}

/** A stand-in for Google's API: records requests and replays scripted responses. */
function fakeGemini(responses: ((call: Call) => Response)[], dims = 4) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
    calls.push(call);
    const respond =
      responses.shift() ??
      ((c: Call) =>
        Response.json({
          embeddings: c.body.requests.map(() => ({
            values: Array.from({ length: dims }, (_, j) => (j === 0 ? 1 : 0)),
          })),
        }));
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (call: Call) =>
  Response.json({ embeddings: call.body.requests.map(() => ({ values: [3, 4, 0, 0] })) });

describe('Gemini embedder', () => {
  it('sends gemini-embedding-2 requests with task prefixes and normalizes vectors', async () => {
    const { fetchImpl, calls } = fakeGemini([ok, ok]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      dimensions: 4,
      fetchImpl,
    });

    const [doc] = await e.embed(['Delivery is March 15']);
    await e.embed(['when is delivery?'], { purpose: 'query' });

    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
    );
    expect(calls[0]!.headers['x-goog-api-key']).toBe('k');
    expect(calls[0]!.body.requests[0]).toEqual({
      model: 'models/gemini-embedding-2',
      content: { parts: [{ text: 'title: none | text: Delivery is March 15' }] },
      outputDimensionality: 4,
    });
    expect(calls[1]!.body.requests[0]!.content).toEqual({
      parts: [{ text: 'task: search result | query: when is delivery?' }],
    });
    expect(doc).toEqual([0.6, 0.8, 0, 0]); // [3,4,0,0] scaled to length 1
  });

  it('uses taskType instead of prefixes for gemini-embedding-001', async () => {
    const { fetchImpl, calls } = fakeGemini([ok]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-001',
      dimensions: 4,
      fetchImpl,
    });
    await e.embed(['hello'], { purpose: 'query' });
    expect(calls[0]!.body.requests[0]).toMatchObject({
      content: { parts: [{ text: 'hello' }] },
      taskType: 'RETRIEVAL_QUERY',
    });
  });

  it('splits large inputs into batches of at most 100 texts', async () => {
    const { fetchImpl, calls } = fakeGemini([]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      dimensions: 4,
      fetchImpl,
    });
    const vectors = await e.embed(Array.from({ length: 250 }, (_, i) => `text ${i}`));
    expect(vectors).toHaveLength(250);
    expect(calls.map((c) => c.body.requests.length)).toEqual([100, 100, 50]);
  });

  it('waits and retries when told to slow down (per-minute limit)', async () => {
    const slowDown = () =>
      Response.json({ error: { code: 429, details: [{ retryDelay: '0.05s' }] } }, { status: 429 });
    const { fetchImpl, calls } = fakeGemini([slowDown, ok]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      dimensions: 4,
      fetchImpl,
    });
    await expect(e.embed(['x'])).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('gives up immediately when the daily quota is used up', async () => {
    const daily = () =>
      Response.json(
        {
          error: {
            code: 429,
            message: 'Quota exceeded: EmbedRequestsPerDayPerProjectPerModel-FreeTier',
          },
        },
        { status: 429 },
      );
    const { fetchImpl, calls } = fakeGemini([daily]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      dimensions: 4,
      fetchImpl,
    });
    await expect(e.embed(['x'])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it('fails fast on a bad key', async () => {
    const bad = () =>
      Response.json({ error: { code: 400, message: 'API key not valid' } }, { status: 400 });
    const { fetchImpl } = fakeGemini([bad]);
    const e = createGeminiEmbedder({
      apiKey: 'nope',
      model: 'gemini-embedding-2',
      dimensions: 4,
      fetchImpl,
    });
    await expect(e.embed(['x'])).rejects.toThrow(/API key not valid/);
  });

  it('rejects vectors of the wrong size', async () => {
    const { fetchImpl } = fakeGemini([ok]);
    const e = createGeminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      dimensions: 8,
      fetchImpl,
    });
    await expect(e.embed(['x'])).rejects.toThrow(/expected 1 of size 8/);
  });
});

describe('rate limiter', () => {
  it('lets requests through within budget and blocks beyond it', async () => {
    const take = createRateLimiter({ requestsPerMinute: 2, tokensPerMinute: 1000 });
    await take(10);
    await take(10);
    const controller = new AbortController();
    let third = false;
    const pending = take(10, controller.signal).then(
      () => (third = true),
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(third).toBe(false); // it would wait ~60 s for the window to free up
    controller.abort();
    await pending;
  });
});
