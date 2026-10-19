// The client for the stock API. It is the only file in the web application that knows the API URLs
// and the format of the replies. Each failure becomes one of the errors in `apiErrors.ts`.

import type { DailySummary, ProblemDetails } from '../types/dailySummary.ts';
import { ApiError, InvalidResponseError, NetworkError } from './apiErrors.ts';

/**
 * Gives the origin of the API. Vite reads `VITE_API_BASE_URL` at build time.
 * If it is empty, the API has the same origin as the page, so the base is the origin of the page.
 * The result is always an absolute URL, because `fetch` outside a browser (in tests) needs one.
 */
function apiBaseUrl(): string {
  // `import.meta.env` contains the `VITE_` variables. Vite writes their values into the code when it builds.
  // `?.trim()` calls `trim` only if the value exists, and `?? ''` gives an empty text if it does not.
  const configured = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
  return configured === '' ? window.location.origin : configured;
}

/**
 * Gets the daily summaries of the last month for a symbol.
 *
 * @param symbol A valid symbol in upper case. The form validates the symbol before the call.
 * @param signal Stops the request. TanStack Query aborts it when the user requests a different symbol.
 * @throws `ApiError`, `NetworkError` or `InvalidResponseError`. An abort gives the abort error with no change.
 */
export async function fetchDailySummaries(
  symbol: string,
  signal?: AbortSignal,
): Promise<readonly DailySummary[]> {
  // Symbols can contain `^` and `=` (for example `^GSPC`), so the code encodes the path segment.
  const url = new URL(`/api/v1/stocks/${encodeURIComponent(symbol)}/daily-summaries`, apiBaseUrl());

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: signal ?? null,
    });
  } catch (error) {
    // An abort is not a failure. The caller cancelled the request on purpose.
    if (signal?.aborted) {
      throw error;
    }
    // `fetch` throws only when there is no reply: the API is down, or the network failed.
    throw new NetworkError({ cause: error });
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readProblem(response));
  }

  // `unknown`: the body comes from outside, so the code must check its shape before it uses it.
  // `.catch(() => undefined)` changes a body that is not JSON into `undefined`, which the check below rejects.
  const body: unknown = await response.json().catch(() => undefined);
  if (!isDailySummaryArray(body)) {
    throw new InvalidResponseError();
  }
  return body;
}

/**
 * Reads the Problem Details body of an error reply. Gives `null` if the body is not Problem Details,
 * for example an HTML page from a proxy. The caller then uses only the status.
 */
async function readProblem(response: Response): Promise<ProblemDetails | null> {
  const body: unknown = await response.json().catch(() => null);
  return isProblemDetails(body) ? body : null;
}

/**
 * Makes sure that the body has the shape of the contract. The UI must not show wrong data.
 *
 * This is a type guard. The return type `value is DailySummary[]` tells the compiler: if the function gives
 * `true`, treat `value` as `DailySummary[]` after the call. Each `'day' in item` check makes sure that the
 * property exists, so the compiler then permits `item.day`.
 */
function isDailySummaryArray(value: unknown): value is DailySummary[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'day' in item &&
        typeof item.day === 'string' &&
        'lowAverage' in item &&
        typeof item.lowAverage === 'number' &&
        'highAverage' in item &&
        typeof item.highAverage === 'number' &&
        'volume' in item &&
        typeof item.volume === 'number',
    )
  );
}

/** A type guard for a Problem Details body. It checks only the fields that the UI reads. */
function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'detail' in value &&
    typeof value.detail === 'string'
  );
}
