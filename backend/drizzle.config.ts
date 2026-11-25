import { defineConfig } from 'drizzle-kit';

// Only used by `pnpm db:generate`, which reads the schema and writes SQL migration files.
// It never connects to a database, so no credentials are needed here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
});
