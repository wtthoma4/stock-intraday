// Changes an error from the data layer into a message for the user.
// Each type of failure needs a different message, because the user must do a different thing:
// correct the symbol, wait, or try again.

import { ApiError, NetworkError } from '../api/apiErrors.ts';
import { SYMBOL_RULE } from '../domain/symbol.ts';

export interface ErrorMessage {
  readonly title: string;
  readonly detail: string;
  /** `true` if a new attempt can succeed. The page then shows a "Try again" button. */
  readonly canRetry: boolean;
  /** The ID of the request in the server log, if the API sent one. Support can use it to find the request. */
  readonly traceId: string | null;
}

export function describeError(error: Error, symbol: string): ErrorMessage {
  if (error instanceof ApiError) {
    const traceId = error.problem?.traceId ?? null;
    // `switch` selects the `case` that has the same value as `error.status`. `default` is for all other statuses.
    // Each `case` gives back a value with `return`, so the code never continues into the next `case`.
    switch (error.status) {
      case 404:
        return {
          title: 'Symbol not found',
          detail: `No market data was found for "${symbol}". Make sure that the symbol is correct.`,
          canRetry: false,
          traceId,
        };
      case 400:
        return { title: 'Invalid symbol', detail: SYMBOL_RULE, canRetry: false, traceId };
      case 429:
        return {
          title: 'Too many requests',
          detail: 'You sent too many requests in a short time. Wait one minute, then try again.',
          canRetry: true,
          traceId,
        };
      default:
        return {
          title: 'Could not get the data',
          detail: 'The server or the data provider has a problem. Try again.',
          canRetry: true,
          traceId,
        };
    }
  }
  if (error instanceof NetworkError) {
    return {
      title: 'Could not connect to the server',
      detail: 'Make sure that you are online and that the API is running. Then try again.',
      canRetry: true,
      traceId: null,
    };
  }
  // `InvalidResponseError` and all unexpected errors.
  return {
    title: 'Could not get the data',
    detail: 'The server sent data that the page cannot read. Try again.',
    canRetry: true,
    traceId: null,
  };
}
