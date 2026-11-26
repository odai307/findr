import { and, asc, count, eq, gte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { principalsFor } from '../auth/principals.js';
import type { Db } from '../db/client.js';
import { conversations, messages, usageEvents, workspaces, type Citation } from '../db/schema.js';
import type { Embedder } from '../ingestion/embedder.js';
import { hybridSearch } from '../search/hybrid.js';
import { parseQuery } from '../search/query-parser.js';
import { AppError } from '../shared/errors.js';
import { ChatUnavailableError, type ChatModel } from './chat-model.js';
import { resolveCitations, sanitizeAnswer } from './citations.js';
import { REWRITE_SYSTEM, rewriteTurn, selectSources, systemPrompt, userTurn } from './prompt.js';

export interface AnswerDeps {
  db: Db;
  embedder: Embedder;
  /** Writes the answer. */
  chat: ChatModel;
  /** Cheap model for rewriting follow-up questions. */
  rewriter: ChatModel;
  log: FastifyBaseLogger;
}

export type AnswerEvent =
  | { event: 'meta'; data: { conversationId: string; messageId: string; rewrittenQuery: string } }
  | { event: 'token'; data: { t: string } }
  | { event: 'citations'; data: Citation[] }
  | {
      event: 'done';
      data: {
        model: string | null;
        usage: { promptTokens: number; completionTokens: number };
        latencyMs: number;
        ttftMs: number | null;
      };
    }
  | { event: 'error'; data: { code: string; message: string } };

/**
 * Time limits (design §10.4, loosened for the free tier): give up if no text arrives within 15 s
 * (time for one slow model plus the fallback), or after 45 s in total.
 */
export const ANSWER_TIMEOUTS = { firstTokenMs: 15_000, totalMs: 45_000, rewriteMs: 8_000 };

export const NOT_FOUND_ANSWER =
  "I couldn't find anything about that in your connected apps. Try rephrasing, or check that the right apps are connected.";

/** Rejects the request (HTTP 429) when the user's or the workspace's daily question budget is used. */
export async function checkAskBudget(
  db: Db,
  workspaceId: string,
  userId: string,
  userDailyLimit: number,
) {
  const since = sql`date_trunc('day', now())`;
  const [mine] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.workspaceId, workspaceId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, since),
      ),
    );
  if ((mine?.n ?? 0) >= userDailyLimit) {
    throw new AppError(
      'BUDGET_EXCEEDED',
      `You've reached today's limit of ${userDailyLimit} questions.`,
    );
  }
  const [ws] = await db
    .select({ limit: workspaces.dailyAskLimit })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const [all] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, since),
      ),
    );
  if (ws && (all?.n ?? 0) >= ws.limit) {
    throw new AppError('BUDGET_EXCEEDED', "This workspace has reached today's question limit.");
  }
}

/** Finds the user's own conversation, or starts a new one. Others' conversations are NOT_FOUND. */
export async function openConversation(
  db: Db,
  input: { workspaceId: string; userId: string; question: string; conversationId?: string },
) {
  if (input.conversationId) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.userId, input.userId),
        ),
      );
    if (!conv) throw new AppError('NOT_FOUND', 'Conversation not found.');
    return conv;
  }
  const title = input.question.length > 80 ? `${input.question.slice(0, 77)}…` : input.question;
  const [conv] = await db
    .insert(conversations)
    .values({ workspaceId: input.workspaceId, userId: input.userId, title })
    .returning();
  return conv!;
}

