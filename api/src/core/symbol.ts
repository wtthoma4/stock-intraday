import { InvalidSymbolError } from './errors.js';

/**
 * The format of a valid symbol, after the change to upper case: 1 to 15 characters.
 * Permitted characters are letters, digits and `.`, `-`, `^` and `=`.
 * Examples: `TSLA`, `BRK-B` (share class), `7203.T` (Tokyo), `^GSPC` (index), `EURUSD=X` (currency).
 * The HTTP layer uses the same pattern, so the two checks always agree.
 */
export const SYMBOL_PATTERN = /^[A-Z0-9.\-^=]{1,15}$/;

/**
 * Removes the spaces at the two ends and changes the symbol to upper case.
 * Yahoo accepts `tsla` and `TSLA`. One form for each symbol gives one cache entry for each symbol.
 * Throws `InvalidSymbolError` if the result does not agree with `SYMBOL_PATTERN`.
 */
export function normalizeSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new InvalidSymbolError(raw);
  }
  return symbol;
}
