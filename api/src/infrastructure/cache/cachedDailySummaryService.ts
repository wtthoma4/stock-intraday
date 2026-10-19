// This file adds a cache in front of a `DailySummaryService`.
//
// Why the cache keeps the summaries, and not the raw Yahoo bars:
// The summaries depend on "now". The aggregation keeps today only after the session closes.
// If the cache kept bars from 15:58 and the aggregation used "now" = 16:01, the result would keep today
// with an incomplete last bar. The cache keeps the result that the service calculated with one "now",
// so each cached result is correct for its time. It can only be older than the TTL.

// `LRUCache` is a map with a maximum size. When it is full, it removes the entry that nobody read for the longest time.
import { LRUCache } from 'lru-cache';

import type { Clock } from '../../core/clock.js';
import type { DailySummary } from '../../core/dailySummary.js';
import type { DailySummaryService } from '../../core/dailySummaryService.js';
import { normalizeSymbol } from '../../core/symbol.js';

export interface CacheOptions {
  /** The time that a result stays in the cache. */
  readonly ttlMs: number;
  /** The maximum number of symbols in the cache. When the cache is full, the least recently used symbol goes. */
  readonly maxEntries: number;
}

/** A cached result and the time (in milliseconds) after which it is too old. */
interface CacheEntry {
  readonly summaries: readonly DailySummary[];
  readonly expiresAt: number;
}

/**
 * A `DailySummaryService` that keeps each result for a time, for each symbol.
 *
 * - A request in the TTL gets the cached result. Yahoo gets no request.
 * - Concurrent requests for the same symbol share one request to the next service.
 * - The cache does not keep errors. The next request tries again.
 * - The cache uses the injected clock for the TTL, so tests can move the time.
 */
export class CachedDailySummaryService implements DailySummaryService {
  /**
   * The results. `LRUCache` limits the memory. The TTL check uses the clock, not `LRUCache`.
   * `<string, CacheEntry>` gives the types of the keys (symbols) and of the values.
   */
  private readonly entries: LRUCache<string, CacheEntry>;

  /**
   * The requests that are not complete, for each symbol. A second request for a symbol waits for the first.
   * A `Promise` is a value that is available later. Many callers can `await` the same promise.
   */
  private readonly inFlight = new Map<string, Promise<readonly DailySummary[]>>();

  // Each `private readonly` parameter makes a private property with the same name.
  constructor(
    private readonly inner: DailySummaryService,
    private readonly clock: Clock,
    private readonly options: CacheOptions,
  ) {
    this.entries = new LRUCache({ max: options.maxEntries });
  }

  async getDailySummaries(symbol: string, signal?: AbortSignal): Promise<readonly DailySummary[]> {
    // If the caller already cancelled, do nothing. `throwIfAborted` throws the abort reason if the signal aborted.
    // `signal?.` calls the method only if there is a signal.
    signal?.throwIfAborted();

    // `tsla` and `TSLA` are the same symbol, so they use the same entry. An invalid symbol throws here.
    const key = normalizeSymbol(symbol);

    // 1. A result in the TTL: give it immediately.
    const cached = this.entries.get(key);
    if (cached !== undefined && this.clock.now().getTime() < cached.expiresAt) {
      return cached.summaries;
    }

    // 2. A request for this symbol is in progress: wait for it. Otherwise, start a new request.
    let pending = this.inFlight.get(key);
    if (pending === undefined) {
      pending = this.load(key);
      this.inFlight.set(key, pending);
    }

    // Each caller can cancel its own wait. The shared request continues for the other callers.
    return await untilAborted(pending, signal);
  }

  /**
   * Gets the result from the next service and keeps it in the cache.
   * This request does not get the signal of a caller. If one caller cancels, the other callers still need the result.
   * The timeout of the market data provider stops a request that takes too long.
   */
  private async load(key: string): Promise<readonly DailySummary[]> {
    // `finally` runs after the `try` block, also when the `try` block throws an error.
    try {
      const summaries = await this.inner.getDailySummaries(key);
      // The TTL starts when the result is complete, not when the request started.
      this.entries.set(key, {
        summaries,
        expiresAt: this.clock.now().getTime() + this.options.ttlMs,
      });
      return summaries;
    } finally {
      // Remove the request after success or failure. After a failure, the next request tries again.
      this.inFlight.delete(key);
    }
  }
}

/**
 * Waits for `promise`, but stops the wait when `signal` aborts. The abort does not stop `promise` itself.
 * If `signal` aborts first, the result is a rejection with the abort reason.
 * `<T>` is a type parameter: the function works for a promise of any type, and gives the same type back.
 */
async function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  // This promise rejects when the signal aborts. It never resolves, so its type is `Promise<never>`.
  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // `Promise.race` settles with the first of the promises that settles: the shared request or the abort.
    return await Promise.race([promise, aborted]);
  } finally {
    // Remove the listener, so a signal that lives longer does not keep this request in memory.
    signal.removeEventListener('abort', onAbort);
  }
}
