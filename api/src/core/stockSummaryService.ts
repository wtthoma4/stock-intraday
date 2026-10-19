import { aggregateDailySummaries } from './aggregateDailySummaries.js';
import type { Clock } from './clock.js';
import type { DailySummary } from './dailySummary.js';
import type { DailySummaryService } from './dailySummaryService.js';
import type { MarketDataProvider } from './marketDataProvider.js';
import { dataRangeFor } from './summaryWindow.js';
import { normalizeSymbol } from './symbol.js';

/**
 * Calculates the daily summaries of the last month from the intraday bars of a market data provider.
 *
 * This class connects the parts of the core layer. It does not know Yahoo, HTTP or the cache.
 */
export class StockSummaryService implements DailySummaryService {
  // Each `private readonly` parameter is TypeScript shorthand: it makes a private property with the same name
  // and sets it from the parameter. The class gets its provider and clock from outside (dependency injection),
  // so a test can give a stub provider and a fixed clock.
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly clock: Clock,
  ) {}

  // `async` makes the method give a `Promise`. `await` waits for another promise in the method.
  async getDailySummaries(symbol: string, signal?: AbortSignal): Promise<readonly DailySummary[]> {
    // Find a bad symbol before the request to the provider. This throws `InvalidSymbolError`.
    const normalizedSymbol = normalizeSymbol(symbol);

    // Read the clock one time. The data range and the window of complete days must use the same "now".
    // With two different times, a session could close between the two reads. Then the aggregation
    // would keep today, but the data would not contain the last bars of today.
    const now = this.clock.now();

    // The range starts some days before the window, so the first day of the window has all its bars.
    // `...dataRangeFor(now)` copies the `from` and `to` properties of the range into the request object.
    const series = await this.provider.getIntradaySeries(
      { symbol: normalizedSymbol, ...dataRangeFor(now) },
      signal,
    );

    // The service does not catch the errors of the provider (`SymbolNotFoundError`,
    // `MarketDataUnavailableError` or an abort). They go to the caller with no change.
    return aggregateDailySummaries(series, now);
  }
}
