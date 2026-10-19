// `import type` imports only a type. The compiler removes it, so it has no cost at runtime.
import type { IntradaySeries } from './intradaySeries.js';

/** A request for intraday bars of one symbol in a time range. */
export interface IntradayRequest {
  /** The symbol in upper case, for example `TSLA`. */
  readonly symbol: string;
  /** The start of the range (included). */
  readonly from: Date;
  /** The end of the range. */
  readonly to: Date;
}

/**
 * A source of intraday bars. The core layer owns this interface. The infrastructure layer has a class
 * that `implements` it (`YahooFinanceClient`).
 * To use a different data vendor, add a new class with `implements MarketDataProvider`.
 * The aggregation and the HTTP layer do not change.
 *
 * An implementation gives only these errors:
 * - `SymbolNotFoundError` if the symbol does not exist.
 * - `MarketDataUnavailableError` if the data is not available now.
 * - The abort reason of `signal` if the caller cancels the request.
 */
export interface MarketDataProvider {
  // `signal?` is an optional parameter. An `AbortSignal` comes from an `AbortController`: when the caller calls
  // `controller.abort()`, the signal tells the provider to stop the request. `Promise<IntradaySeries>` means
  // that the method is asynchronous: it gives the series later, or it rejects with one of the errors above.
  getIntradaySeries(request: IntradayRequest, signal?: AbortSignal): Promise<IntradaySeries>;
}
