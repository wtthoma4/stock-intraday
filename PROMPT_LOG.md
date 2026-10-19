# Prompt Log

This log shows how I used AI tools for this assessment. It shows the tools, my prompts, and the decisions that I made about the AI output.

I gave most instructions to an AI agent. The **Prompts** section shows the main instructions for each phase. The **Manual interventions** section shows the problems that I found in the AI output. 

## Summary

I used one AI agent for planning, coding, testing, the reviews and the drafts of this log. I changed its output when it went outside the task, did not follow the plan, or wrote code and comments that were difficult to read.

I kept my own notes about the coding session then fed them into an LLM for formatting into markdown. I edited the output and the final result is below.

## Tools

|  Tool  |  Model  |  Used for  |
| --- | --- | --- |
|  Claude Code (desktop app)  |  Claude Opus 5.5  |  Scaffold, code, tests, reviews, log drafts  |
|  Built-in browser of Claude Code  |  —  |  Manual checks of the page, against the real API and in Docker  |
| Docker Desktop | — | Build and run of the images |

## Prompts

### 00 · Ingest the requirements and make an implementation plan

**Prompt**

> I am going to give you a requirements document describing a development project. Produce a step-by-step implementation plan of what to build and when, and how to wire things together.

**Why I asked this**

Implementation plans give me the opportunity to evaluate how well the coding agent has comprehended the task, make decisions about how to design the overall system, and surface gaps in my own understanding before proceeding.

**What the AI produced**

- A markdown implementation plan with the following elements:
    - Scaffold
    - Yahoo API test
    - Trade data aggregation
    - Yahoo API implement
    - Application backend service and simple cache
    - Application API
    - Frontend scaffold
    - Frontend data structures
    - User interface and charts
    - Frontend testing
    - Cleanup
    - Document and package

### 01 · Make the npm workspace and the API toolchain

**Prompt**

> Review the instructions and implementation plan, begin the first step the system scaffold

**Why I asked this**

This directs the agent to work from the implementation plan rather than the project document.

**What the AI produced**

- An npm workspace with the `api` package, `tsconfig.base.json` with strict options, ESLint with `typescript-eslint` strict rules, and Prettier.
- An ESLint rule for the import direction. `core` cannot import `infrastructure` or `http` code, and `infrastructure` cannot import `http` code.
- A `verify` script that runs the type check, lint, format check, tests and build, and stops at the first failure.
- A `.prettierignore` file that excludes this log, so Prettier does not change the verbatim prompts.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed (AI self-corrected)  |  The agent pinned TypeScript to `~6.0.3`, not the latest 7.0.  |  `typescript-eslint` supports only TypeScript versions below 6.1.  |
|  Changed (AI self-corrected)  |  The agent set `engines` to Node `>=22.13`, not `>=22.12`.  |  ESLint 10 needs Node 22.13 or later.  |
|  Kept  |  The import rule for the layers  |  The agent added a test file in `core` with a wrong import. ESLint failed with the correct message. The agent then deleted the file.  |
|  Rejected  |  `.editorconfig`  |  Prettier already controls the format. Refer to I01.  |

**Follow-ups**

> Add comments to the tsconfig files explaining why you chose each of the settings

**Why I asked this**

I wanted to make sure that each setting has a reason, and that a reviewer can read the reason in the file. There were some settings that I was not familiar with and I wanted to review those decisions and their impact before approving them.

**What the AI produced**

- One comment for each setting in `tsconfig.base.json`, `api/tsconfig.json` and `api/tsconfig.build.json`.
- The comments connect the settings to the project. For example, `noUncheckedIndexedAccess` protects the parallel arrays from Yahoo.
- The agent realized that source maps were not properly used, and corrected the start script accordingly.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The comments  |  I read each comment. Prettier and `tsc` accept the comments in these files.  |
|  Changed (AI self-corrected)  |  The agent removed `forceConsistentCasingInFileNames`.  |  This setting is the default from TypeScript 5.0, so the agent could not give a reason for it. |
|  Changed  |  The `start` script now uses `--enable-source-maps`.  |  Without this flag, the `sourceMap` setting had no effect.  |

### 02 · Save Yahoo responses for testing

**Prompt**

> Execute the next step, the Yahoo API test. curl the Yahoo API and save the responses as test data. Make sure they don't get mangled by prettierignore

