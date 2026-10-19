// A React hook that gives the daily summaries for a symbol, with the state of the request (`isPending`, `error`, `data`).
// TanStack Query keeps the results, so a second request for the same symbol shows the data immediately.

import { skipToken, useQuery } from '@tanstack/react-query';

import { ApiError } from '../api/apiErrors.ts';
import { fetchDailySummaries } from '../api/stocksApi.ts';

/** The API keeps a result for 5 minutes. Before that time, a new request gives the same data. */
const STALE_TIME_MS = 5 * 60 * 1000;

/** The number of new attempts after the first one, for a failure that can stop. */
const MAX_RETRIES = 2;

/**
 * Decides if TanStack Query tries again after a failure.
 * A 4xx error (bad symbol, unknown symbol, rate limit) gives the same result again, so do not try again.
 * A 5xx error or a network error can stop, so try again up to `MAX_RETRIES` times.
 * TanStack Query calls this function after each failure, with the number of failures so far (from 0).
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.isClientError) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}

/**
 * Gives the daily summaries for `symbol`.
 * If `symbol` is `null` (the user did not submit a symbol yet), the hook sends no request.
 */
export function useDailySummaries(symbol: string | null) {
  return useQuery({
    // The query key names the data in the cache of TanStack Query. Each different key has its own entry.
    // When the symbol changes, the key changes, so TanStack Query starts a request for the new symbol,
    // and the result of each symbol stays separate.
    queryKey: ['daily-summaries', symbol],
    // `skipToken` stops the query in a type-safe way while there is no symbol.
    // TanStack Query gives a signal that aborts when the symbol changes or the component goes away.
    queryFn: symbol === null ? skipToken : ({ signal }) => fetchDailySummaries(symbol, signal),
    // For this time, TanStack Query uses the data in its cache and sends no new request.
    staleTime: STALE_TIME_MS,
    retry: shouldRetry,
  });
}
