// The rule for a valid symbol. It is a copy of the rule in the API (`api/src/core/symbol.ts`).
// The two packages do not share code, so the two copies must stay the same. If the API rule changes, change this file also.
// The form checks the symbol before the request, so the user sees the problem immediately.
// The API checks it again, because a client can send any request.

/** 1 to 15 characters: letters, digits and `.`, `-`, `^` and `=`. For example TSLA, BRK-B, 7203.T, ^GSPC, EURUSD=X. */
export const SYMBOL_PATTERN = /^[A-Z0-9.\-^=]{1,15}$/;

/** The rule as a sentence for the user. */
export const SYMBOL_RULE =
  'A symbol has 1 to 15 characters: letters, digits, ".", "-", "^" or "=".';

/**
 * Removes the spaces at the two ends and changes the symbol to upper case.
 * Gives `null` if the result is not a valid symbol.
 */
export function normalizeSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}