**Why I asked this**

I wanted real Yahoo responses before I wrote the aggregation code. I don't want the coding agent working from memory when writing API calls. 

**What the AI produced**

- Three raw responses with `interval=15m&range=1mo`: `tsla-15m-1mo.json` (HTTP 200), `invalid-symbol-404.json` (HTTP 404) and `7203-t-15m-1mo.json` (HTTP 200, Tokyo).
- A basic analysis of the shape of the Yahoo API responses
- A `.prettierignore` entry for the fixtures, so Prettier does not change the raw responses.

**Findings**

- The data is at `chart.result[0]`: `timestamp`, `meta.exchangeTimezoneName` and `indicators.quote[0]` with `low`, `high`, `open`, `close` and `volume`. All arrays have the same length.
- The 404 body is `{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}`.
- TSLA has no `null` values. Tokyo has 54 bars with `null` in all fields, from 11:45 to 12:15 JST.
- Some bars have `volume` 0. This value is correct data, not an absent value.
- `range=1mo` starts one month before the current time, not at the start of a day. The first TSLA day has 23 bars from 10:15, not 26 bars from 09:30.
- The current day is open. The last TSLA bar has the timestamp 14:20:04 UTC, not a 15-minute boundary. The averages of this day change until the market closes.
- Tokyo sessions are between 00:00 and 06:30 UTC. As a result, a UTC date and a Tokyo date are the same for each bar.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The raw responses, with no changes  |  Tests must use the data that Yahoo sends.  |
|  Kept  |  The `.prettierignore` entry for the fixtures  |  Without it, `npm run verify` fails on the minified JSON.  |

### 03 · Show only complete trading days

**Prompt**

> The system should only show complete days, so make sure the first day starts at the beginning of the trading day and exclude the current day unless trading has completed.

**Why I asked this**

The Yahoo API test showed two incomplete days: the first day started at 10:15, and the current day was still open. An average of part of a session is not comparable with an average of a full session. It's also a poor user experience if the data is shifting every time you refresh because the current day is not complete.

**What the AI produced**

- The client does not send `range=1mo`. It sends `period1` and `period2` from an injected clock. `period1` is one month and two days before the current time. The two extra days make sure that the first day in the window has all its bars, for all time zones.
- The core layer removes the days before the cutoff date. The cutoff date is the exchange date of today, minus one calendar month.
- The core layer removes today until the time in `meta.currentTradingPeriod.regular.end`.
- New test cases for the aggregator and the client. The configuration does not have `YAHOO_RANGE` now.
- After Phase 2, the agent got the TSLA and Tokyo fixtures again with `period1` and `period2`. The new files are `tsla-15m-period.json` and `7203-t-15m-period.json`. The agent deleted the two `range=1mo` files from entry 03.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The window rule and the extra two days  |  The client does not know the time zone of the exchange before the response. The request must start early enough for all time zones.  |
|  Kept  |  An open question about early-close days  |  The agent does not know if Yahoo gives an earlier `end` on these days. The next early-close day in the US is 27 November 2026, so I cannot get real data for this before I submit.  |
|  Changed  |  The TSLA and Tokyo fixtures  |  The `range=1mo` files started with an incomplete day. A test that sends a fixture through the aggregator would keep this day as the first day in the window. The new TSLA file has an incomplete first day (14 September) only in the two extra days. The aggregator removes this day, and the first day in the window (16 September) has all 26 bars.  |

**Follow-ups**

> Re-fetch the test data from the Yahoo API using the new spec

### 04 · Aggregate bars into complete days, test first

**Prompt**

> Proceed with the next step, complete the aggregation logic

**Why I asked this**

The aggregation contains most of the rules from the brief, so I wanted it first, with tests before other parts of the code.

**What the AI produced**

