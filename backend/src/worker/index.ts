import { createLogger } from '../shared/logger.js';
import { loadConfig } from '../shared/config.js';

/**
 * Background worker entry point. In phase 1 it will consume BullMQ jobs (sync, parse, index).
 * For now it only proves the second entry point builds, starts and shuts down cleanly.
 */
const config = loadConfig();
const log = createLogger(config);

log.info('Worker started (no queues yet; they arrive in phase 1)');

const heartbeat = setInterval(() => log.debug('worker heartbeat'), 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info({ signal }, 'Worker shutting down');
    clearInterval(heartbeat);
    process.exit(0);
  });
}
