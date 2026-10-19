// These tests examine `CachedDailySummaryService`, the cache in front of the summary service.
//
// The tests use a stub inner service. The test controls when each inner request completes,
// so it can make concurrent requests and failures on purpose. The stub also counts the inner requests.
// The count shows if a request went to the inner service (and so to Yahoo) or came from the cache.
//
// The cache uses a fake clock for the TTL, so a test can move the time without a real wait.

import { describe, expect, it } from 'vitest';

import type { DailySummary } from '../../src/core/dailySummary.js';
import type { DailySummaryService } from '../../src/core/dailySummaryService.js';
import { InvalidSymbolError, MarketDataUnavailableError } from '../../src/core/errors.js';
import { CachedDailySummaryService } from '../../src/infrastructure/cache/cachedDailySummaryService.js';
import { FakeClock } from '../support/fakeClock.js';

const TTL_MS = 5 * 60 * 1000;

/** A result with one day. The volume tells which inner request made the result. */
function summariesWithVolume(volume: number): DailySummary[] {
  return [{ day: '2026-10-15', lowAverage: 1, highAverage: 2, volume }];
}

/**
 * An inner service. Each call waits until the test calls `resolveNext` or `rejectNext`.
 * The calls complete in the order that they started.
 */
class ControlledService implements DailySummaryService {
  readonly calls: string[] = [];
  private readonly waiting: {
    resolve: (value: readonly DailySummary[]) => void;
    reject: (error: Error) => void;
  }[] = [];

  getDailySummaries(symbol: string, signal?: AbortSignal): Promise<readonly DailySummary[]> {
    this.calls.push(symbol);
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      // As a real service, stop when the signal aborts. Then a test can see if the cache
      // gives the signal of one caller to the shared request, which would stop it for all callers.
      signal?.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
    });
  }

  resolveNext(summaries: readonly DailySummary[]): void {
    this.waiting.shift()?.resolve(summaries);
  }

  rejectNext(error: Error): void {
    this.waiting.shift()?.reject(error);
  }
}

/** An inner service that completes immediately. The result volume is the number of the call. */
class CountingService implements DailySummaryService {
  readonly calls: string[] = [];

  getDailySummaries(symbol: string): Promise<readonly DailySummary[]> {
    this.calls.push(symbol);
    return Promise.resolve(summariesWithVolume(this.calls.length));
  }
}

function cacheFor(inner: DailySummaryService, clock: FakeClock, maxEntries = 100) {
  return new CachedDailySummaryService(inner, clock, { ttlMs: TTL_MS, maxEntries });
}