- `api/src/core/`: `IntradaySeries`, `DailySummary`, a `Clock` interface, and the pure function `aggregateDailySummaries(series, now)`.
- The function puts each bar on its exchange date with `Intl.DateTimeFormat`. It calculates the means with `big.js` and rounds half away from zero to 4 places. It keeps only complete days in the window.
- 16 tests in `api/test/core/aggregateDailySummaries.test.ts`. The tests failed before the code existed.
- The agent deleted the placeholder test from Phase 0.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The tests and the function  |  All 16 tests passed. The agent then changed the code three times on purpose, to make sure that the tests find errors. UTC dates broke 2 tests. A month calculation with JavaScript `Date` broke 1 test. Naive rounding broke 1 test.  |
|  Changed (AI self-corrected)  |  The first naive rounding change did not break a test.  |  That change used exact `big.js` sums and only rounded with `Math.round`. A fully naive version adds JavaScript numbers. That version and a `toFixed` version broke the rounding test.  |
|  Changed (AI self-corrected)  |  Prettier changed the format of the test file.  |  `npm run verify` failed on the format.  |

### 05 · Get Yahoo data via API programmatically

**Prompt**

> Proceed to step three, use the Yahoo API to fetch the data we need

**Why I asked this**

The aggregation was complete, so the next step in the plan was the data source.

**What the AI produced**

- `core`: the `MarketDataProvider` interface, `SymbolNotFoundError` and `MarketDataUnavailableError` (with a `reason`), and `dataRangeFor(now)`.
- `infrastructure/yahoo`: a Zod schema for the options, a Zod schema for the Yahoo reply, and `YahooFinanceClient`. The client uses `cockatiel` for retry, circuit breaker and timeout.
- 27 new tests: the client with MSW and the fixtures, the time range, and the real fixtures through the client and the aggregation.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed (AI self-corrected)  |  The agent did not follow the plan for the time range. In the plan, the client calculates `period1` from the clock. Now the core function `dataRangeFor(now)` gives the range, and the client only sends it.  |  The window rule is in the core layer, so the range must also be there. Also, JavaScript `Date` changes 31 March minus one month into 3 March. A fixed 33 days (31 + 2) does not have this problem.  |
|  Changed (AI self-corrected)  |  The agent read the type files of `cockatiel` 4 and MSW 3 before it used them.  |  Both versions are newer than the knowledge of the agent.  |
|  Changed (AI self-corrected)  |  The tests used `onUnhandledRequest`. MSW 3 renamed this option to `onUnhandledFrame`.  |  `tsc` found the error. At runtime, MSW ignored the old option, so a request without a handler did not fail the test.  |
|  Changed (AI self-corrected)  |  One test compared all fields of `currentTradingPeriod.regular`.  |  Yahoo also sends `timezone` and `gmtoffset`. The client keeps only `start` and `end`, so the test was wrong, not the client.  |
|  Kept  |  The tests  |  The agent changed the client three times on purpose. A retry for all errors broke 4 tests. No check for a cancelled request broke 1 test. `null` changed into 0 broke 1 test.  |
|  Kept  |  Real fixtures through the client and the aggregation  |  TSLA keeps 22 days without the open day. Tokyo keeps today, because its session closed. Sydney keeps 22 days, not the 26 UTC dates.  |
|  Open  |  Early-close days  |  This is still not tested with real data. |

### 06 · Create a service and cache

**Prompt**

> Proceed to the next step, implement a service that the API will be able to use, and implement a simple cache for the Yahoo data

**Why I asked this**

The core logic and the Yahoo client were complete. The service connects them, and the cache protects Yahoo from too many requests and getting ratelimited.

**What the AI produced**

- `core`: `normalizeSymbol` and `SYMBOL_PATTERN` (one rule for the service and the HTTP layer), `InvalidSymbolError`, the `DailySummaryService` interface, and `StockSummaryService`.
- `infrastructure/cache`: `CachedDailySummaryService`. It keeps each result for the TTL, shares one request between concurrent callers, and does not keep errors. `lru-cache` limits the number of symbols.
- 31 new tests for the symbol rule, the service and the cache.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed |  The agent did not follow the plan for the cache. The plan kept the raw Yahoo bars in a `CachedMarketDataProvider`. The cache now keeps the calculated summaries, in front of the service. I requested this change. |  The summaries depend on "now". Bars from 15:58 with "now" = 16:01 would keep today with an incomplete last bar. A cached result that the service calculated with one "now" is always correct for its time.  |

**Follow-ups**

> Serve data based on whether the last cached time is after close, not whether time.now is closed on the client. Right now, if the cache's most recent entry is 15:58 and the exchange closes at 1600, then the client considers the data complete at 1601 even though it's not complete. The data should only be served once the cache's most recent entry is after closing time.

