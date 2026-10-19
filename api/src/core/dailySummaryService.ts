import type { DailySummary } from './dailySummary.js';

/**
 * Gives the daily summaries of the last month for one symbol. The HTTP layer depends only on this interface.
 *
 * `StockSummaryService` calculates the summaries from market data.
 * A decorator (for example, a cache) can add behavior without a change to the calculation or to the HTTP layer.
 *
 * The result is read-only, because a cache can give the same array to many callers.
 */
export interface DailySummaryService {
  getDailySummaries(symbol: string, signal?: AbortSignal): Promise<readonly DailySummary[]>;
}
