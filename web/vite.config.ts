import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One file configures Vite (the development server and the build) and Vitest (the tests).
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development, the browser sends `/api/...` to the Vite server, and Vite sends it to the API.
    // The browser sees one origin, so CORS is not necessary in development.
    // If you change PORT in `api/.env`, change this port also.
    proxy: { '/api': 'http://localhost:5080' },
  },
  test: {
    // jsdom gives a browser DOM in Node.js, so the tests can render React components.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
