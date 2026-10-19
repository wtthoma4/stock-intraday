// This file is the only place that knows the Yahoo Finance chart API.
// It sends the HTTP request, makes the request resilient, and changes the Yahoo reply into the core types.
// No Yahoo type and no Yahoo error goes out of this file.

// cockatiel is a library of resilience policies (retry, circuit breaker, timeout). Each policy wraps a function
// and decides what to do when the function fails. `type IPolicy` imports only a type, so it has no cost at runtime.
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TaskCancelledError,
  TimeoutStrategy,
  circuitBreaker,
  handleWhen,
  retry,
  timeout,
  wrap,
  type IPolicy,
} from 'cockatiel';

import { DomainError, MarketDataUnavailableError, SymbolNotFoundError } from '../../core/errors.js';
import type { IntradayBar, IntradaySeries } from '../../core/intradaySeries.js';
import type { IntradayRequest, MarketDataProvider } from '../../core/marketDataProvider.js';
import { yahooChartResponseSchema, type YahooChartResult } from './yahooChartResponse.js';
import type { YahooFinanceOptions } from './yahooFinanceOptions.js';

/**
 * The longest delay between two attempts.
 * Without a limit, the exponential delay can become longer than a user waits for a reply.
 */
const MAX_RETRY_DELAY_MS = 5_000;

/**
 * A failure that can stop if the client tries again: a network error, HTTP 429 or HTTP 5xx.
 * The retry policy and the circuit breaker look for this class.
 * It does not go out of this file. `toDomainError` changes it into `MarketDataUnavailableError`.
 */
class TransientUpstreamError extends Error {
  constructor(
    readonly reason: 'rate-limited' | 'upstream-error',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TransientUpstreamError';
  }
}

/**
 * Gets intraday bars from the unofficial Yahoo Finance chart API.
 *
 * Yahoo has no service level agreement and limits the request rate. Because of this, each request goes through three policies.
 * The first policy in the list is the outermost:
 * 1. The retry policy tries again after a transient failure. The delay increases after each attempt.
 * 2. The circuit breaker counts failed attempts in a sequence. After too many, it stops all requests for a time.
 *    This protects Yahoo and our rate limit when Yahoo is down, and the user gets an error immediately.
 * 3. The timeout policy cancels one attempt that takes too long. Each attempt gets its own time limit.
 *
 * Make one instance for the application. The circuit breaker keeps its state in the instance.
 */
export class YahooFinanceClient implements MarketDataProvider {
  private readonly policy: IPolicy;

  // `private readonly options` in the parameter list makes a private property `options` from the parameter.
  constructor(private readonly options: YahooFinanceOptions) {
    // Only transient failures go into the retry and the circuit breaker.
    // A 404 or an invalid reply does not change with a new attempt, so the client does not try again.
    // These errors also do not open the circuit, because Yahoo itself is available.
    // `TaskCancelledError` comes from the timeout policy when one attempt takes too long.
    const transientFailures = handleWhen(
      (error) => error instanceof TransientUpstreamError || error instanceof TaskCancelledError,
    );

    this.policy = wrap(
      retry(transientFailures, {
        // The number of attempts after the first attempt.
        maxAttempts: options.retryAttempts,
        // The default generator adds random jitter, so many clients do not try again at the same time.
        backoff: new ExponentialBackoff({
          initialDelay: options.retryBaseDelayMs,
          maxDelay: MAX_RETRY_DELAY_MS,
        }),
      }),
      circuitBreaker(transientFailures, {
        // The circuit opens after this number of failures in a sequence. One success sets the count to 0.
        breaker: new ConsecutiveBreaker(options.circuitBreakerThreshold),
        // After this time, the circuit lets one request through. If it succeeds, the circuit closes.
        halfOpenAfter: options.circuitBreakerHalfOpenAfterMs,
      }),
      // "Aggressive" stops the wait at the time limit, and also aborts the `fetch` through the signal.
      timeout(options.timeoutMs, TimeoutStrategy.Aggressive),
    );
  }

  async getIntradaySeries(request: IntradayRequest, signal?: AbortSignal): Promise<IntradaySeries> {
    const url = this.chartUrl(request);
    try {
      // The policies give each attempt its own signal. This signal aborts when the attempt times out,
      // or when the caller aborts `signal`.
      return await this.policy.execute(
        ({ signal: attemptSignal }) => this.fetchSeries(url, request.symbol, attemptSignal),
        signal,
      );
    } catch (error) {
      // If the caller cancelled the request (for example, the browser closed the connection),
      // give the abort reason. A cancelled request is not a failure of Yahoo.
      if (signal?.aborted) {
        throw signal.reason;
      }
      throw toDomainError(error);
    }
  }

