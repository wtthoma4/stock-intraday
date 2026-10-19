// These tests examine `YahooFinanceClient`, the adapter between the Yahoo chart API and the core types.
//
// The tests do not use the network. MSW (Mock Service Worker) catches each `fetch` in this process
// and gives a reply that the test defines. A handler such as `http.get(url, () => reply)` tells MSW which reply to give
// for a URL. `server.use(...)` adds handlers for one test, and `resetHandlers` removes them after the test.
// `await expect(promise).rejects...` waits for the promise and passes only if it rejects with the expected error. Most replies are real Yahoo replies from the fixtures folder.
//
// The tests examine four areas:
//   1. The request: URL, query parameters and the User-Agent header.
//   2. The change of the reply: the client changes the Yahoo reply into an `IntradaySeries` with no data loss.
//   3. The errors: each Yahoo failure becomes the correct domain error, and the client tries again only after transient failures.
//   4. The resilience: timeout, circuit breaker and cancellation by the caller.

import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MarketDataUnavailableError, SymbolNotFoundError } from '../../src/core/errors.js';
import type { IntradayRequest } from '../../src/core/marketDataProvider.js';
import { YahooFinanceClient } from '../../src/infrastructure/yahoo/yahooFinanceClient.js';
import type { YahooFinanceOptions } from '../../src/infrastructure/yahoo/yahooFinanceOptions.js';
import { NOT_FOUND, readFixture, TOKYO, TSLA } from './fixtures.js';

// A host that does not exist. If MSW does not catch a request, the request fails and the test shows it.
const BASE_URL = 'https://yahoo.test';
const CHART_URL = `${BASE_URL}/v8/finance/chart/:symbol`;

/**
 * Options for the tests. The delays are very short, so the tests with retries are fast.
 * Each test makes a new client, so the circuit breaker always starts closed.
 */
const TEST_OPTIONS: YahooFinanceOptions = {
  baseUrl: BASE_URL,
  userAgent: 'TestAgent/1.0',
  interval: '15m',
  timeoutMs: 200,
  retryAttempts: 2,
  retryBaseDelayMs: 1,
  circuitBreakerThreshold: 3,
  circuitBreakerHalfOpenAfterMs: 60_000,
};

const REQUEST: IntradayRequest = {
  symbol: 'TSLA',
  from: new Date('2026-09-13T14:48:44Z'),
  to: new Date('2026-10-16T14:48:44Z'),
};

/** The fields of a raw Yahoo fixture that the tests compare with the result. */
interface RawChart {
  chart: {
    result: [
      {
        meta: { currentTradingPeriod: { regular: { start: number; end: number } } };
        timestamp: number[];
        indicators: {
          quote: [{ low: (number | null)[]; high: (number | null)[]; volume: (number | null)[] }];
        };
      },
    ];
  };
}

function client(overrides: Partial<YahooFinanceOptions> = {}): YahooFinanceClient {
  return new YahooFinanceClient({ ...TEST_OPTIONS, ...overrides });
}

/**
 * Makes MSW give the same reply to each chart request, and counts the requests.
 * The count shows how many attempts the client made.
 */
function replyAlways(reply: () => Response | Promise<Response>): { count: () => number } {
  let count = 0;
  server.use(
    http.get(CHART_URL, () => {
      count += 1;
      return reply();
    }),
  );
  return { count: () => count };
}

