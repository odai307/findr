import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The config runs in Node; only these two variables are read.
declare const process: { env: Record<string, string | undefined> };

// Where the dev proxy sends API calls. Override to run a second copy, e.g. API_PROXY_TARGET=http://127.0.0.1:3100
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // In development the browser talks only to localhost:5173. Vite forwards /v1 and the
    // health checks to the API, so cookies and requests stay same-origin.
    proxy: {
      '/v1': apiTarget,
      '/healthz': apiTarget,
      '/readyz': apiTarget,
    },
  },
});