  /**
   * Makes the request URL. Example:
   * `https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=15m&period1=...&period2=...&includePrePost=false`
   */
  private chartUrl({ symbol, from, to }: IntradayRequest): URL {
    // Symbols can contain `^` and `=` (for example `^GSPC` and `EURUSD=X`), so the code encodes the path segment.
    const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, this.options.baseUrl);
    // `searchParams.set` adds a query parameter and encodes its value, so the code does not join text by hand.
    url.searchParams.set('interval', this.options.interval);
    // Yahoo uses Unix seconds. The client sends an exact time range, not `range=1mo`.
    // `range=1mo` starts one month before the current time, so the first day has only part of its bars.
    url.searchParams.set('period1', String(Math.floor(from.getTime() / 1000)));
    url.searchParams.set('period2', String(Math.floor(to.getTime() / 1000)));
    // Only the regular session. Pre-market and after-hours bars do not go into the daily summaries.
    url.searchParams.set('includePrePost', 'false');
    return url;
  }

  /**
   * Does one HTTP attempt. The policies call this method one or more times.
   * It gives a series, or it throws one of these errors:
   * - `TransientUpstreamError`: the policies try again.
   * - `SymbolNotFoundError` or `MarketDataUnavailableError`: the policies do not try again.
   * - An abort error: the timeout policy or the caller stopped the attempt.
   */
  private async fetchSeries(
    url: URL,
    symbol: string,
    signal: AbortSignal,
  ): Promise<IntradaySeries> {
    // Step 1: send the request.
    let response: Response;
    try {
      response = await fetch(url, {
        // Yahoo refuses requests without the User-Agent of a browser.
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal,
      });
    } catch (error) {
      // If the signal aborted, the timeout policy or the caller stopped the request. The policies make the decision for this error.
      if (signal.aborted) {
        throw error;
      }
      // Otherwise, `fetch` could not get a reply: DNS, connection or TLS failure. A new attempt can succeed.
      throw new TransientUpstreamError('upstream-error', 'The request to Yahoo failed.', {
        cause: error,
      });
    }

    // Step 2: examine the HTTP status.
    // Yahoo answers HTTP 404 with `chart.error.code = "Not Found"` for a symbol that it does not know.
    if (response.status === 404) {
      throw new SymbolNotFoundError(symbol);
    }
    // Yahoo limits the request rate. After a delay, a new attempt can succeed.
    if (response.status === 429) {
      throw new TransientUpstreamError('rate-limited', 'Yahoo refused the request (HTTP 429).');
    }
    // A server error at Yahoo is usually temporary.
    if (response.status >= 500) {
      throw new TransientUpstreamError(
        'upstream-error',
        `Yahoo failed with HTTP ${String(response.status)}.`,
      );
    }
    // Other 4xx statuses (for example 401 or 403) do not change with a new attempt.
    // `response.ok` is `true` for a status from 200 to 299.
    if (!response.ok) {
      throw new MarketDataUnavailableError(
        'upstream-error',
        `Yahoo gave the unexpected status HTTP ${String(response.status)}.`,
      );
    }

    // Step 3: read the body as JSON.
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new MarketDataUnavailableError('invalid-response', 'Yahoo did not send valid JSON.', {
        cause: error,
      });
    }

    // Step 4: make sure that the body has the expected shape. The data comes from outside, so do not trust it.
    const parsed = yahooChartResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new MarketDataUnavailableError(
        'invalid-response',
        'The Yahoo reply does not have the expected shape.',
        { cause: parsed.error },
      );
    }

    // Step 5: Yahoo can also send an error in a body with HTTP 200.
    const { result, error } = parsed.data.chart;
    if (error?.code === 'Not Found') {
      throw new SymbolNotFoundError(symbol);
    }
    // `result?.[0]` gives `undefined` if `result` is `null`, or the first item if not.
    const chart = result?.[0];
    if (error !== null || chart === undefined) {
      throw new MarketDataUnavailableError(
        'invalid-response',
        `Yahoo sent no chart data${error === null ? '' : `: ${error.code}`}.`,
      );
    }

    // Step 6: change the Yahoo chart into the core type.
    return toIntradaySeries(chart);
  }
}

/** Changes the Yahoo chart into the core type. */
function toIntradaySeries(chart: YahooChartResult): IntradaySeries {
  // Yahoo does not send `timestamp` or the quote arrays when there are no bars in the range.
  // This is not an error: the result is a series without bars.
  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators.quote[0] ?? {};
  const { low = [], high = [], volume = [] } = quote;

  // The arrays are parallel: index `i` in each array is bar `i`.
  // If one array has a different length, the values do not match their bars, so the data is not usable.
  if (
    timestamps.length > 0 &&
    [low, high, volume].some((values) => values.length !== timestamps.length)
  ) {
    throw new MarketDataUnavailableError(
      'invalid-response',
      'The Yahoo quote arrays do not have the same length as the timestamps.',
    );
  }

  // Yahoo sends `null` for a bar without trades, for example during the lunch break in Tokyo.
  // The core types keep `null`. The aggregation decides what to do with it.
  const bars: IntradayBar[] = timestamps.map((timestamp, index) => ({
    timestamp,
    low: low[index] ?? null,
    high: high[index] ?? null,
    volume: volume[index] ?? null,
  }));

  // `currentTradingPeriod.regular` is the session that Yahoo calls "current".
  // The aggregation uses it to decide if today is complete.
  const regular = chart.meta.currentTradingPeriod?.regular;
  return {
    symbol: chart.meta.symbol,
    exchangeTimeZone: chart.meta.exchangeTimezoneName,
    currentSession: regular === undefined ? null : { start: regular.start, end: regular.end },
    bars,
  };
}

/**
 * Changes the errors from the policies into domain errors, which the HTTP layer knows.
 * An unknown error is a programming error. The function gives it back with no change, so that a log
 * does not show it as "market data unavailable".
 */
function toDomainError(error: unknown): unknown {
  // `SymbolNotFoundError` and `MarketDataUnavailableError` are already correct.
  if (error instanceof DomainError) {
    return error;
  }
  // The last attempt failed with a transient failure. The client used all retries.
  if (error instanceof TransientUpstreamError) {
    return new MarketDataUnavailableError(error.reason, error.message, { cause: error });
  }
  // The last attempt took too long. The caller did not abort, because `getIntradaySeries` examines that first.
  if (error instanceof TaskCancelledError) {
    return new MarketDataUnavailableError('timeout', 'Yahoo did not reply in time.', {
      cause: error,
    });
  }
  // The circuit is open. The client did not send a request.
  if (error instanceof BrokenCircuitError) {
    return new MarketDataUnavailableError(
      'circuit-open',
      'Requests to Yahoo are stopped for a time after too many failures.',
      { cause: error },
    );
  }
  return error;
}
