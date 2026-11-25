import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each test file spins up its own in-memory PGlite database, which takes a moment.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
