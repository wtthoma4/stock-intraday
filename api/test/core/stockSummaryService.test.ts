// These tests examine `StockSummaryService`, which connects the provider, the clock and the aggregation.
//
// The tests use a stub provider. The stub keeps each request, so a test can examine what the service asked for.
// The aggregation has its own tests. Here, the tests examine only how the service calls the parts.

import { describe, expect, it } from 'vitest';

import { InvalidSymbolError, SymbolNotFoundError } from '../../src/core/errors.js';
import type { IntradaySeries } from '../../src/core/intradaySeries.js';
import type { IntradayRequest, MarketDataProvider } from '../../src/core/marketDataProvider.js';
import { StockSummaryService } from '../../src/core/stockSummaryService.js';
import { dataRangeFor } from '../../src/core/summaryWindow.js';
import { FakeClock } from '../support/fakeClock.js';

// Friday 16 October 2026, 18:00 in New York, after the close.
const NOW = new Date('2026-10-16T22:00:00Z');

/** A provider that keeps each request and gives a fixed series, or throws a fixed error. */
class StubProvider implements MarketDataProvider {
  readonly requests: { request: IntradayRequest; signal: AbortSignal | undefined }[] = [];

  constructor(private readonly reply: IntradaySeries | Error) {}

  getIntradaySeries(request: IntradayRequest, signal?: AbortSignal): Promise<IntradaySeries> {
    this.requests.push({ request, signal });
    return this.reply instanceof Error ? Promise.reject(this.reply) : Promise.resolve(this.reply);
  }
}

/**
 * A series with one bar on 15 October and one bar on 16 October (today).
 * The session of today closes at 16:00 in New York.
 */
const SERIES: IntradaySeries = {
  symbol: 'TSLA',
  exchangeTimeZone: 'America/New_York',
  currentSession: {
    start: Date.parse('2026-10-16T09:30:00-04:00') / 1000,
    end: Date.parse('2026-10-16T16:00:00-04:00') / 1000,
  },
  bars: [
    { timestamp: Date.parse('2026-10-15T10:00:00-04:00') / 1000, low: 1, high: 2, volume: 10 },
    { timestamp: Date.parse('2026-10-16T10:00:00-04:00') / 1000, low: 3, high: 4, volume: 20 },
  ],
};

describe('StockSummaryService', () => {
  it('asks the provider for the normalized symbol and the data range of "now"', async () => {
    const provider = new StubProvider(SERIES);
    const service = new StockSummaryService(provider, new FakeClock(NOW));

    await service.getDailySummaries(' tsla ');

    // The provider gets the upper-case symbol and the 33-day range that ends at "now".
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.request).toEqual({ symbol: 'TSLA', ...dataRangeFor(NOW) });
  });

  it('reads the clock one time, and aggregates with the same "now" as the data range', async () => {
    // This clock gives 15:00 (before the close) at the first read, and 18:00 (after the close) at the next read.
    // If the service read the clock again for the aggregation, it would keep today with data from 15:00.
    // The correct service reads the clock one time, so today is not complete and is not in the result.
    const times = [new Date('2026-10-16T15:00:00-04:00'), new Date('2026-10-16T18:00:00-04:00')];
    let reads = 0;
    const steppingClock = {
      now: (): Date => times[Math.min(reads++, times.length - 1)] ?? NOW,
    };
    const service = new StockSummaryService(new StubProvider(SERIES), steppingClock);

    const summaries = await service.getDailySummaries('TSLA');

    expect(reads).toBe(1);
    expect(summaries.map((summary) => summary.day)).toEqual(['2026-10-15']);
  });

  it('keeps today when "now" is after the close', async () => {
    // "Now" is 18:00 on 16 October in New York, after the close. Today is complete.
    const service = new StockSummaryService(new StubProvider(SERIES), new FakeClock(NOW));

    const summaries = await service.getDailySummaries('TSLA');

    expect(summaries.map((summary) => summary.day)).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('removes today when "now" is before the close', async () => {
    // The same series, but "now" is 15:00 in New York. Today is not complete.
    const service = new StockSummaryService(
      new StubProvider(SERIES),
      new FakeClock(new Date('2026-10-16T15:00:00-04:00')),
    );

    const summaries = await service.getDailySummaries('TSLA');

    expect(summaries.map((summary) => summary.day)).toEqual(['2026-10-15']);
  });

  it('gives the signal of the caller to the provider', async () => {
    // Without the signal, a cancelled HTTP request would still wait for Yahoo.
    const provider = new StubProvider(SERIES);
    const service = new StockSummaryService(provider, new FakeClock(NOW));
    const controller = new AbortController();

    await service.getDailySummaries('TSLA', controller.signal);

    expect(provider.requests[0]?.signal).toBe(controller.signal);
  });

  it('throws InvalidSymbolError and does not call the provider for a bad symbol', async () => {
    const provider = new StubProvider(SERIES);
    const service = new StockSummaryService(provider, new FakeClock(NOW));

    await expect(service.getDailySummaries('TSLA!!')).rejects.toBeInstanceOf(InvalidSymbolError);
    expect(provider.requests).toHaveLength(0);
  });

  it('gives errors from the provider with no change', async () => {
    // The HTTP layer changes domain errors into status codes. The service must not hide them.
    const error = new SymbolNotFoundError('ZZZZZZ1');
    const service = new StockSummaryService(new StubProvider(error), new FakeClock(NOW));

    await expect(service.getDailySummaries('ZZZZZZ1')).rejects.toBe(error);
  });
});