async function rewriteFollowUp(
  deps: AnswerDeps,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  workspaceId: string,
  userId: string,
) {
  if (!history.length) return question;
  try {
    let tokens = { promptTokens: 0, completionTokens: 0, model: deps.rewriter.model };
    let text = '';
    for await (const e of deps.rewriter.stream(
      {
        system: REWRITE_SYSTEM,
        messages: [{ role: 'user', text: rewriteTurn(history, question) }],
        temperature: 0,
        maxOutputTokens: 100,
      },
      AbortSignal.timeout(ANSWER_TIMEOUTS.rewriteMs),
    )) {
      if (e.type === 'text') text += e.text;
      else tokens = e;
    }
    await deps.db.insert(usageEvents).values({ workspaceId, userId, kind: 'rewrite', ...tokens });
    const rewritten = text.trim().replace(/^["']|["']$/g, '');
    return rewritten && rewritten.length < 400 ? rewritten : question;
  } catch (err) {
    deps.log.warn({ err }, 'Follow-up rewrite failed; searching with the original question');
    return question;
  }
}

/**
 * Answers one question: rewrite (follow-ups only) → hybrid search → numbered sources → streamed
 * answer → validated citations → saved message. Every step reports through `emit`; errors after
 * streaming has started become an `error` event rather than an exception.
 */
export async function streamAnswer(
  deps: AnswerDeps,
  input: {
    workspaceId: string;
    userId: string;
    userName: string;
    question: string;
    conversationId: string;
    /** Who the answer may draw on; defaults to the user's own principals. API keys pass theirs. */
    principals?: string[];
  },
  emit: (e: AnswerEvent) => void,
  clientSignal: AbortSignal,
): Promise<void> {
  const started = Date.now();
  const { db } = deps;

  const history = (
    await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(eq(messages.conversationId, input.conversationId), eq(messages.status, 'complete')),
      )
      .orderBy(asc(messages.createdAt))
  ).slice(-6);
  await db
    .insert(messages)
    .values({ conversationId: input.conversationId, role: 'user', content: input.question });

  const messageId = uuidv7();
  const rewrittenQuery = await rewriteFollowUp(
    deps,
    history,
    input.question,
    input.workspaceId,
    input.userId,
  );
  emit({
    event: 'meta',
    data: { conversationId: input.conversationId, messageId, rewrittenQuery },
  });

  // --- Retrieve, with the same permission filtering as search. ---
  const principals = input.principals ?? (await principalsFor(db, input.userId, input.workspaceId));
  const parsed = parseQuery(rewrittenQuery);
  const { chunks } = await hybridSearch(db, deps.embedder, {
    workspaceId: input.workspaceId,
    principals,
    text: parsed.text,
    filters: parsed.filters,
    mode: 'hybrid',
    limit: 10,
  });
  const sources = selectSources(chunks);

  let answer = '';
  let status: 'complete' | 'error' | 'aborted' = 'complete';
  let ttftMs: number | null = null;
  let usage = { model: null as string | null, promptTokens: 0, completionTokens: 0 };

  if (!sources.length) {
    answer = NOT_FOUND_ANSWER;
    emit({ event: 'token', data: { t: answer } });
  } else {
    // Abort on: client disconnect, no first token within 10 s, or 30 s in total.
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(new Error('client disconnected'));
    clientSignal.addEventListener('abort', onClientAbort);
    const total = setTimeout(
      () => controller.abort(new Error('answer took too long')),
      ANSWER_TIMEOUTS.totalMs,
    );
    const firstToken = setTimeout(
      () => controller.abort(new Error('no response from the AI model')),
      ANSWER_TIMEOUTS.firstTokenMs,
    );
    try {
      const stream = deps.chat.stream(
        {
          system: systemPrompt({ today: new Date(), userName: input.userName }),
          messages: [
            // Earlier answers' [n] markers referred to earlier source lists, so they are removed.
            ...history.map((m) => ({
              role: m.role === 'user' ? ('user' as const) : ('model' as const),
              text: m.role === 'user' ? m.content : m.content.replace(/\[\d+\]/g, ''),
            })),
            { role: 'user', text: userTurn(rewrittenQuery, sources) },
          ],
        },
        controller.signal,
      );
      for await (const e of stream) {
        if (e.type === 'text') {
          if (ttftMs === null) {
            ttftMs = Date.now() - started;
            clearTimeout(firstToken);
          }
          answer += e.text;
          emit({ event: 'token', data: { t: e.text } });
        } else {
          usage = {
            model: e.model,
            promptTokens: e.promptTokens,
            completionTokens: e.completionTokens,
          };
        }
      }
    } catch (err) {
      status = clientSignal.aborted ? 'aborted' : 'error';
      if (status === 'error') {
        deps.log.warn({ err }, 'Answer generation failed');
        const reason = controller.signal.aborted
          ? (controller.signal.reason as Error).message
          : err instanceof ChatUnavailableError
            ? 'the AI model is busy right now'
            : 'the AI model returned an error';
        emit({
          event: 'error',
          data: {
            code: 'LLM_UNAVAILABLE',
            message: `AI answer unavailable: ${reason}. Search results are shown below.`,
          },
        });
      }
    } finally {
      clearTimeout(total);
      clearTimeout(firstToken);
      clientSignal.removeEventListener('abort', onClientAbort);
    }
  }

  // --- Validate citations, strip unsafe content, save. ---
  const { text: withValidCitations, citations } = resolveCitations(answer, sources);
  const content = sanitizeAnswer(
    withValidCitations,
    citations.map((c) => c.url).filter((u): u is string => !!u),
  );
  if (status !== 'aborted') emit({ event: 'citations', data: citations });

  const latencyMs = Date.now() - started;
  await db.insert(messages).values({
    id: messageId,
    conversationId: input.conversationId,
    role: 'assistant',
    content: content || (status === 'complete' ? NOT_FOUND_ANSWER : ''),
    status,
    rewrittenQuery: rewrittenQuery === input.question ? null : rewrittenQuery,
    citations,
    retrievedChunkIds: sources.flatMap((s) => s.chunkIds),
    model: usage.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    latencyMs,
    ttftMs,
  });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
  if (usage.model) {
    await db.insert(usageEvents).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: 'ask',
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
  }

  if (status !== 'aborted') {
    emit({
      event: 'done',
      data: {
        model: usage.model,
        usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
        latencyMs,
        ttftMs,
      },
    });
  }
}
