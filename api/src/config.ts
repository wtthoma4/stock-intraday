// This file reads the configuration of the API from environment variables.
//
// All values go through one Zod schema when the application starts. If a value is absent or bad,
// the application stops immediately with a list of all problems. It does not fail later, at the first request.
// `api/.env.example` shows each variable with an example value.
//
// Zod checks data at runtime against a schema. TypeScript types cannot do this, because they do not exist at runtime.
import { z } from 'zod';

import { yahooFinanceOptionsSchema } from './infrastructure/yahoo/yahooFinanceOptions.js';
import type { YahooFinanceOptions } from './infrastructure/yahoo/yahooFinanceOptions.js';

/**
 * A comma-separated list, for example `http://localhost:5173, https://app.example.com`.
 * Each item has no spaces at its ends, and the function removes empty items.
 * `.transform` changes the value after the check: here, from one text into an array of texts.
 */
const commaSeparatedList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

/**
 * The environment variables. Environment variables are always text, so numbers use `z.coerce.number()`.
 * You must set each variable that has no default.
 * `z.coerce.number()` changes the text into a number first, then checks the number.
 */
const environmentSchema = z.object({
  // `development` shows the OpenAPI documentation at `/docs`. Use `production` on a server.
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  // 127.0.0.1 accepts connections only from this computer. A container must use 0.0.0.0.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // The number of reverse proxies in front of the API: 0 with no proxy, 1 behind Nginx.
  // The API reads the client IP address from `X-Forwarded-For`, and it trusts only the last entries that its own
  // proxies added. A client can put any address in this header. If the API trusted all entries, a client
  // could send a different address with each request and so avoid the rate limit.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // The origins that can call the API from a browser. Empty means no cross-origin calls.
  CORS_ALLOWED_ORIGINS: commaSeparatedList,
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(1_000),
  // The Yahoo settings. The defaults are in `yahooFinanceOptionsSchema`, so they exist in one place only.
  YAHOO_BASE_URL: z.string().optional(),
  YAHOO_USER_AGENT: z.string().optional(),
  YAHOO_INTERVAL: z.string().optional(),
  YAHOO_TIMEOUT_MS: z.coerce.number().optional(),
  YAHOO_RETRY_ATTEMPTS: z.coerce.number().optional(),
  YAHOO_RETRY_BASE_DELAY_MS: z.coerce.number().optional(),
  YAHOO_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().optional(),
  YAHOO_CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS: z.coerce.number().optional(),
});

/** The configuration that the application uses, with names and units that are simple to read in code. */
export interface AppConfig {
  readonly environment: 'development' | 'production' | 'test';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  /** The number of trusted reverse proxies. 0 means that the API trusts no `X-Forwarded-For` entry. */
  readonly trustProxy: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly rateLimitPerMinute: number;
  readonly cache: { readonly ttlMs: number; readonly maxEntries: number };
  readonly yahoo: YahooFinanceOptions;
}

/** The configuration is not valid. The message lists each bad variable. */
export class ConfigError extends Error {
  constructor(issues: readonly string[]) {
    super(`The configuration is not valid:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Reads and validates the configuration. Throws `ConfigError` with all problems, not only the first one.
 * The parameter is usually `process.env`. Tests give a plain object.
 * `Record<string, string | undefined>` is an object with text keys. Each value is text or absent.
 */
export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  // `safeParse` does not throw. It gives `{ success: true, data }` or `{ success: false, error }`,
  // and the error contains all issues, so the message can list all of them.
  const parsedEnvironment = environmentSchema.safeParse(environment);
  if (!parsedEnvironment.success) {
    throw new ConfigError(describeIssues(parsedEnvironment.error));
  }
  const env = parsedEnvironment.data;

  // The Yahoo schema gives the defaults for the variables that are not set.
  // `withoutUndefined` removes the variables that are not set, so the schema defaults apply to them.
  const parsedYahoo = yahooFinanceOptionsSchema.safeParse(
    withoutUndefined({
      baseUrl: env.YAHOO_BASE_URL,
      userAgent: env.YAHOO_USER_AGENT,
      interval: env.YAHOO_INTERVAL,
      timeoutMs: env.YAHOO_TIMEOUT_MS,
      retryAttempts: env.YAHOO_RETRY_ATTEMPTS,
      retryBaseDelayMs: env.YAHOO_RETRY_BASE_DELAY_MS,
      circuitBreakerThreshold: env.YAHOO_CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerHalfOpenAfterMs: env.YAHOO_CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS,
    }),
  );
  if (!parsedYahoo.success) {
    // Show the names of the environment variables, not the names of the option fields.
    throw new ConfigError(describeIssues(parsedYahoo.error, YAHOO_VARIABLE_NAMES));
  }

  return {
    environment: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    cache: { ttlMs: env.CACHE_TTL_SECONDS * 1000, maxEntries: env.CACHE_MAX_ENTRIES },
    yahoo: parsedYahoo.data,
  };
}

/** The environment variable for each Yahoo option field. An error message uses these names. */
const YAHOO_VARIABLE_NAMES: Record<string, string> = {
  baseUrl: 'YAHOO_BASE_URL',
  userAgent: 'YAHOO_USER_AGENT',
  interval: 'YAHOO_INTERVAL',
  timeoutMs: 'YAHOO_TIMEOUT_MS',
  retryAttempts: 'YAHOO_RETRY_ATTEMPTS',
  retryBaseDelayMs: 'YAHOO_RETRY_BASE_DELAY_MS',
  circuitBreakerThreshold: 'YAHOO_CIRCUIT_BREAKER_THRESHOLD',
  circuitBreakerHalfOpenAfterMs: 'YAHOO_CIRCUIT_BREAKER_HALF_OPEN_AFTER_MS',
};

/** Changes Zod issues into lines such as `PORT: Too big: expected number to be <=65535`. */
function describeIssues(error: z.ZodError, names: Record<string, string> = {}): string[] {
  return error.issues.map((issue) => {
    const field = issue.path.join('.');
    return `${names[field] ?? field}: ${issue.message}`;
  });
}

/**
 * Removes the properties with the value `undefined`.
 * `Object.entries` changes the object into `[key, value]` pairs, the filter removes some pairs,
 * and `Object.fromEntries` changes the pairs back into an object.
 * Zod uses a default only when the property is absent. A property with the value `undefined` must not be in the object.
 */
function withoutUndefined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
