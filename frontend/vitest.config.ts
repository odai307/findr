import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom is a lightweight browser simulation (much lighter than jsdom on slow machines).
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
