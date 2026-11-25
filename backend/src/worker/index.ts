import { Worker } from 'bullmq';
import { openDatabase } from '../db/client.js';
import { SYNC_QUEUE, type SyncJobData } from '../ingestion/scheduler.js';
import { createSyncDeps } from '../ingestion/setup.js';
import { runSync } from '../ingestion/sync.js';
import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';

/**
 * Background worker: consumes sync jobs from the Redis queue. Only needed when REDIS_URL is set;
 * without it (local development) the API runs syncs itself.
 */
const config = loadConfig();
const log = createLogger(config);

if (!config.REDIS_URL) {
  log.error('REDIS_URL is not set. The worker only runs with a Redis queue.');
  process.exit(1);
}
if (config.DATABASE_URL.startsWith('pglite:')) {
  log.error(
    'The worker needs a shared Postgres (DATABASE_URL=postgres://…); PGlite is single-process.',
  );
  process.exit(1);
}

const database = await openDatabase(config.DATABASE_URL);
const deps = createSyncDeps(config, database.db, log);
const controller = new AbortController();

const worker = new Worker<SyncJobData>(
  SYNC_QUEUE,
  async (job) => {
    const outcome = await runSync(deps, job.data.connectionId, job.data.kind, controller.signal);
    return outcome;
  },
  { connection: { url: config.REDIS_URL, maxRetriesPerRequest: null }, concurrency: 4 },
);

worker.on('failed', (job, err) => log.warn({ jobId: job?.id, err }, 'Sync job failed'));
log.info('Worker started, waiting for sync jobs');

// Graceful shutdown: stop taking jobs, let running ones finish (or checkpoint), then exit.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'Worker shutting down');
    const timer = setTimeout(() => controller.abort(new Error('Shutdown timeout')), 30_000);
    await worker.close();
    clearTimeout(timer);
    await database.close();
    process.exit(0);
  });
}
