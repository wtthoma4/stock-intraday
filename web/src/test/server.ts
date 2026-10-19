// One MSW (Mock Service Worker) server for all web tests. It catches each `fetch` in the test process.
// Each test adds the handlers that it needs with `server.use(...)`. `setup.ts` starts and resets the server.

import { setupServer } from 'msw/node';

export const server = setupServer();

/**
 * The URL pattern of the summaries endpoint. The `*` accepts any origin, because the client uses
 * the origin of the page (`http://localhost:3000` in jsdom) or `VITE_API_BASE_URL`.
 */
export const SUMMARIES_URL = '*/api/v1/stocks/:symbol/daily-summaries';
