// These tests use the complete page as a user does: type a symbol, select Show, and read the result.
//
// - React Testing Library finds elements by their role and text, as a screen reader does.
//   As a result, the tests also make sure that the page is accessible.
//   It has three types of query: `getBy...` throws if the element is absent, `queryBy...` gives `null`,
//   and `findBy...` waits until the element appears (for a result that comes after a request).
// - user-event types and clicks like a real user (key by key, with focus and submit events).
//   `fireEvent` sends only one event, so a test with it can pass for a page that a real user cannot use.
// - MSW gives the API replies and counts the requests. A request without a handler fails the test.
// - Each test starts at a new URL and with a new query client, so no result stays from another test.
//   The query client has `retryDelay: 0`, so the retries of the hook do not slow the tests.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import App from './App.tsx';
import { server, SUMMARIES_URL } from './test/server.ts';
import type { DailySummary, ProblemDetails } from './types/dailySummary.ts';

/** Two days, in ascending order, as the API sends them. */
const SUMMARIES: DailySummary[] = [
  { day: '2026-10-14', lowAverage: 40.2958, highAverage: 49.7534, volume: 49_073_348 },
  { day: '2026-10-15', lowAverage: 41.1, highAverage: 50, volume: 1_250 },
];

function problem(status: number, title: string, detail: string): ProblemDetails {
  return {
    type: 'about:blank',
    title,
    status,
    detail,
    instance: '/api/v1/stocks/X/daily-summaries',
    traceId: 'trace-123',
  };
}

/**
 * Opens the page at `path` and gives a user-event instance.
 * The URL of jsdom stays between tests, so each test sets it first.
 */
function renderPage(path = '/') {
  window.history.replaceState(null, '', path);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { user };
}

/** Makes MSW give the same reply to each request, and keeps the requested symbols. */
function replyAlways(reply: () => Response | Promise<Response>): { symbols: string[] } {
  const symbols: string[] = [];
  server.use(
    http.get(SUMMARIES_URL, ({ params }) => {
      symbols.push(String(params.symbol));
      return reply();
    }),
  );
  return { symbols };
}

/** Types a symbol into the field and submits the form, as a user does. */
// `ReturnType<typeof userEvent.setup>` is the type of the value that `userEvent.setup()` gives.
async function search(user: ReturnType<typeof userEvent.setup>, symbol: string) {
  const field = screen.getByLabelText('Stock symbol');
  await user.clear(field);
  await user.type(field, symbol);
  await user.click(screen.getByRole('button', { name: 'Show' }));
}