// MSW rejects a request without a handler, so a test cannot reach the real Yahoo by accident.
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('YahooFinanceClient', () => {
  describe('request', () => {
    it('sends the symbol, the interval, the exact time range and the User-Agent', async () => {
      // MSW keeps the request, so the test can examine it after the call.
      let captured: Request | undefined;
      server.use(
        http.get(CHART_URL, ({ request }) => {
          captured = request;
          return HttpResponse.json(readFixture(TSLA));
        }),
      );

      await client().getIntradaySeries(REQUEST);

      const url = new URL(captured?.url ?? '');
      expect(url.pathname).toBe('/v8/finance/chart/TSLA');
      expect(url.searchParams.get('interval')).toBe('15m');
      // `period1` and `period2` are the Unix seconds of `from` and `to`.
      expect(url.searchParams.get('period1')).toBe(
        String(Date.parse('2026-09-13T14:48:44Z') / 1000),
      );
      expect(url.searchParams.get('period2')).toBe(
        String(Date.parse('2026-10-16T14:48:44Z') / 1000),
      );
      expect(url.searchParams.get('includePrePost')).toBe('false');
      // The client must not send `range`, because `range` starts in the middle of a day.
      expect(url.searchParams.has('range')).toBe(false);
      // Yahoo refuses requests without a browser User-Agent. The value comes from the options.
      expect(captured?.headers.get('user-agent')).toBe('TestAgent/1.0');
    });

    it('encodes special characters in the symbol', async () => {
      // An index symbol such as ^GSPC has a `^`. The URL path must contain it as `%5E`.
      let path = '';
      server.use(
        http.get(CHART_URL, ({ request }) => {
          path = new URL(request.url).pathname;
          return HttpResponse.json(readFixture(TSLA));
        }),
      );

      await client().getIntradaySeries({ ...REQUEST, symbol: '^GSPC' });

      expect(path).toBe('/v8/finance/chart/%5EGSPC');
    });
  });

  describe('mapping', () => {
    it('changes the TSLA reply into a series with all bars', async () => {
      // The test compares the result with the raw fixture, value by value.
      const raw = readFixture(TSLA) as RawChart;
      const [rawChart] = raw.chart.result;
      const [rawQuote] = rawChart.indicators.quote;
      replyAlways(() => HttpResponse.json(raw));

      const series = await client().getIntradaySeries(REQUEST);

      expect(series.symbol).toBe('TSLA');
      expect(series.exchangeTimeZone).toBe('America/New_York');
      // The current session comes from `meta.currentTradingPeriod.regular`, in Unix seconds.
      // Yahoo also sends `timezone` and `gmtoffset` in this object. The client keeps only `start` and `end`.
      const { start, end } = rawChart.meta.currentTradingPeriod.regular;
      expect(series.currentSession).toEqual({ start, end });
      expect(series.bars).toHaveLength(rawChart.timestamp.length);
      // Bar `i` takes index `i` from each parallel array. Examine the first bar and the last bar.
      for (const index of [0, rawChart.timestamp.length - 1]) {
        expect(series.bars[index]).toEqual({
          timestamp: rawChart.timestamp[index],
          low: rawQuote.low[index],
          high: rawQuote.high[index],
          volume: rawQuote.volume[index],
        });
      }
    });

    it('keeps null values from Yahoo as null', async () => {
      // In the Tokyo fixture, the bars in the lunch break have `null` in all fields.
      // The client must keep `null`, not change it into 0. A low of 0 would be a wrong price.
      const raw = readFixture(TOKYO) as RawChart;
      const nullLows = raw.chart.result[0].indicators.quote[0].low.filter((low) => low === null);
      replyAlways(() => HttpResponse.json(raw));

      const series = await client().getIntradaySeries({ ...REQUEST, symbol: '7203.T' });

      expect(nullLows.length).toBeGreaterThan(0);
      expect(series.bars.filter((bar) => bar.low === null)).toHaveLength(nullLows.length);
    });

    it('gives a series without bars when Yahoo has no bars in the range', async () => {
      // When there are no bars, Yahoo does not send `timestamp`, and the quote object is empty.
      replyAlways(() =>
        HttpResponse.json({
          chart: {
            result: [
              {
                meta: { symbol: 'TSLA', exchangeTimezoneName: 'America/New_York' },
                indicators: { quote: [{}] },
              },
            ],
            error: null,
          },
        }),
      );

      const series = await client().getIntradaySeries(REQUEST);

      expect(series.bars).toEqual([]);
      // Without `currentTradingPeriod`, the client gives `null`. The aggregation then never keeps today.
      expect(series.currentSession).toBeNull();
    });
  });

  describe('errors', () => {
    it('throws SymbolNotFoundError for the Yahoo 404 reply, and does not try again', async () => {
      // A new attempt cannot find a symbol that does not exist, so there must be exactly one request.
      const requests = replyAlways(() =>
        HttpResponse.json(readFixture(NOT_FOUND), { status: 404 }),
      );

      const call = client().getIntradaySeries({ ...REQUEST, symbol: 'ZZZZZZ1' });

      await expect(call).rejects.toBeInstanceOf(SymbolNotFoundError);
      await expect(call).rejects.toMatchObject({ symbol: 'ZZZZZZ1' });
      expect(requests.count()).toBe(1);
    });

    it('tries again after HTTP 500, then throws MarketDataUnavailableError', async () => {
      // `retryAttempts` is 2, so the client sends 1 request and 2 more attempts: 3 requests.
      const requests = replyAlways(() => new HttpResponse(null, { status: 500 }));

      const call = client().getIntradaySeries(REQUEST);

      await expect(call).rejects.toBeInstanceOf(MarketDataUnavailableError);
      await expect(call).rejects.toMatchObject({ reason: 'upstream-error' });
      expect(requests.count()).toBe(3);
    });

    it('gives the data when a new attempt succeeds after HTTP 503', async () => {
      // The first reply fails, the second reply has data. The caller must get the data, not an error.
      let count = 0;
      server.use(
        http.get(CHART_URL, () => {
          count += 1;
          return count === 1
            ? new HttpResponse(null, { status: 503 })
            : HttpResponse.json(readFixture(TSLA));
        }),
      );

      const series = await client().getIntradaySeries(REQUEST);

      expect(series.bars.length).toBeGreaterThan(0);
      expect(count).toBe(2);
    });

    it('marks HTTP 429 as rate-limited', async () => {
      // The HTTP layer can use this reason to tell the user to try again later.
      replyAlways(() => new HttpResponse(null, { status: 429 }));

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'rate-limited',
      });
    });

    it('tries again after a network error, then throws MarketDataUnavailableError', async () => {
      // `HttpResponse.error()` makes `fetch` fail as if the connection broke.
      const requests = replyAlways(() => HttpResponse.error());

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'upstream-error',
      });
      expect(requests.count()).toBe(3);
    });

    it('does not try again after HTTP 403', async () => {
      // A 4xx status other than 404 and 429 does not change with a new attempt.
      const requests = replyAlways(() => new HttpResponse(null, { status: 403 }));

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'upstream-error',
      });
      expect(requests.count()).toBe(1);
    });

    it('throws invalid-response for a body that is not JSON, and does not try again', async () => {
      const requests = replyAlways(
        () => new HttpResponse('<html>', { headers: { 'Content-Type': 'application/json' } }),
      );

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'invalid-response',
      });
      expect(requests.count()).toBe(1);
    });

    it('throws invalid-response when a required field is missing', async () => {
      // The result has no `meta` and no `indicators`. The schema must reject it.
      replyAlways(() => HttpResponse.json({ chart: { result: [{}], error: null } }));

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'invalid-response',
      });
    });

    it('throws invalid-response for an unknown time zone', async () => {
      // Without a valid time zone, the aggregation cannot find the date of a bar.
      replyAlways(() =>
        HttpResponse.json({
          chart: {
            result: [
              {
                meta: { symbol: 'TSLA', exchangeTimezoneName: 'Mars/Olympus_Mons' },
                indicators: { quote: [{}] },
              },
            ],
            error: null,
          },
        }),
      );

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'invalid-response',
      });
    });

    it('throws invalid-response when the parallel arrays have different lengths', async () => {
      // Two timestamps, but only one low. The client cannot know which bar the low is for.
      replyAlways(() =>
        HttpResponse.json({
          chart: {
            result: [
              {
                meta: { symbol: 'TSLA', exchangeTimezoneName: 'America/New_York' },
                timestamp: [1, 2],
                indicators: { quote: [{ low: [1], high: [1, 2], volume: [1, 2] }] },
              },
            ],
            error: null,
          },
        }),
      );

      await expect(client().getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'invalid-response',
      });
    });
  });

  describe('resilience', () => {
    it('stops an attempt that takes longer than the timeout', async () => {
      // The reply comes after 1 second, but the time limit is 50 ms. No retries, so the test is fast.
      replyAlways(async () => {
        await delay(1_000);
        return HttpResponse.json(readFixture(TSLA));
      });

      await expect(
        client({ timeoutMs: 50, retryAttempts: 0 }).getIntradaySeries(REQUEST),
      ).rejects.toMatchObject({ reason: 'timeout' });
    });

    it('opens the circuit after the threshold, and then sends no requests', async () => {
      // The threshold is 3, with no retries. Each of the first 3 calls sends one request and fails.
      // The 4th call must fail immediately with `circuit-open`, without a request to Yahoo.
      const requests = replyAlways(() => new HttpResponse(null, { status: 500 }));
      const yahoo = client({ retryAttempts: 0 });

      for (let call = 0; call < 3; call += 1) {
        await expect(yahoo.getIntradaySeries(REQUEST)).rejects.toMatchObject({
          reason: 'upstream-error',
        });
      }
      await expect(yahoo.getIntradaySeries(REQUEST)).rejects.toMatchObject({
        reason: 'circuit-open',
      });
      expect(requests.count()).toBe(3);
    });

    it('does not open the circuit for symbols that do not exist', async () => {
      // Many 404 replies do not mean that Yahoo is down. The circuit must stay closed.
      const requests = replyAlways(() =>
        HttpResponse.json(readFixture(NOT_FOUND), { status: 404 }),
      );
      const yahoo = client({ retryAttempts: 0 });

      for (let call = 0; call < 5; call += 1) {
        await expect(yahoo.getIntradaySeries(REQUEST)).rejects.toBeInstanceOf(SymbolNotFoundError);
      }
      expect(requests.count()).toBe(5);
    });

    it('gives the abort reason when the caller cancels the request', async () => {
      // The caller aborts after 20 ms. The client must not change this into a market data error,
      // because the cancellation is not a failure of Yahoo.
      replyAlways(async () => {
        await delay(1_000);
        return HttpResponse.json(readFixture(TSLA));
      });
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 20);

      const call = client({ timeoutMs: 5_000 }).getIntradaySeries(REQUEST, controller.signal);

      await expect(call).rejects.toMatchObject({ name: 'AbortError' });
      await expect(call).rejects.not.toBeInstanceOf(MarketDataUnavailableError);
    });
  });
});
