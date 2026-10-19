// Vitest runs this file before each test file.

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server.ts';

// Adds DOM matchers such as `toBeInTheDocument` and `toHaveTextContent` to `expect`.
import '@testing-library/jest-dom/vitest';

// jsdom has no `ResizeObserver`, but the `ResponsiveContainer` of Recharts needs one.
// This stub never reports a size, so the charts show their titles without a plot.
// The page tests examine the chart titles and the table, which has the same values as text.
class ResizeObserverStub {
  observe(): void {
    // jsdom has no layout, so there is no size to report.
  }
  unobserve(): void {
    // Nothing to stop.
  }
  disconnect(): void {
    // Nothing to stop.
  }
}
globalThis.ResizeObserver = ResizeObserverStub;

// Start the MSW server. A request without a handler fails the test, so no test can reach a real API.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  // Remove the rendered components after each test, so one test cannot see the DOM of another test.
  cleanup();
  // Remove the handlers of the test, so they do not change the next test.
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
