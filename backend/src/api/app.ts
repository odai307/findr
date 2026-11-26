import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import type { ChatModel } from '../ai/chat-model.js';
import { createChatModels } from '../ai/setup.js';
import { createAccessTokenService } from '../auth/access-tokens.js';
import { createGoogleAuth } from '../auth/google.js';
import { createRefreshTokenService } from '../auth/refresh-tokens.js';
import type { Db } from '../db/client.js';
import type { SyncScheduler } from '../ingestion/scheduler.js';
import { createScheduler, createSyncDeps } from '../ingestion/setup.js';
import type { SyncDeps } from '../ingestion/sync.js';
import type { Config } from '../shared/config.js';
import { loggerOptions } from '../shared/logger.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandler } from './plugins/errors.js';
import { aiRoutes, feedbackRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { connectionRoutes } from './routes/connections.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { searchRoutes } from './routes/search.js';
import { workspaceRoutes } from './routes/workspaces.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Tests pass their own (fake embedder, test connectors). Built from config otherwise. */
  sync?: SyncDeps;
  scheduler?: SyncScheduler;
  /** Tests pass fake chat models. Built from config otherwise. */
  chat?: { chat: ChatModel; rewriter: ChatModel };
}

/**
 * Builds the Fastify app without starting it. Tests call this directly and send requests
 * with app.inject(), so no network port is needed.
 */
export async function buildApp({ config, db, ...overrides }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    genReqId: () => `req_${uuidv7()}`,
    // Trust X-Forwarded-For from the hosting provider's load balancer in production.
    trustProxy: config.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(cookie);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  const accessTokens = await createAccessTokenService({
    privateKey: config.JWT_PRIVATE_KEY,
    publicKey: config.JWT_PUBLIC_KEY,
    ttlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  });
  const refreshTokens = createRefreshTokenService(db, { ttlDays: config.REFRESH_TOKEN_TTL_DAYS });
  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? createGoogleAuth({
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          redirectUri: `${config.API_PUBLIC_URL}/v1/auth/google/callback`,
        })
      : null;

  const sync = overrides.sync ?? createSyncDeps(config, db, app.log);
  const scheduler = overrides.scheduler ?? createScheduler(config, sync, app.log);
  // Lets in-process syncs finish (or stop) before the database closes.
  app.addHook('onClose', () => scheduler.close());

  await app.register(authPlugin, { accessTokens });
  await app.register(healthRoutes, { db });
  await app.register(authRoutes, {
    prefix: '/v1/auth',
    config,
    db,
    accessTokens,
    refreshTokens,
    google,
  });
  await app.register(meRoutes, { prefix: '/v1', db });
  await app.register(workspaceRoutes, { prefix: '/v1/workspaces', db });
  await app.register(connectionRoutes, {
    prefix: '/v1/workspaces/:workspaceId/connections',
    db,
    scheduler,
  });
  await app.register(searchRoutes, {
    prefix: '/v1/workspaces/:workspaceId/search',
    db,
    embedder: sync.embedder,
  });
  const models = overrides.chat ?? createChatModels(config, app.log);
  await app.register(aiRoutes, {
    prefix: '/v1/workspaces/:workspaceId',
    db,
    answers: { db, embedder: sync.embedder, log: app.log, ...models },
    userDailyAskLimit: config.USER_DAILY_ASK_LIMIT,
  });
  await app.register(feedbackRoutes, { prefix: '/v1/messages', db });

  return app;
}
