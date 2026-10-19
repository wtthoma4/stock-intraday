// These tests send the real Yahoo fixtures through the client and the aggregation together.
// They make sure that the rules for complete days work on real data, not only on made-up data.
//
// For each fixture, "now" is the time of the request for the fixture. The expected days come from
// a manual count of the fixture bars by exchange date. They do not come from this code.

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { aggregateDailySummaries } from '../../src/core/aggregateDailySummaries.js';
import { dataRangeFor } from '../../src/core/summaryWindow.js';
import { YahooFinanceClient } from '../../src/infrastructure/yahoo/yahooFinanceClient.js';
import {
  readFixture,
  SYDNEY,
  SYDNEY_FETCHED_AT,
  TOKYO,
  TOKYO_FETCHED_AT,
  TSLA,
  TSLA_FETCHED_AT,
} from './fixtures.js';

const BASE_URL = 'https://yahoo.test';

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

/** Gives the daily summaries for a fixture, as the service will calculate them at the time `now`. */
async function summariesFor(fixture: string, symbol: string, now: Date) {
  server.use(
    http.get(`${BASE_URL}/v8/finance/chart/:symbol`, () => HttpResponse.json(readFixture(fixture))),
  );
  const client = new YahooFinanceClient({
    baseUrl: BASE_URL,
    userAgent: 'TestAgent/1.0',
    interval: '15m',
    timeoutMs: 1_000,
    retryAttempts: 0,
    retryBaseDelayMs: 1,
    circuitBreakerThreshold: 5,
    circuitBreakerHalfOpenAfterMs: 60_000,
  });
  const series = await client.getIntradaySeries({ symbol, ...dataRangeFor(now) });
  return aggregateDailySummaries(series, now);
}

describe('real fixtures through the client and the aggregation', () => {
  it('TSLA: removes the partial first day and today, which is still open', async () => {
    // "Now" is 10:48 on Friday 16 October in New York. The window starts on 16 September.
    // The fixture has 25 dates, from 14 September to 16 October:
    // - 14 September has only 21 bars (it starts at 10:45). It is before the window, so it goes.
    // - 15 September is complete, but it is also before the window, so it goes.
    // - 16 October is today. The session closes at 16:00, so today goes.
    // 25 - 3 = 22 days stay, from 16 September to 15 October.
    const summaries = await summariesFor(TSLA, 'TSLA', TSLA_FETCHED_AT);

    expect(summaries).toHaveLength(22);
    expect(summaries[0]?.day).toBe('2026-09-16');
    expect(summaries.at(-1)?.day).toBe('2026-10-15');
  });

  it('Tokyo: keeps today, because the session closed before "now"', async () => {
    // "Now" is 23:48 on 16 October in Tokyo. The session of 16 October closed at 15:30 (06:30 UTC).
    // The window starts on 16 September. The fixture has 20 dates, from 15 September to 16 October.
    // Only 15 September is before the window. 20 - 1 = 19 days stay, and the last day is today.
    const summaries = await summariesFor(TOKYO, '7203.T', TOKYO_FETCHED_AT);

    expect(summaries).toHaveLength(19);
    expect(summaries[0]?.day).toBe('2026-09-16');
    expect(summaries.at(-1)?.day).toBe('2026-10-16');
  });

  it('Tokyo: ignores the lunch break bars, which have null prices', async () => {
    // The bars from 11:45 to 12:15 have `null` in all fields. If the client or the aggregation
    // changed `null` into 0, the low average would be far below the real prices (about 3,000 JPY).
    const summaries = await summariesFor(TOKYO, '7203.T', TOKYO_FETCHED_AT);

    for (const summary of summaries) {
      expect(summary.lowAverage).toBeGreaterThan(1_000);
    }
  });

  it('Sydney: groups the sessions that start before midnight UTC on the correct date', async () => {
    // "Now" is 01:34 on Saturday 17 October in Sydney, so today has no session and Friday 16 October is complete.
    // The window starts on 17 September. The fixture has 24 Sydney dates, from 15 September to 16 October.
    // 15 and 16 September are before the window. 24 - 2 = 22 days stay.
    // With UTC dates, the same bars are on 26 dates, so days by UTC date give more days than this.
    const summaries = await summariesFor(SYDNEY, 'BHP.AX', SYDNEY_FETCHED_AT);

    expect(summaries).toHaveLength(22);
    expect(summaries[0]?.day).toBe('2026-09-17');
    expect(summaries.at(-1)?.day).toBe('2026-10-16');
  });
});
