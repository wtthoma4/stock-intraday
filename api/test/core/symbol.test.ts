// These tests examine `normalizeSymbol`, the single rule for a valid symbol.
// The service and the HTTP layer both use this rule, so a symbol cannot be valid in one place and invalid in another.

import { describe, expect, it } from 'vitest';

import { InvalidSymbolError } from '../../src/core/errors.js';
import { normalizeSymbol } from '../../src/core/symbol.js';

describe('normalizeSymbol', () => {
  it('changes the symbol to upper case and removes spaces at the two ends', () => {
    // Users type symbols in lower case and copy them with spaces. Yahoo needs one form.
    expect(normalizeSymbol('  tsla ')).toBe('TSLA');
  });

  // Each symbol is a real Yahoo symbol with a different special character.
  // `it.each` makes one test for each row. `%s` puts the values of the row into the name of the test.
  it.each([
    ['TSLA', 'a usual stock'],
    ['BRK-B', 'a share class with a hyphen'],
    ['7203.T', 'a Tokyo stock with digits and a suffix'],
    ['BHP.AX', 'a Sydney stock'],
    ['^GSPC', 'an index with a caret'],
    ['EURUSD=X', 'a currency pair with an equals sign'],
  ])('accepts %s (%s)', (symbol) => {
    expect(normalizeSymbol(symbol)).toBe(symbol);
  });

  // Each value breaks one part of the rule.
  it.each([
    ['', 'an empty value'],
    ['   ', 'only spaces'],
    ['TSLA!!', 'a character that is not permitted'],
    ['TS LA', 'a space in the symbol'],
    ['ABCDEFGHIJKLMNOP', '16 characters, 1 more than the limit'],
    ['../etc', 'a path, which must not go into the Yahoo URL'],
  ])('rejects %j (%s)', (symbol) => {
    expect(() => normalizeSymbol(symbol)).toThrow(InvalidSymbolError);
  });
});
