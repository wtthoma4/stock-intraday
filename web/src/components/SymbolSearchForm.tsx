// The form where the user types a stock symbol.

import { useId, useState, type SubmitEvent } from 'react';

import { normalizeSymbol, SYMBOL_RULE } from '../domain/symbol.ts';

interface SymbolSearchFormProps {
  /** The symbol in the field when the form opens, for example from the URL. */
  readonly initialValue: string;
  /** `true` while a request is in progress. The button is then disabled. */
  readonly isLoading: boolean;
  /** Receives a valid symbol in upper case. The form does not call it for a bad symbol. */
  readonly onSubmit: (symbol: string) => void;
}

/**
 * A search form with one labelled field.
 * The form checks the symbol with the same rule as the API. A bad symbol shows a message
 * under the field, and no request goes to the API.
 */
export function SymbolSearchForm({ initialValue, isLoading, onSubmit }: SymbolSearchFormProps) {
  // The text in the field and the error message are React state. When the code calls `setValue` or `setError`,
  // React calls this component again and shows the new value.
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  // Unique IDs connect the label, the hint and the error message to the field for screen readers.
  // `useId` gives an ID that is unique on the page and stays the same at each call of the component.
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    // By default, a browser sends a form to the server and loads a new page. `preventDefault` stops this,
    // so React controls the submit and the page stays.
    event.preventDefault();
    const symbol = normalizeSymbol(value);
    if (symbol === null) {
      setError(SYMBOL_RULE);
      return;
    }
    setError(null);
    setValue(symbol);
    onSubmit(symbol);
  };

  return (
    // `role="search"` tells assistive technology that this form starts a search.
    // `noValidate` stops the messages of the browser, so the form shows its own message.
    <form className="search-form" role="search" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId}>Stock symbol</label>
      <div className="search-row">
        <input
          id={inputId}
          name="symbol"
          type="text"
          // A controlled input: React sets the text of the field from `value`, and `onChange` changes `value`.
          // The state is the only source of the text, so the code can change it (here, to upper case).
          value={value}
          // Show the symbol in upper case while the user types. The API uses upper case.
          onChange={(event) => {
            setValue(event.target.value.toUpperCase());
            // Remove an old error message when the user starts to correct the symbol.
            if (error !== null) {
              setError(null);
            }
          }}
          placeholder="TSLA"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Show'}
        </button>
      </div>
      <p id={hintId} className="hint">
        For example TSLA, BRK-B, 7203.T or ^GSPC.
      </p>
      {error !== null && (
        // `role="alert"` makes a screen reader read the message immediately.
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
