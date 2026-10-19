// The main page: a search form, then the result for the symbol in the URL.
//
// The result area has one state at a time:
//   - idle:    no symbol yet. The page tells the user what to do.
//   - invalid: the symbol in the URL is not valid. No request goes to the API.
//   - loading: the request is in progress.
//   - error:   the request failed. The message depends on the type of failure.
//   - empty:   the API has no complete days for the symbol.
//   - success: the charts and the table.
//
// React in short: a component is a function that gives the HTML (as JSX) for its state. React calls the
// function again when the state changes, and it updates only the parts of the page that changed.
// A function that starts with `use` is a hook: it keeps state between the calls of the component.

import { DailySummaryCharts } from './components/DailySummaryCharts.tsx';
import { DailySummaryTable } from './components/DailySummaryTable.tsx';
import { describeError, type ErrorMessage } from './components/errorMessages.ts';
import { SymbolSearchForm } from './components/SymbolSearchForm.tsx';
import { normalizeSymbol, SYMBOL_RULE } from './domain/symbol.ts';
import { useDailySummaries } from './hooks/useDailySummaries.ts';
import { useSymbolParam } from './hooks/useSymbolParam.ts';
import type { DailySummary } from './types/dailySummary.ts';

function App() {
  // The hook gives two items in an array. `[a, b]` takes them into two constants (destructuring).
  const [urlSymbol, setUrlSymbol] = useSymbolParam();
  // A symbol from the URL can be anything that a user typed into the address bar. Check it.
  const symbol = urlSymbol === null ? null : normalizeSymbol(urlSymbol);
  // `query` has the state of the request: `isPending`, `isError`, `isFetching`, `data` and `error`.
  const query = useDailySummaries(symbol);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Stock Intraday Summary</h1>
        <p className="intro">
          Daily averages of the 15-minute lows and highs, and the daily volume, for each complete
          trading day of the last month.
        </p>
      </header>

      <SymbolSearchForm
        // A new key makes a new form when the URL changes (for example, with the back button),
        // so the field shows the symbol of the URL.
        key={urlSymbol ?? ''}
        initialValue={urlSymbol ?? ''}
        isLoading={query.isFetching}
        onSubmit={setUrlSymbol}
      />

      {/* `aria-busy` tells a screen reader that the content of this area changes now. */}
      <section className="results" aria-busy={query.isFetching}>
        {/*
          A chain of conditions selects one state: `a ? <X /> : b ? <Y /> : <Z />`.
          React shows the first branch whose condition is true, from the top down.
        */}
        {urlSymbol === null ? (
          <p className="notice">Type a stock symbol, then select Show.</p>
        ) : symbol === null ? (
          <ErrorAlert
            message={{
              title: 'Invalid symbol',
              detail: SYMBOL_RULE,
              canRetry: false,
              traceId: null,
            }}
          />
        ) : query.isPending ? (
          <LoadingState symbol={symbol} />
        ) : query.isError ? (
          <ErrorAlert
            message={describeError(query.error, symbol)}
            onRetry={() => {
              // `refetch` gives a promise. The page does not wait for it, because the query state shows the result.
              // `void` tells ESLint that the code ignores the promise on purpose.
              void query.refetch();
            }}
          />
        ) : query.data.length === 0 ? (
          <p className="notice" role="status">
            The data provider has no complete trading days for {symbol} in the last month.
          </p>
        ) : (
          <Results symbol={symbol} summaries={query.data} />
        )}
      </section>
    </main>
  );
}

/** The charts and the table, with a short line about the period. */
function Results({ symbol, summaries }: { symbol: string; summaries: readonly DailySummary[] }) {
  const first = summaries[0];
  const last = summaries.at(-1);
  return (
    <>
      <h2 className="results-title">
        {symbol}
        {first !== undefined && last !== undefined && (
          <span className="results-period">
            {summaries.length} complete trading {summaries.length === 1 ? 'day' : 'days'},{' '}
            <span className="nowrap">{first.day}</span> to{' '}
            <span className="nowrap">{last.day}</span>
          </span>
        )}
      </h2>
      <DailySummaryCharts summaries={summaries} />
      <DailySummaryTable symbol={symbol} summaries={summaries} />
    </>
  );
}

/** Grey blocks in the shape of the result, and a text for screen readers. */
function LoadingState({ symbol }: { symbol: string }) {
  return (
    <div className="loading" role="status">
      <span className="visually-hidden">Getting the data for {symbol}.</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-chart" aria-hidden="true" />
      <div className="skeleton skeleton-table" aria-hidden="true" />
    </div>
  );
}

/**
 * An error message. `role="alert"` makes a screen reader read it immediately.
 * The button shows only when a new attempt can succeed.
 */
function ErrorAlert({ message, onRetry }: { message: ErrorMessage; onRetry?: () => void }) {
  return (
    <div className="error-alert" role="alert">
      <p className="error-title">{message.title}</p>
      <p>{message.detail}</p>
      {message.traceId !== null && <p className="trace-id">Reference: {message.traceId}</p>}
      {message.canRetry && onRetry !== undefined && (
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export default App;
