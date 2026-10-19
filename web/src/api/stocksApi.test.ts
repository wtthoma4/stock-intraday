// These tests examine `fetchDailySummaries`, the client for the stock API.
//
// MSW catches each request and gives a reply that the test defines. The tests examine:
//   1. The request: the URL, the encoding of the symbol, and the base URL from the configuration.
//   2. The success reply: the client gives the array, and rejects a body with a wrong shape.
//   3. The failures: each type of failure becomes the correct error class, so the UI can show the correct message.

import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server, SUMMARIES_URL } from '../test/server.ts';
import type { DailySummary, ProblemDetails } from '../types/dailySummary.ts';
import { ApiError, InvalidResponseError, NetworkError } from './apiErrors.ts';
import { fetchDailySummaries } from './stocksApi.ts';

const SUMMARIES: DailySummary[] = [
  { day: '2026-10-14', lowAverage: 40.2958, highAverage: 49.7534, volume: 49_073_348 },
];

/** A Problem Details body as the API sends it. */
function problem(status: number, title: string, detail: string): ProblemDetails {
  return {
    type: 'about:blank',
    title,
    status,
    detail,
    instance: '/api/v1/stocks/X/daily-summaries',
    traceId: 'trace-1',
  };
}

// `vi.stubEnv` (in one test below) changes an environment variable for that test only.
// `unstubAllEnvs` gives back the original values after each test.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchDailySummaries', () => {
  describe('request', () => {
    it('requests the summaries of the symbol from the origin of the page', async () => {
      // Without `VITE_API_BASE_URL`, the client uses the origin of the page (jsdom: http://localhost:3000).
      // In development, the Vite proxy then sends the request to the API.
      let requestedUrl = '';
      server.use(
        http.get(SUMMARIES_URL, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.json(SUMMARIES);
        }),
      );

      await fetchDailySummaries('TSLA');

      expect(requestedUrl).toBe(`${window.location.origin}/api/v1/stocks/TSLA/daily-summaries`);
    });

    it('encodes special characters in the symbol', async () => {
      // `^GSPC` must go as `%5EGSPC`. Without the encoding, some proxies change or reject the path.
      let requestedUrl = '';
      server.use(
        http.get(SUMMARIES_URL, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.json(SUMMARIES);
        }),
      );

      await fetchDailySummaries('^GSPC');

      expect(requestedUrl).toContain('/api/v1/stocks/%5EGSPC/daily-summaries');
    });

    it('uses VITE_API_BASE_URL when the API has a different origin', async () => {
      // In a deployment where the API has its own host, the build sets this variable.
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com');
      let requestedUrl = '';
      server.use(
        http.get(SUMMARIES_URL, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.json(SUMMARIES);
        }),
      );

      await fetchDailySummaries('TSLA');

      expect(requestedUrl).toBe('https://api.example.com/api/v1/stocks/TSLA/daily-summaries');
    });
  });

  describe('success', () => {
    it('gives the array from the API', async () => {
      server.use(http.get(SUMMARIES_URL, () => HttpResponse.json(SUMMARIES)));

      await expect(fetchDailySummaries('TSLA')).resolves.toEqual(SUMMARIES);
    });

    it('gives an empty array when the API has no complete days', async () => {
      server.use(http.get(SUMMARIES_URL, () => HttpResponse.json([])));

      await expect(fetchDailySummaries('TSLA')).resolves.toEqual([]);
    });

    it('throws InvalidResponseError when an item does not have the shape of the contract', async () => {
      // `volume` is text, not a number. The UI must not show data that it cannot trust.
      server.use(
        http.get(SUMMARIES_URL, () =>
          HttpResponse.json([{ day: '2026-10-14', lowAverage: 1, highAverage: 2, volume: '100' }]),
        ),
      );

      await expect(fetchDailySummaries('TSLA')).rejects.toBeInstanceOf(InvalidResponseError);
    });

    it('throws InvalidResponseError when the body is not JSON', async () => {
      // For example, a proxy that sends an HTML page with status 200.
      server.use(http.get(SUMMARIES_URL, () => HttpResponse.html('<html></html>')));

      await expect(fetchDailySummaries('TSLA')).rejects.toBeInstanceOf(InvalidResponseError);
    });
  });

  describe('failures', () => {
    it('throws ApiError with the status and the Problem Details of a 404 reply', async () => {
      // The UI uses the status to show "Symbol not found", and can show the trace ID for support.
      const body = problem(404, 'Not Found', 'No market data was found for the symbol "ZZZZZZ1".');
      server.use(http.get(SUMMARIES_URL, () => HttpResponse.json(body, { status: 404 })));

      const error = await fetchDailySummaries('ZZZZZZ1').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404, problem: body, message: body.detail });
      expect((error as ApiError).isClientError).toBe(true);
    });

    it('throws ApiError without Problem Details when the error body is not JSON', async () => {
      // A proxy in front of the API (for example Nginx) can send its own HTML page for 502.
      server.use(
        http.get(SUMMARIES_URL, () => HttpResponse.html('<h1>Bad Gateway</h1>', { status: 502 })),
      );

      const error = await fetchDailySummaries('TSLA').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 502, problem: null });
      expect((error as ApiError).isClientError).toBe(false);
    });

    it('throws NetworkError when there is no reply', async () => {
      // `HttpResponse.error()` makes `fetch` fail as if the API was off.
      server.use(http.get(SUMMARIES_URL, () => HttpResponse.error()));

      await expect(fetchDailySummaries('TSLA')).rejects.toBeInstanceOf(NetworkError);
    });

    it('gives the abort error with no change when the caller cancels', async () => {
      // TanStack Query cancels a request when the user requests another symbol. This is not a failure,
      // so the client must not change it into a NetworkError.
      server.use(
        http.get(SUMMARIES_URL, async () => {
          await delay(1_000);
          return HttpResponse.json(SUMMARIES);
        }),
      );
      const controller = new AbortController();

      const request = fetchDailySummaries('TSLA', controller.signal);
      controller.abort();

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await expect(request).rejects.not.toBeInstanceOf(NetworkError);
    });
  });
});
