// Zod is a library that checks data at runtime. A schema describes the expected shape and the rules
// (for example, "a positive whole number, 10000 if absent"). TypeScript types exist only at compile time,
// so they cannot check data from outside the program, for example environment variables.
import { z } from 'zod';

/**
 * The settings of the Yahoo Finance client. The application configuration reads them from environment variables.
 * The schema rejects bad values when the application starts, not at the first request.
 * `.default(x)` gives `x` when the value is absent.
 */
export const yahooFinanceOptionsSchema = z.object({
  /** The scheme and host of the Yahoo chart API, with no path. */
  baseUrl: z.url().default('https://query1.finance.yahoo.com'),
  /** Yahoo refuses requests without a User-Agent of a browser. There is no default, so the value is always in the configuration. */
  userAgent: z.string().min(1),
  /** The length of one bar. The API contract uses 15-minute bars. */
  interval: z.enum(['1m', '2m', '5m', '15m', '30m', '60m']).default('15m'),
  /** The time limit for one HTTP attempt. */
  timeoutMs: z.number().int().positive().default(10_000),
  /** The number of attempts after the first one, for a network error, HTTP 429, HTTP 5xx or a timeout. */
  retryAttempts: z.number().int().min(0).max(5).default(2),
  /** The delay before the first new attempt. Each next delay is longer. */
  retryBaseDelayMs: z.number().int().min(0).default(250),
  /** The number of failed requests in a sequence that stops all requests for a time. */
  circuitBreakerThreshold: z.number().int().positive().default(5),
  /** The time after which the client tries one request again when the circuit is open. */
  circuitBreakerHalfOpenAfterMs: z.number().int().positive().default(30_000),
});

// `z.infer` makes the TypeScript type from the schema, so the type and the runtime check cannot be different.
// `typeof yahooFinanceOptionsSchema` is the type of the schema object, not of the options.
export type YahooFinanceOptions = z.infer<typeof yahooFinanceOptionsSchema>;
