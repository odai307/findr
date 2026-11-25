import type { FastifyBaseLogger as Logger } from 'fastify';
import { defaultConnectorRegistry, type ConnectorRegistry } from '../connectors/registry.js';
import type { Db } from '../db/client.js';
import type { Config } from '../shared/config.js';
import { createFakeEmbedder, createOpenAIEmbedder, type Embedder } from './embedder.js';
import { createInProcessScheduler, createQueueScheduler, type SyncScheduler } from './scheduler.js';
import type { SyncDeps } from './sync.js';

export function createEmbedder(config: Config, log: Logger): Embedder {
  if (config.OPENAI_API_KEY) {
    return createOpenAIEmbedder({ apiKey: config.OPENAI_API_KEY, model: config.EMBEDDING_MODEL });
  }
  log.warn(
    'OPENAI_API_KEY is not set: using a fake local embedder. Meaning-based search will be weak.',
  );
  return createFakeEmbedder();
}

export function createSyncDeps(
  config: Config,
  db: Db,
  log: Logger,
  overrides: { embedder?: Embedder; connectors?: ConnectorRegistry } = {},
): SyncDeps {
  return {
    db,
    log,
    embedder: overrides.embedder ?? createEmbedder(config, log),
    connectors: overrides.connectors ?? defaultConnectorRegistry(),
  };
}

/** Redis configured → queue for the worker process. Otherwise → run syncs inside the API. */
export function createScheduler(config: Config, deps: SyncDeps, log: Logger): SyncScheduler {
  if (config.REDIS_URL) return createQueueScheduler(config.REDIS_URL);
  log.info('REDIS_URL is not set: syncs run inside the API process (development mode).');
  return createInProcessScheduler(deps, log);
}