### 07 · Make the REST API

**Prompt**

> Proceed to the next step, implement the REST API server so I can CURL the local application and get the stock data.

**Why I asked this**

The service was complete, so the next step was the endpoint from the brief.

**What the AI produced**

- `GET /api/v1/stocks/:symbol/daily-summaries` with Fastify and Zod. The route uses `SYMBOL_PATTERN` from the core layer.
- An error handler that sends each error as Problem Details (RFC 9457) with a `traceId`, and the same ID in the `X-Request-Id` header.
- Helmet, CORS from the configuration, and a rate limit for each IP address. `/health` has no rate limit. OpenAPI with Scalar is at `/docs` only in development.
- `config.ts`: one Zod schema for all environment variables, with one message for all problems. `api/.env.example` shows each variable.
- `server.ts`: the composition root, with a clean stop on SIGINT and SIGTERM.
- 27 new tests with `app.inject()`, and tests for the configuration.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed (AI self-corrected)  |  A timeout gives HTTP 504, not 502 or 503 as in the plan. I approved this change.  |  504 Gateway Timeout tells a client and a monitor that the provider was slow, not that it failed.  |
|  Changed (AI self-corrected)  |  The defaults are safe: `NODE_ENV=production` (no `/docs`), `HOST=127.0.0.1`, no CORS origins, and `TRUST_PROXY=false`.  |  If a server does not set a variable, the API does not show more than necessary.  |
|  Changed (AI self-corrected)  |  A test comment said that the test finds a variable that is absent from `.env.example`.  |  That was not true, because a variable with a default does not fail the test. The agent corrected the comment.  |
|  Changed (AI self-corrected)  |  The documentation test requested `/docs`, which gives a redirect (301) to `/docs/`.  |  The redirect is correct, so the agent changed the test, not the code.  |
| Kept  |  The result from the real Yahoo API  |  TSLA gave 22 complete days from 16 September, without today. `tsla` came from the cache in 29 ms. `ZZZZZZ1` gave 404, `TSLA!!` gave 400, and BHP.AX gave 22 days.  |

### 08 · Add Frontend scaffold

**Prompt**

> Proceed with the next step, setup the frontend dependencies

**Why I asked this**

The API was complete, so the next step was the UI. First I need to get a webpage working.

**What the AI produced**

