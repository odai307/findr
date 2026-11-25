import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** The same query API whichever driver is underneath. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * `pglite:<dir>` → embedded Postgres (WebAssembly) stored in a folder. No server to install.
 *    Only one process can open it at a time, which is fine until the worker needs the DB (phase 1).
 * `pglite:memory` → in-memory, for tests.
 * `postgres://…` → a real server (Neon in staging/production).
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite:')) {
    const location = url.slice('pglite:'.length);
    let client: PGlite;
    if (location === 'memory') {
      client = new PGlite();
    } else {
      mkdirSync(location, { recursive: true });
      client = new PGlite(location);
    }
    await client.waitReady;
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      migrate: () => migratePglite(db as never, { migrationsFolder }),
      close: () => client.close(),
    };
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzlePg(pool, { schema }) as unknown as Db;
  return {
    db,
    migrate: () => migratePg(db as never, { migrationsFolder }),
    close: () => pool.end(),
  };
}
