import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each test file spins up its own in-memory PGlite database (with pgvector), which can take
    // a while on slower machines, especially with several files running in parallel.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