- The `web` workspace: React 19, Vite 8, TanStack Query, Recharts, and Vitest with jsdom and React Testing Library.
- `vite.config.ts` with a proxy from `/api` to the API on port 5080, so the browser does not need CORS in development.
- `tsconfig.json` that extends the root settings, with DOM types and without Node.js types.
- An ESLint rule set for React hooks in the root configuration.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed  |  The Vite template: `tsconfig.app.json` and `tsconfig.node.json` now extend the root settings.  |  The template does not set `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. |
|  Changed  |  The Vite template: `@types/node` changed from `^24` to `^22`, and `main.tsx` does not use `!`.  |  Our `engines` field permits Node.js 22.  |

### 09 · Get the data in the web application

**Prompt**

> Proceed with the next step, the frontend should query the API to get stock data that a user inputs into a field

**Why I asked this**

The UI needs typed data and clear error states before the components.

**What the AI produced**

- `types/dailySummary.ts`: the JSON contract and the Problem Details body as TypeScript types.
- `api/stocksApi.ts`: `fetchDailySummaries` with an abort signal. It gives `ApiError` (with the status and the Problem Details), `NetworkError` or `InvalidResponseError`. The client throws an abort again with no change.
- `hooks/useDailySummaries.ts`: TanStack Query with `skipToken` while there is no symbol. The stale time is 5 minutes, the same as the API cache. There is no retry after a 4xx status.
- `VITE_API_BASE_URL` for an API on a different origin, with `web/.env.example` and a type in `vite-env.d.ts`.
- 25 new tests.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  An absolute URL from the origin of the page  |  `fetch` in the tests (Node.js) does not accept a relative URL. In the browser, the result is the same.  |

### 10 · Display the data in a human-friendly manner

**Prompt**

> Proceed with the next step, add CSS and charts to display the data

**Why I asked this**

The data layer was complete, so the next step was the page that the brief asks for.

**What the AI produced**

- `SymbolSearchForm`: a field with a label, a hint and an error message, with the same symbol rule as the API (`domain/symbol.ts`).
- `DailySummaryCharts`: a price chart (high and low averages) and a volume chart. The two charts have the same days on the horizontal axis and a shared pointer.
- `DailySummaryTable`: the newest day first, prices with 4 decimal places, and volumes with thousands separators.
- The states of the page: idle, invalid symbol, loading, error, empty and success. Each error type has its own message, and only a temporary error has a "Try again" button.
- The symbol in the URL (`?symbol=TSLA`), with the back button.
- Colors in CSS variables for light and dark mode.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Changed |  The price axis had no bottom label. The agent's first fix (`niceScale`, a calculation of round ticks) did not correct it.  | The agent first thought that the axis started at the lowest value. The browser showed that the gridlines were already round. The real cause was that Recharts hides a label at the edge of the axis. I removed `niceScale` and set `interval={0}`.  |
| Rejected  |  A lazy load of the charts to make the browser bundle smaller (638 kB, 189 kB with gzip, mostly Recharts)  |  The application runs only on local development computers, so a smaller first download is not necessary. I added a section in the README that explains how to add a lazy load for a real deployment.  |

**Follow-ups**

> Chart colors, spacing, and fonts are OK. The top chart does not have a bottom axis.

### 11 · Test

**Prompt**

> Proceed to automated frontend testing

**Why I asked this**

The page was complete and passed my smoke tests, so I asked for automated tests.

**What the AI produced**

- `App.test.tsx`: 15 tests of the full page with React Testing Library, user-event and MSW. The tests find elements by role and label, as a screen reader does.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The tests  |  The agent changed the page six times on purpose, and each change broke the expected test. The changes were: the table in the wrong order, no form validation, and a retry button for 404. Also: no reaction to the back button, no check of the symbol in the URL, and an enabled button during a request.  |

### 12 · Docker, a clean verify, and an adversarial review

**Prompt**

> Everything looks good, now I want to dockerize the application. Use docker compose.

**Why I asked this**

The application was complete. This phase makes it simple to run and finds problems before I submit it.

**What the AI produced**

- `docker-compose.yml`, `api/Dockerfile`, `web/Dockerfile`, `web/nginx.conf` and `.dockerignore`. The API image has only the production dependencies and runs without root. Nginx serves the web application without root and sends `/api` to the API.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The Docker files  |  `docker compose config` accepted the files. All commands passed, and the runtime install had only the API production packages.  |
|  Kept  |  The Docker images  |  Both images built. |
|  Changed (AI self-corrected)  |  Nginx sent two `Cache-Control` headers for the files in `/assets/`.  |  The test through Nginx showed it: `expires` adds its own header. The agent replaced the two headers with one, and `nginx -t` in the container accepted the configuration.  |
|  Changed  | the Docker health check reads `PORT`  |  If `PORT` changed, the old check failed, and the web container would not start.  |
|  Changed  | the rate limit also applies to paths that do not exist  |  A scanner could send unlimited requests to unknown paths. A new test fails without the change.  |
|  Changed  |  Docker published port 8080 to all networks of the computer  |  Other people on the same network could use the application. The port is now `127.0.0.1:8080`.  |

**Follow-ups**

> A few small things: Does the rate limit apply to undefined endpoints? If not, close that path. Make the port dynamic so it doesn't break the healthcheck. Use Docker networks to restrict traffic to just localhost.

### 13 · Cleanup

**Prompt**

> Review all of the documentation and comments throughout the project. Ensure all comments are written in ASD-STE100 Simplified Technical English. Comments should  explain the intricacies of node/typescript. Make sure the README reflects up-to-date information and includes a clear quickstart.

**Why I asked this**

The brief asks for code that a team can maintain. Comments should be friendly to an engineer who is not familiar with the specifics of the language. I am personally a fan of ASD-STE100 so I asked all comments to be written in it.

**Kept / changed / rejected**

|   |  What  |  Why  |
| --- | --- | --- |
|  Kept  |  The corrections and the new comments  | Some of the comments were full of jargon or difficult to understand. |
| Rejected | ASD-STE100 violations for technical names ("trading day", "operating system", "daylight saving time")  | ASD-STE100 restricts the use of jargon or technical names, but the agent was too aggressive and wanted to remove some OK items.  |