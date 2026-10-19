// These tests examine `useDailySummaries`, the hook that the page uses for the data.
//
// Each test renders the hook with a new TanStack Query client, so no result stays from another test.
// `renderHook` calls the hook inside a small test component, because a hook works only in a component.
// `waitFor` runs its check again and again until it passes, for a result that comes after a request.
// The test client sets `retryDelay` to 0, so the tests with retries do not wait. The decision
// to try again comes from the hook (`shouldRetry`), so the tests still examine the real rule.
// MSW gives the replies and counts the requests.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from '../api/apiErrors.ts';
import { server, SUMMARIES_URL } from '../test/server.ts';
import type { DailySummary } from '../types/dailySummary.ts';
import { shouldRetry, useDailySummaries } from './useDailySummaries.ts';

const SUMMARIES: DailySummary[] = [
  { day: '2026-10-14', lowAverage: 40.2958, highAverage: 49.7534, volume: 49_073_348 },
];

/** Renders the hook in a new query client. */
function renderUseDailySummaries(initialSymbol: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ symbol }: { symbol: string | null }) => useDailySummaries(symbol), {
    wrapper,
    initialProps: { symbol: initialSymbol },
  });
}

/** Makes MSW give the same reply to each request, and counts the requests for each symbol. */
function replyAlways(reply: () => Response): { count: () => number; symbols: string[] } {
  const symbols: string[] = [];
  server.use(
    http.get(SUMMARIES_URL, ({ params }) => {
      symbols.push(String(params.symbol));
      return reply();
    }),
  );
  return { count: () => symbols.length, symbols };
}

describe('useDailySummaries', () => {
  it('sends no request while there is no symbol', async () => {
    // Before the user submits a symbol, the page shows a prompt, not a loading state or an error.
    const requests = replyAlways(() => HttpResponse.json(SUMMARIES));

    const { result } = renderUseDailySummaries(null);
    // Give TanStack Query time to start a request, if it starts one by mistake.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(requests.count()).toBe(0);
  });

  it('gives the data for the symbol', async () => {
    replyAlways(() => HttpResponse.json(SUMMARIES));

    const { result } = renderUseDailySummaries('TSLA');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(SUMMARIES);
  });

  it('requests the new symbol when the symbol changes', async () => {
    const requests = replyAlways(() => HttpResponse.json(SUMMARIES));
    const { result, rerender } = renderUseDailySummaries('TSLA');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ symbol: 'AAPL' });

    await waitFor(() => {
      expect(requests.symbols).toEqual(['TSLA', 'AAPL']);
    });
  });

  it('does not try again after 404, because the symbol will not exist on a new attempt', async () => {
    const requests = replyAlways(() =>
      HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: 'Not found.',
          instance: '/x',
          traceId: 't',
        },
        { status: 404 },
      ),
    );

    const { result } = renderUseDailySummaries('ZZZZZZ1');

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(requests.count()).toBe(1);
  });

  it('tries again 2 times after 502, then gives the error', async () => {
    // A server error can go away. 1 request and 2 new attempts: 3 requests.
    const requests = replyAlways(() => new HttpResponse(null, { status: 502 }));

    const { result } = renderUseDailySummaries('TSLA');

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ status: 502 });
    expect(requests.count()).toBe(3);
  });

  it('tries again after a network error', async () => {
    const requests = replyAlways(() => HttpResponse.error());

    const { result } = renderUseDailySummaries('TSLA');

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(NetworkError);
    expect(requests.count()).toBe(3);
  });
});

describe('shouldRetry', () => {
  // A direct test of the rule, for the cases that are slow or difficult to make with MSW.
  it.each([
    [400, false],
    [404, false],
    [429, false],
    [500, true],
    [502, true],
    [503, true],
    [504, true],
  ])('gives the correct decision for HTTP %i', (status, expected) => {
    expect(shouldRetry(0, new ApiError(status, null))).toBe(expected);
  });

  it('stops after 2 new attempts', () => {
    const error = new NetworkError();

    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });
});
