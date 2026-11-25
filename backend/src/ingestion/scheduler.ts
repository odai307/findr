import { Queue } from 'bullmq';
import type { FastifyBaseLogger as Logger } from 'fastify';
import { runSync, type SyncDeps, type SyncKind } from './sync.js';

export const SYNC_QUEUE = 'sync';

export interface SyncJobData {
  connectionId: string;
  kind: SyncKind;
}

/** Starts syncs. The API calls this; it never runs a sync on the request itself. */
export interface SyncScheduler {
  enqueue(connectionId: string, kind: SyncKind): Promise<void>;
  /** Waits for in-flight work (in-process mode) and closes connections. */
  close(): Promise<void>;
}

/**
 * Production: put the job on a Redis-backed BullMQ queue; the worker process picks it up.
 * BullMQ retries failed jobs with exponential backoff. The job ID collapses duplicates: if a sync
 * for this connection is already waiting, a second request doesn't add another.
 */
export function createQueueScheduler(redisUrl: string): SyncScheduler {
  const queue = new Queue<SyncJobData>(SYNC_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });
  return {
    async enqueue(connectionId, kind) {
      await queue.add(
        `sync.${kind}`,
        { connectionId, kind },
        {
          // BullMQ rejects ':' in custom IDs.
          jobId: `conn-${connectionId}-${kind}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: { age: 14 * 86_400 },
        },
      );
    },
    close: () => queue.close(),
  };
}

/**
 * Local development without Redis: run the sync in the background of the API process.
 * Duplicate requests for a connection that is already syncing are ignored.
 */
export function createInProcessScheduler(deps: SyncDeps, log: Logger): SyncScheduler {
  const running = new Map<string, Promise<void>>();
  const controller = new AbortController();

  return {
    async enqueue(connectionId, kind) {
      if (running.has(connectionId)) return;
      const job = runSync(deps, connectionId, kind, controller.signal)
        .then(() => undefined)
        .catch((err: unknown) => {
          if (!controller.signal.aborted)
            log.error({ err, connectionId }, 'In-process sync failed');
        })
        .finally(() => running.delete(connectionId));
      running.set(connectionId, job);
    },
    async close() {
      controller.abort(new Error('Shutting down'));
      await Promise.allSettled(running.values());
    },
  };
}
