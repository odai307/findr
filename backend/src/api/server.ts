import { openDatabase } from '../db/client.js';
import { loadConfig } from '../shared/config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const database = await openDatabase(config.DATABASE_URL);

// PGlite lives inside this process, so it's migrated here. A real Postgres is migrated by a
// separate release step (`pnpm db:migrate`) before new code starts.
if (config.DATABASE_URL.startsWith('pglite:')) await database.migrate();

const app = await buildApp({ config, db: database.db });

// Graceful shutdown: stop accepting requests, finish in-flight ones, then close the database.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
