// These tests examine `loadConfig`, which reads the environment variables when the API starts.
// A bad configuration must stop the API at start with a clear message, not cause a failure at the first request.

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

/** The only required variable. All other variables have defaults. */
const MINIMUM = { YAHOO_USER_AGENT: 'Mozilla/5.0 Test' };

describe('loadConfig', () => {
  it('uses safe defaults when only the required variable is set', () => {
    const config = loadConfig(MINIMUM);

    // Production by default, so a server that forgets NODE_ENV does not show the documentation.
    expect(config.environment).toBe('production');
    // Only this computer by default. A container sets HOST=0.0.0.0 on purpose.
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(5080);
    // Trust no proxy by default, so a client cannot choose its address for the rate limit.
    expect(config.trustProxy).toBe(0);
    // No cross-origin calls by default.
    expect(config.corsAllowedOrigins).toEqual([]);
    expect(config.rateLimitPerMinute).toBe(60);
    // CACHE_TTL_SECONDS is in seconds. The application uses milliseconds.
    expect(config.cache).toEqual({ ttlMs: 300_000, maxEntries: 1_000 });
    // The Yahoo defaults come from the Yahoo options schema.
    expect(config.yahoo).toMatchObject({
      baseUrl: 'https://query1.finance.yahoo.com',
      userAgent: 'Mozilla/5.0 Test',
      interval: '15m',
      timeoutMs: 10_000,
    });
  });

  it('changes the text values into numbers and lists', () => {
    // Environment variables are always text.
    const config = loadConfig({
      ...MINIMUM,
      PORT: '8080',
      TRUST_PROXY: '1',
      CORS_ALLOWED_ORIGINS: ' http://localhost:5173 , https://app.example.com ,',
      CACHE_TTL_SECONDS: '60',
      YAHOO_TIMEOUT_MS: '2500',
    });

    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(1);
    // The function removes the spaces and the empty item at the end.
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
    expect(config.cache.ttlMs).toBe(60_000);
    expect(config.yahoo.timeoutMs).toBe(2_500);
  });

  it('rejects TRUST_PROXY=true, because it would trust an address that the client writes', () => {
    // TRUST_PROXY is a number of proxies. The old value "true" must stop the start with a clear message,
    // not silently trust all entries of X-Forwarded-For.
    expect(() => loadConfig({ ...MINIMUM, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('names the environment variable when the required User-Agent is missing', () => {
    // The message must name YAHOO_USER_AGENT, not the internal field `userAgent`.
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/YAHOO_USER_AGENT/);
  });

  it('lists all bad values in one message', () => {
    // An operator can correct all problems at one time, not one problem for each start.
    const load = () =>
      loadConfig({ ...MINIMUM, PORT: '70000', LOG_LEVEL: 'loud', TRUST_PROXY: 'yes' });

    expect(load).toThrow(/PORT/);
    expect(load).toThrow(/LOG_LEVEL/);
    expect(load).toThrow(/TRUST_PROXY/);
  });

  it('accepts the example file without changes', () => {
    // A reviewer copies this file to `.env`. If a value in the example is not valid, this test fails.
    const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

    const config = loadConfig(example);

    expect(config.environment).toBe('development');
    expect(config.yahoo.userAgent).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    );
  });
});