describe('App', () => {
  it('asks for a symbol and sends no request when the URL has no symbol', () => {
    const requests = replyAlways(() => HttpResponse.json(SUMMARIES));

    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Stock Intraday Summary' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Type a stock symbol, then select Show.')).toBeInTheDocument();
    expect(requests.symbols).toEqual([]);
  });

  describe('success', () => {
    it('shows the charts and the table for the symbol, and puts the symbol in the URL', async () => {
      const requests = replyAlways(() => HttpResponse.json(SUMMARIES));
      const { user } = renderPage();

      // The user types in lower case. The page sends upper case.
      await search(user, 'tsla');

      expect(await screen.findByRole('heading', { level: 2, name: /TSLA/ })).toHaveTextContent(
        '2 complete trading days, 2026-10-14 to 2026-10-15',
      );
      expect(requests.symbols).toEqual(['TSLA']);
      // The URL keeps the symbol, so the user can share the result.
      expect(window.location.search).toBe('?symbol=TSLA');
      // The two charts have titles. jsdom cannot draw the plot, so the table carries the values.
      expect(screen.getByText('Daily price averages')).toBeInTheDocument();
      expect(screen.getByText('Daily volume')).toBeInTheDocument();
    });

    it('shows the newest day first, with 4 decimal places and thousands separators', async () => {
      replyAlways(() => HttpResponse.json(SUMMARIES));
      const { user } = renderPage();

      await search(user, 'TSLA');

      const table = await screen.findByRole('table', { name: /Daily summaries for TSLA/ });
      const rows = within(table).getAllByRole('row');
      // Row 0 is the header. The API sends 14 October first, but the table shows 15 October first.
      expect(rows[1]).toHaveTextContent('2026-10-15');
      expect(rows[1]).toHaveTextContent('41.1000');
      expect(rows[1]).toHaveTextContent('50.0000');
      expect(rows[1]).toHaveTextContent('1,250');
      expect(rows[2]).toHaveTextContent('2026-10-14');
      expect(rows[2]).toHaveTextContent('40.2958');
      expect(rows[2]).toHaveTextContent('49,073,348');
    });

    it('loads the symbol from the URL when the page opens', async () => {
      // A shared link opens the result immediately, without a submit.
      const requests = replyAlways(() => HttpResponse.json(SUMMARIES));

      renderPage('/?symbol=BHP.AX');

      expect(await screen.findByRole('heading', { level: 2, name: /BHP\.AX/ })).toBeInTheDocument();
      expect(screen.getByLabelText('Stock symbol')).toHaveValue('BHP.AX');
      expect(requests.symbols).toEqual(['BHP.AX']);
    });

    it('shows the previous symbol again after the back button', async () => {
      replyAlways(() => HttpResponse.json(SUMMARIES));
      const { user } = renderPage();
      await search(user, 'TSLA');
      await screen.findByRole('heading', { level: 2, name: /TSLA/ });
      await search(user, 'AAPL');
      await screen.findByRole('heading', { level: 2, name: /AAPL/ });

      window.history.back();

      expect(await screen.findByRole('heading', { level: 2, name: /TSLA/ })).toBeInTheDocument();
      expect(screen.getByLabelText('Stock symbol')).toHaveValue('TSLA');
    });

    it('tells the user when the symbol has no complete days', async () => {
      replyAlways(() => HttpResponse.json([]));
      const { user } = renderPage();

      await search(user, 'TSLA');

      expect(
        await screen.findByText(
          'The data provider has no complete trading days for TSLA in the last month.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('loading', () => {
    it('shows a loading state and disables the button while the request is in progress', async () => {
      // The reply waits until the test has examined the loading state.
      let release = (): void => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      replyAlways(async () => {
        await released;
        return HttpResponse.json(SUMMARIES);
      });
      const { user } = renderPage();

      await search(user, 'TSLA');

      // `role="status"` makes a screen reader read the loading text.
      expect(await screen.findByRole('status')).toHaveTextContent('Getting the data for TSLA.');
      expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();

      release();

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    });
  });

  describe('client validation', () => {
    it('shows the symbol rule and sends no request for a bad symbol', async () => {
      const requests = replyAlways(() => HttpResponse.json(SUMMARIES));
      const { user } = renderPage();

      await search(user, 'TSLA!!');

      // The message is an alert, and the form marks the field as invalid for assistive technology.
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A symbol has 1 to 15 characters: letters, digits, ".", "-", "^" or "=".',
      );
      expect(screen.getByLabelText('Stock symbol')).toHaveAttribute('aria-invalid', 'true');
      expect(requests.symbols).toEqual([]);
      expect(window.location.search).toBe('');
    });

    it('removes the message when the user starts to correct the symbol', async () => {
      replyAlways(() => HttpResponse.json(SUMMARIES));
      const { user } = renderPage();
      await search(user, 'TSLA!!');

      await user.type(screen.getByLabelText('Stock symbol'), '{Backspace}');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Stock symbol')).toHaveAttribute('aria-invalid', 'false');
    });

    it('shows "Invalid symbol" and sends no request for a bad symbol in the URL', async () => {
      // A user can type anything into the address bar. The page must check it, as the form does.
      const requests = replyAlways(() => HttpResponse.json(SUMMARIES));

      renderPage('/?symbol=bad%20symbol!');

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid symbol');
      expect(requests.symbols).toEqual([]);
    });
  });

  describe('errors from the API', () => {
    it('shows "Symbol not found" for 404, with the reference and without a retry button', async () => {
      // A new attempt cannot find a symbol that does not exist, so the page does not offer one.
      replyAlways(() =>
        HttpResponse.json(problem(404, 'Not Found', 'No market data.'), { status: 404 }),
      );
      const { user } = renderPage();

      await search(user, 'ZZZZZZ1');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Symbol not found');
      expect(alert).toHaveTextContent('No market data was found for "ZZZZZZ1".');
      // Support can find the request in the server log with this reference.
      expect(alert).toHaveTextContent('Reference: trace-123');
      expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('tells the user to wait after 429', async () => {
      replyAlways(() =>
        HttpResponse.json(problem(429, 'Too Many Requests', 'Rate limit exceeded.'), {
          status: 429,
        }),
      );
      const { user } = renderPage();

      await search(user, 'TSLA');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Wait one minute, then try again.',
      );
    });

    it('shows a retry button after a server error, and the retry can succeed', async () => {
      // The first three requests fail (the first attempt and two automatic retries). The next one succeeds.
      let count = 0;
      server.use(
        http.get(SUMMARIES_URL, () => {
          count += 1;
          return count <= 3
            ? HttpResponse.json(problem(502, 'Bad Gateway', 'Provider failed.'), { status: 502 })
            : HttpResponse.json(SUMMARIES);
        }),
      );
      const { user } = renderPage();
      await search(user, 'TSLA');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Could not get the data');
      expect(count).toBe(3);

      await user.click(within(alert).getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('tells the user that the server cannot be reached after a network failure', async () => {
      replyAlways(() => HttpResponse.error());
      const { user } = renderPage();

      await search(user, 'TSLA');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Could not connect to the server');
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('does not show old data with the error of a new symbol', async () => {
      // The result of TSLA must not stay on the page when the request for the next symbol fails.
      let fail = false;
      server.use(
        http.get(SUMMARIES_URL, async () => {
          await delay(5);
          return fail
            ? HttpResponse.json(problem(404, 'Not Found', 'No market data.'), { status: 404 })
            : HttpResponse.json(SUMMARIES);
        }),
      );
      const { user } = renderPage();
      await search(user, 'TSLA');
      await screen.findByRole('table');

      fail = true;
      await search(user, 'ZZZZZZ1');

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Symbol not found');
      });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });
});
