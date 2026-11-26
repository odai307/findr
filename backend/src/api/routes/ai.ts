import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  checkAskBudget,
  openConversation,
  streamAnswer,
  type AnswerDeps,
  type AnswerEvent,
} from '../../ai/answer.js';
import type { Db } from '../../db/client.js';
import { conversations, feedback, messages, users } from '../../db/schema.js';
import { AppError } from '../../shared/errors.js';
import { getWorkspaceForUser } from '../../workspaces/service.js';
import { accessFor, userIdOf } from '../plugins/auth.js';
import { apiRateLimit } from '../plugins/rate-limits.js';

const citationSchema = z.object({
  n: z.number(),
  documentId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  provider: z.string(),
  type: z.string(),
  author: z.string().nullable(),
  updatedAt: z.string().nullable(),
  snippet: z.string(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['complete', 'error', 'aborted']),
  rewrittenQuery: z.string().nullable(),
  citations: z.array(citationSchema),
  createdAt: z.date(),
});

const conversationSummary = z.object({ id: z.string(), title: z.string(), updatedAt: z.date() });

const wsParams = z.object({ workspaceId: z.uuid() });
const convParams = z.object({ workspaceId: z.uuid(), conversationId: z.uuid() });

interface Options {
  db: Db;
  answers: AnswerDeps;
  userDailyAskLimit: number;
}

/** Routes under /v1/workspaces/:workspaceId: ask + conversations. */
export const aiRoutes: FastifyPluginAsync<Options> = async (fastify, opts) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = opts;

  /**
   * Streams an answer as server-sent events:
   *   meta → token… → citations → done   (or `error` if the AI model fails)
   * Budget, permission and validation errors happen before streaming and are normal JSON errors.
   */
  app.post(
    '/ask',
    {
      onRequest: app.authenticateUserOrKey('ask'),
      config: { rateLimit: apiRateLimit({ perUser: 20, perKey: 60 }) },
      schema: {
        params: wsParams,
        body: z.object({
          question: z.string().trim().min(1).max(2000),
          conversationId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const { userId, principals } = await accessFor(db, request, workspaceId);
      await checkAskBudget(db, workspaceId, userId, opts.userDailyAskLimit);
      const conversation = await openConversation(db, {
        workspaceId,
        userId,
        question: request.body.question,
        ...(request.body.conversationId && { conversationId: request.body.conversationId }),
      });
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));

      // From here on we write the response ourselves, as a stream.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        ...(reply.getHeaders() as Record<string, string>),
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const send = (e: AnswerEvent) => {
        if (!res.writableEnded) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      };

      try {
        await streamAnswer(
          opts.answers,
          {
            workspaceId,
            userId,
            userName: user?.name ?? 'User',
            question: request.body.question,
            conversationId: conversation.id,
            principals,
          },
          send,
          controller.signal,
        );
      } catch (err) {
        request.log.error({ err }, 'Ask failed');
        send({ event: 'error', data: { code: 'INTERNAL', message: 'Something went wrong.' } });
      } finally {
        res.end();
      }
    },
  );

  app.get(
    '/conversations',
    {
      onRequest: app.authenticate,
      schema: {
        params: wsParams,
        response: { 200: z.object({ data: z.array(conversationSummary) }) },
      },
    },
    async (request) => {
      const userId = userIdOf(request);
      await getWorkspaceForUser(db, request.params.workspaceId, userId);
      const data = await db
        .select({
          id: conversations.id,
          title: conversations.title,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, request.params.workspaceId),
            eq(conversations.userId, userId),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(50);
      return { data };
    },
  );

  async function ownConversation(workspaceId: string, conversationId: string, userId: string) {
    await getWorkspaceForUser(db, workspaceId, userId);
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.userId, userId),
        ),
      );
    if (!conv) throw new AppError('NOT_FOUND', 'Conversation not found.');
    return conv;
  }

  app.get(
    '/conversations/:conversationId',
    {
      onRequest: app.authenticate,
      schema: {
        params: convParams,
        response: { 200: conversationSummary.extend({ messages: z.array(messageSchema) }) },
      },
    },
    async (request) => {
      const { workspaceId, conversationId } = request.params;
      const conv = await ownConversation(workspaceId, conversationId, userIdOf(request));
      const rows = await db
        .select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          status: messages.status,
          rewrittenQuery: messages.rewrittenQuery,
          citations: messages.citations,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt));
      return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, messages: rows };
    },
  );

  app.delete(
    '/conversations/:conversationId',
    { onRequest: app.authenticate, schema: { params: convParams } },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params;
      await ownConversation(workspaceId, conversationId, userIdOf(request));
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      return reply.status(204).send();
    },
  );
};

/** Routes under /v1/messages */
export const feedbackRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', app.authenticate);

  /** Thumbs up/down on an answer. Only for answers in the user's own conversations. */
  app.post(
    '/:messageId/feedback',
    {
      schema: {
        params: z.object({ messageId: z.uuid() }),
        body: z.object({
          rating: z.union([z.literal(1), z.literal(-1)]),
          comment: z.string().trim().max(2000).optional(),
        }),
      },
    },
    async (request, reply) => {
      const userId = userIdOf(request);
      const [msg] = await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(messages.id, request.params.messageId),
            eq(messages.role, 'assistant'),
            eq(conversations.userId, userId),
          ),
        );
      if (!msg) throw new AppError('NOT_FOUND', 'Message not found.');
      await db
        .insert(feedback)
        .values({
          messageId: msg.id,
          userId,
          rating: request.body.rating,
          comment: request.body.comment ?? null,
        })
        .onConflictDoUpdate({
          target: [feedback.messageId, feedback.userId],
          set: { rating: request.body.rating, comment: request.body.comment ?? null },
        });
      return reply.status(204).send();
    },
  );
};
