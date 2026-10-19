// This file is the composition root of the API. It is the only place that makes the real objects
// and connects them. All other code gets its dependencies through constructor parameters.
//
// `npm start` runs the compiled form of this file (`dist/server.js`). `npm run dev` runs this file directly with `tsx`.

import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { systemClock } from './core/clock.js';
import { StockSummaryService } from './core/stockSummaryService.js';
import { buildApp } from './http/app.js';
import { CachedDailySummaryService } from './infrastructure/cache/cachedDailySummaryService.js';
import { YahooFinanceClient } from './infrastructure/yahoo/yahooFinanceClient.js';

/** Reads the configuration. If it is not valid, write all problems and stop the process. */
function configOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      // Write to the error stream, then stop with exit code 1, so a script or a container sees the failure.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = configOrExit();

// The order of the objects, from the outside to the inside:
// HTTP routes -> cache -> summary service -> Yahoo client.
// Make one Yahoo client and one cache for the process, because each keeps state (circuit breaker, entries).
const dailySummaryService = new CachedDailySummaryService(
  new StockSummaryService(new YahooFinanceClient(config.yahoo), systemClock),
  systemClock,
  config.cache,
);

// JavaScript permits `await` at the top level of an ES module (`"type": "module"` in package.json).
// The file waits until the application has loaded all of its plugins.
const app = await buildApp({ config, dailySummaryService });

// Stop cleanly when the platform stops the process (SIGTERM) or the user types Ctrl+C (SIGINT).
// `close` stops new connections and waits for the current requests to complete.
// `as const` gives the array the exact type `readonly ['SIGINT', 'SIGTERM']`, which `process.once` accepts.
// `process.once` adds a listener for one signal, which Node.js removes after the first call.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Stopping the server.');
    // `close` gives a promise. `then` calls the first function on success and the second function on failure.
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'The server did not stop cleanly.');
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: config.host, port: config.port });
