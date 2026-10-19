// The errors of the core layer. The HTTP layer (`http/errorHandler.ts`) changes each of these errors
// into an HTTP status code. The core layer itself does not know HTTP.

/**
 * The base class for errors that the HTTP layer changes into a status code.
 * Other errors are programming errors and become HTTP 500.
 *
 * `abstract` means that the code cannot make a `DomainError` directly, only one of its subclasses.
 * Because of this, the error handler can use `instanceof DomainError` to find all expected errors.
 */
export abstract class DomainError extends Error {
  // `ErrorOptions` is the standard second parameter of `Error`. Its `cause` property keeps the original error,
  // so the log shows the error that started the problem (for example, the network error under a timeout).
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // `new.target` is the class that the code made with `new`, for example `SymbolNotFoundError`.
    // Without this line, the name of each error is "Error", and the log does not show the real class.
    this.name = new.target.name;
  }
}

/**
 * The symbol does not have a valid format. The application finds this error before it sends a request,
 * so the market data provider does not get bad input.
 */
export class InvalidSymbolError extends DomainError {
  // `readonly symbol` in the parameter list is TypeScript shorthand: it makes a public, read-only property
  // `symbol` and sets it from the parameter. The error handler reads it to make the message for the user.
  constructor(readonly symbol: string) {
    super(`"${symbol}" is not a valid symbol.`);
  }
}

/** The market data provider does not know the symbol. */
export class SymbolNotFoundError extends DomainError {
  constructor(readonly symbol: string) {
    super(`The symbol "${symbol}" was not found.`);
  }
}

/**
 * Why the market data provider did not give data.
 * - `rate-limited`: the provider refused more requests for a time.
 * - `upstream-error`: the provider failed, or the network failed.
 * - `timeout`: the provider did not reply in time.
 * - `circuit-open`: too many requests failed, so the client stopped requests for a time.
 * - `invalid-response`: the reply did not have the expected shape.
 *
 * This type is a union of text values. The compiler accepts only these five values,
 * so a wrong reason text is a compile error, not a bug at runtime.
 */
export type MarketDataUnavailableReason =
  'rate-limited' | 'upstream-error' | 'timeout' | 'circuit-open' | 'invalid-response';

/** The market data provider did not give usable data. A new request can succeed later. */
export class MarketDataUnavailableError extends DomainError {
  constructor(
    readonly reason: MarketDataUnavailableReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