describe('CachedDailySummaryService', () => {
  it('gives the cached result in the TTL, without a new inner request', async () => {
    const inner = new CountingService();
    const clock = new FakeClock(new Date('2026-10-16T22:00:00Z'));
    const cache = cacheFor(inner, clock);

    const first = await cache.getDailySummaries('TSLA');
    // One millisecond before the TTL ends, the result is still valid.
    clock.advance(TTL_MS - 1);
    const second = await cache.getDailySummaries('TSLA');

    expect(inner.calls).toEqual(['TSLA']);
    expect(second).toBe(first);
  });

  it('sends a new inner request when the TTL has ended', async () => {
    const inner = new CountingService();
    const clock = new FakeClock(new Date('2026-10-16T22:00:00Z'));
    const cache = cacheFor(inner, clock);

    await cache.getDailySummaries('TSLA');
    // At the exact end of the TTL, the result is too old.
    clock.advance(TTL_MS);
    const second = await cache.getDailySummaries('TSLA');

    // The second result comes from the second inner call (volume 2).
    expect(inner.calls).toEqual(['TSLA', 'TSLA']);
    expect(second[0]?.volume).toBe(2);
  });

  it('uses one entry for the same symbol in different letter case', async () => {
    // `tsla` and `TSLA` are one symbol. Two entries would send two requests to Yahoo.
    const inner = new CountingService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    await cache.getDailySummaries('tsla');
    await cache.getDailySummaries(' TSLA ');

    expect(inner.calls).toEqual(['TSLA']);
  });

  it('keeps a separate entry for each symbol', async () => {
    const inner = new CountingService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    await cache.getDailySummaries('TSLA');
    await cache.getDailySummaries('AAPL');

    expect(inner.calls).toEqual(['TSLA', 'AAPL']);
  });

  it('shares one inner request between concurrent requests for the same symbol', async () => {
    // Three users ask for TSLA at the same time. Yahoo must get one request, not three.
    const inner = new ControlledService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    const requests = [
      cache.getDailySummaries('TSLA'),
      cache.getDailySummaries('TSLA'),
      cache.getDailySummaries('tsla'),
    ];
    inner.resolveNext(summariesWithVolume(7));
    const results = await Promise.all(requests);

    expect(inner.calls).toEqual(['TSLA']);
    for (const result of results) {
      expect(result[0]?.volume).toBe(7);
    }
  });

  it('does not keep an error, so the next request tries again', async () => {
    // If the cache kept the error, a short Yahoo failure would block the symbol for the full TTL.
    const inner = new ControlledService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    const failed = cache.getDailySummaries('TSLA');
    inner.rejectNext(new MarketDataUnavailableError('upstream-error', 'Yahoo failed.'));
    await expect(failed).rejects.toBeInstanceOf(MarketDataUnavailableError);

    const retried = cache.getDailySummaries('TSLA');
    inner.resolveNext(summariesWithVolume(1));

    await expect(retried).resolves.toEqual(summariesWithVolume(1));
    expect(inner.calls).toEqual(['TSLA', 'TSLA']);
  });

  it('gives the same error to all concurrent requests when the shared request fails', async () => {
    const inner = new ControlledService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));
    const error = new MarketDataUnavailableError('timeout', 'Yahoo did not reply in time.');

    const requests = [cache.getDailySummaries('TSLA'), cache.getDailySummaries('TSLA')];
    inner.rejectNext(error);

    for (const request of requests) {
      await expect(request).rejects.toBe(error);
    }
  });

  it('stops the wait of a cancelled request, but completes the shared request for the others', async () => {
    // User A cancels (for example, closes the browser). User B waits for the same symbol.
    // User B must still get the result, and the cache must keep it.
    const inner = new ControlledService();
    const clock = new FakeClock(new Date('2026-10-16T22:00:00Z'));
    const cache = cacheFor(inner, clock);
    const controller = new AbortController();

    const requestA = cache.getDailySummaries('TSLA', controller.signal);
    const requestB = cache.getDailySummaries('TSLA');
    controller.abort();
    inner.resolveNext(summariesWithVolume(3));

    await expect(requestA).rejects.toMatchObject({ name: 'AbortError' });
    await expect(requestB).resolves.toEqual(summariesWithVolume(3));
    // The result is in the cache, so a third request does not go to the inner service.
    await cache.getDailySummaries('TSLA');
    expect(inner.calls).toEqual(['TSLA']);
  });

  it('does nothing for a request that is already cancelled', async () => {
    const inner = new CountingService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    await expect(cache.getDailySummaries('TSLA', AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(inner.calls).toEqual([]);
  });

  it('removes the least recently used symbol when the cache is full', async () => {
    // The cache has space for 2 symbols. TSLA is the oldest when AAPL and MSFT come, so TSLA goes.
    const inner = new CountingService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')), 2);

    await cache.getDailySummaries('TSLA');
    await cache.getDailySummaries('AAPL');
    await cache.getDailySummaries('MSFT');
    await cache.getDailySummaries('TSLA');

    expect(inner.calls).toEqual(['TSLA', 'AAPL', 'MSFT', 'TSLA']);
  });

  it('throws InvalidSymbolError for a bad symbol, without an inner request', async () => {
    const inner = new CountingService();
    const cache = cacheFor(inner, new FakeClock(new Date('2026-10-16T22:00:00Z')));

    await expect(cache.getDailySummaries('TSLA!!')).rejects.toBeInstanceOf(InvalidSymbolError);
    expect(inner.calls).toEqual([]);
  });
});
