# Stock Intraday Summary

This application shows daily summaries of intraday stock data for the last month. You type a stock symbol. The page then shows the mean of the 15-minute lows, the mean of the 15-minute highs, and the volume for each complete trading day.

The repository has two parts in one npm workspace:

- `api/`: a Node.js and TypeScript API (Fastify). It gets 15-minute bars from Yahoo Finance and calculates one summary for each day.
- `web/`: a React and TypeScript web application (Vite). It shows the summaries as two charts and a table.

## Run the application

You need Docker (Docker Desktop, or Docker Engine with Compose v2) and an internet connection, because the data comes from Yahoo Finance. Start Docker before step 2.

1. Unzip the archive
2. In the project root, run this command:

   ```
   docker compose up --build
   ```

3. Open http://localhost:8080 in a browser.

Type a symbol, for example `TSLA`, and select **Show**. The first build takes some minutes. To stop the application, type `Ctrl+C` in the terminal.

## Contents

- [Run the application](#run-the-application)
- [Development without Docker](#development-without-docker)
- [Run the checks](#run-the-checks)
- [API](#api)
- [Configuration](#configuration)
- [Assumptions](#assumptions)
- [Architecture](#architecture)
- [Known limitations](#known-limitations)
- [Next steps](#next-steps)

## Run the checks

One command does all checks for the two parts:

```bash
npm run verify
```

The command does these steps in this order, and it stops at the first failure:

1. `typecheck`: the TypeScript compiler checks the types of all files.
2. `lint`: ESLint checks the code.
3. `format:check`: Prettier checks the format of the files.
4. `test`: Vitest runs the tests of the API and of the web application.
5. `build`: the compiler builds the API, and Vite builds the web application.

The tests do not use the network. They use saved Yahoo replies (in `api/test/infrastructure/fixtures/`) and a mock server (MSW).

You can also run each step alone, for example `npm test` or `npm run lint`. To format all files, run `npm run format`.

## API

### `GET /api/v1/stocks/{symbol}/daily-summaries`

The reply is a JSON array with one item for each complete trading day of the last month. The oldest day is first.

```bash
curl http://localhost:8080/api/v1/stocks/TSLA/daily-summaries
```

```json
[
  {
    "day": "2026-09-16",
    "lowAverage": 359.7875,
    "highAverage": 361.7945,
    "volume": 29872465
  }
]
```

| Field         | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `day`         | The date on the exchange, in the format `yyyy-MM-dd`.              |
| `lowAverage`  | The mean of the 15-minute lows of the day, with 4 decimal places.  |
| `highAverage` | The mean of the 15-minute highs of the day, with 4 decimal places. |
| `volume`      | The sum of the 15-minute volumes of the day.                       |

A valid symbol has 1 to 15 characters: letters, digits, `.`, `-`, `^` or `=`. Examples are `TSLA`, `BRK-B`, `7203.T`, `^GSPC` and `EURUSD=X`. Encode the special characters in the URL, for example `%5EGSPC` for `^GSPC`.

### Errors

Each error has the media type `application/problem+json` (RFC 9457). The body has a `traceId`. The same ID is in the `X-Request-Id` header and in the log of the API.

| Status | Description                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | The symbol is not valid.                                                                                                                            |
| 404    | Yahoo does not know the symbol.                                                                                                                     |
| 429    | The client sent too many requests. The limit is for each IP address.                                                                                |
| 502    | Yahoo failed or sent data that the API cannot read.                                                                                                 |
| 503    | Yahoo limits the requests, or the API stopped requests to Yahoo for a time after many failures. The `Retry-After` header gives the seconds to wait. |
| 504    | Yahoo did not reply in time.                                                                                                                        |
| 500    | An unexpected error. The body does not show internal details.                                                                                       |

`GET /health` gives `{"status":"ok"}`. It does not call Yahoo, and the rate limit does not apply to it.

## Configuration

The API reads its configuration from environment variables. `api/.env.example` shows each variable with a comment. When the API starts, it checks all values. If a value is not valid, the API stops and shows all problems.

| Variable                                   | Default                            | Description                                                                   |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| `YAHOO_USER_AGENT`                         | (none)                             | Required. Yahoo refuses requests without the User-Agent of a browser.         |
| `NODE_ENV`                                 | `production`                       | `development` shows the documentation at `/docs`.                             |
| `HOST`                                     | `127.0.0.1`                        | The address that the API listens on. A container must use `0.0.0.0`.          |
| `PORT`                                     | `8080`                             | The port of the API.                                                          |
| `LOG_LEVEL`                                | `info`                             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.               |
| `TRUST_PROXY`                              | `0`                                | The number of reverse proxies in front of the API. Use `1` behind Nginx.      |
| `CORS_ALLOWED_ORIGINS`                     | (empty)                            | The browser origins that can call the API, separated by commas.               |
| `RATE_LIMIT_PER_MINUTE`                    | `60`                               | The maximum number of requests for each IP address in one minute.             |
| `CACHE_TTL_SECONDS`                        | `300`                              | The time that the API keeps a result.                                         |
| `CACHE_MAX_ENTRIES`                        | `1000`                             | The maximum number of symbols in the cache.                                   |
| `YAHOO_BASE_URL`                           | `https://query1.finance.yahoo.com` | The address of the Yahoo chart API.                                           |
| `YAHOO_INTERVAL`                           | `15m`                              | The length of one bar.                                                        |
| `YAHOO_TIMEOUT_MS`                         | `10000`                            | The time limit for one request to Yahoo.                                      |
| `YAHOO_RETRY_ATTEMPTS`                     | `2`                                | The number of new attempts after a temporary failure.                         |
| `YAHOO_RETRY_BASE_DELAY_MS`                | `250`                              | The delay before the first new attempt.                                       |
| `YAHOO_CIRCUIT_BREAKER_THRESHOLD`          | `5`                                | The number of failures in a sequence that stops requests to Yahoo for a time. |
| `YAHOO_CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS` | `30000`                            | The time after which the API tries Yahoo again.                               |

The web application has one variable, `VITE_API_BASE_URL` (refer to `web/.env.example`). Leave it empty if the page and the API have the same origin. This is true for the Vite proxy and for Docker.

## Assumptions

The brief does not define all rules. I used these rules:

1. **The last month.** The data is from the same date one calendar month ago, on the exchange, up to today. For example, on 16 October the first day is 16 September. On 31 March, the first day is 28 February (or 29 February in a leap year).
2. **Only complete days.** The API shows a day only if all its bars are in the data:
   - The API requests 33 days of data (31 days and 2 more days), and removes the days before the first day. As a result, the first day has all its bars in each time zone.
   - The API shows today only after the regular session of today closes.
3. **The day of a bar.** A bar belongs to its date in the time zone of the exchange, not UTC. For example, a session in Sydney starts at 23:00 UTC on the day before.
4. **The fields.** `lowAverage` is the mean of the bar lows, and `highAverage` is the mean of the bar highs. `volume` is the sum of the bar volumes.
5. **Bars without values.** Yahoo sends `null` for a bar without trades (for example, the lunch break in Tokyo). These bars do not go into the means. A `null` volume adds 0. A day without prices is not in the result.
6. **Precision.** The API calculates with exact decimal numbers. It rounds each mean to 4 decimal places, with a half value away from zero.
7. **Regular hours only.** The data does not contain pre-market and after-hours trades.
8. **All exchanges.** The API accepts each symbol that Yahoo knows, not only symbols from US exchanges.

## Architecture

The API has three layers. Each layer imports only from the layers below it, and an ESLint rule stops imports in the wrong direction.

```text
Browser ──► web (Vite or Nginx)
              │  GET /api/v1/stocks/{symbol}/daily-summaries
              ▼
          http             route, validation, errors as Problem Details, CORS, rate limit
              │
              ▼
          cache            CachedDailySummaryService (5 minutes for each symbol)
              │
              ▼
          core             StockSummaryService → aggregateDailySummaries()
              │            MarketDataProvider (an interface)
              ▼
          infrastructure   YahooFinanceClient (retry, circuit breaker, timeout)
              │
              ▼
          Yahoo Finance chart API
```

- **`core`** has the rules of the brief: the window of complete days, the exchange date of each bar, and the means. It does not know HTTP or Yahoo.
- **`infrastructure`** has the Yahoo client and the cache. Yahoo is unofficial and limits the request rate. Because of this, the client tries again after a temporary failure, stops requests for a time after many failures, and stops a slow request.
- **`http`** changes requests into calls to the service, and errors into HTTP status codes.
- **`server.ts`** makes the real objects and connects them. Tests give stub objects instead.

To use a different data vendor, add a class with `implements MarketDataProvider`, and change one line in `server.ts`. The rules and the routes do not change.

The cache keeps the calculated summaries, not the raw bars. Each result has the time of its request. Because of this, a result can be up to 5 minutes old, but it is never wrong for its time.

In Docker, Nginx serves the web application and sends `/api` to the API container. Only your computer can open port 8080.

The web application uses TanStack Query for the requests, and Recharts for the charts. The symbol is in the URL (`?symbol=TSLA`), so you can share a link to a result.

### Project structure

```text
api/
  src/core/            the rules and the types (no HTTP, no Yahoo)
  src/infrastructure/  the Yahoo client and the cache
  src/http/            the Fastify application, the routes and the error handler
  src/config.ts        the configuration from environment variables
  src/server.ts        the start of the API
  test/                the tests and the saved Yahoo replies
web/
  src/api/             the client for the API
  src/hooks/           the data hook and the URL hook
  src/components/      the form, the charts, the table and the error messages
  src/App.tsx          the page and its states
docker-compose.yml     the API and Nginx containers
```