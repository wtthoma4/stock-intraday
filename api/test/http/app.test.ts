// These tests send HTTP requests to the complete Fastify application with `app.inject()`.
// `inject` does not open a network port, so the tests are fast and do not interfere with each other.
//
// The application gets a stub `DailySummaryService`. Each test sets what the stub gives or throws.
// Because of this, the tests examine only the HTTP layer: routes, validation, status codes, headers and the JSON shape.

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { DailySummary } from '../../src/core/dailySummary.js';
import type { DailySummaryService } from '../../src/core/dailySummaryService.js';
import {
  MarketDataUnavailableError,
  SymbolNotFoundError,
  type MarketDataUnavailableReason,
} from '../../src/core/errors.js';
import { buildApp, type HttpConfig } from '../../src/http/app.js';

const SUMMARIES: DailySummary[] = [
  { day: '2026-10-14', lowAverage: 40.2958, highAverage: 49.7534, volume: 49_073_348 },
  { day: '2026-10-15', lowAverage: 41.1, highAverage: 50, volume: 100 },
];

/** A stub service. It keeps the symbols that it got, and gives a result or throws an error. */
class StubService implements DailySummaryService {
  readonly symbols: string[] = [];

  constructor(private readonly reply: readonly DailySummary[] | Error = SUMMARIES) {}

  getDailySummaries(symbol: string): Promise<readonly DailySummary[]> {
    this.symbols.push(symbol);
    return this.reply instanceof Error ? Promise.reject(this.reply) : Promise.resolve(this.reply);
  }
}

const CONFIG: HttpConfig = {
  environment: 'test',
  logLevel: 'silent',
  trustProxy: 0,
  corsAllowedOrigins: ['http://localhost:5173'],
  rateLimitPerMinute: 1_000,
};

// Close each application after its test, so no timers of the rate limit stay open.
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(
  service: DailySummaryService = new StubService(),
  config: Partial<HttpConfig> = {},
): Promise<FastifyInstance> {
  const app = await buildApp({ config: { ...CONFIG, ...config }, dailySummaryService: service });
  apps.push(app);
  return app;
}

function summariesUrl(symbol: string): string {
  return `/api/v1/stocks/${encodeURIComponent(symbol)}/daily-summaries`;
}

describe('GET /api/v1/stocks/:symbol/daily-summaries', () => {
  it('gives the summaries as a JSON array in the shape of the brief', async () => {
    const app = await appWith();

    const response = await app.inject({ method: 'GET', url: summariesUrl('TSLA') });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    // The body must be exactly the array of the brief: camelCase names, `day` as text, numbers as numbers.
    expect(response.body).toBe(
      '[{"day":"2026-10-14","lowAverage":40.2958,"highAverage":49.7534,"volume":49073348},' +
        '{"day":"2026-10-15","lowAverage":41.1,"highAverage":50,"volume":100}]',
    );
  });

  it('gives the symbol to the service in upper case', async () => {
    const service = new StubService();
    const app = await appWith(service);

    await app.inject({ method: 'GET', url: summariesUrl('tsla') });

    expect(service.symbols).toEqual(['TSLA']);
  });

  it('accepts an encoded special character in the symbol', async () => {
    // A client sends ^GSPC as %5EGSPC. Fastify decodes it before the validation.
    const service = new StubService();
    const app = await appWith(service);

    const response = await app.inject({ method: 'GET', url: summariesUrl('^GSPC') });

    expect(response.statusCode).toBe(200);
    expect(service.symbols).toEqual(['^GSPC']);
  });

  it('gives an empty array when the symbol has no complete days', async () => {
    const app = await appWith(new StubService([]));

    const response = await app.inject({ method: 'GET', url: summariesUrl('TSLA') });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  describe('errors as Problem Details', () => {
    it('gives 400 for a bad symbol, and does not call the service', async () => {
      const service = new StubService();
      const app = await appWith(service);

      const response = await app.inject({ method: 'GET', url: summariesUrl('TSLA!!') });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      // The message tells the user how to correct the input.
      expect(response.json()).toMatchObject({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        // `expect.stringContaining` matches any text that contains the value. Its type is `any`, and the strict
        // ESLint rules reject `any`, so `as unknown` changes the type without a change to the value.
        detail: expect.stringContaining('1 to 15 characters') as unknown,
        instance: '/api/v1/stocks/TSLA!!/daily-summaries',
      });
      expect(service.symbols).toEqual([]);
    });

    it('gives 400 for a symbol with more than 15 characters', async () => {
      const app = await appWith();

      const response = await app.inject({ method: 'GET', url: summariesUrl('ABCDEFGHIJKLMNOP') });

      expect(response.statusCode).toBe(400);
    });

    it('gives 404 when the provider does not know the symbol', async () => {
      const app = await appWith(new StubService(new SymbolNotFoundError('ZZZZZZ1')));

      const response = await app.inject({ method: 'GET', url: summariesUrl('ZZZZZZ1') });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        title: 'Not Found',
        detail: 'No market data was found for the symbol "ZZZZZZ1".',
      });
    });

    // Each reason gives a different status, so a client and a monitor can see what went wrong.
    // `it.each` makes one test for each row of the table. `%s` and `%i` in the name show the values of the row.
    // 503 also has `Retry-After`, because the problem goes away after a time.
    it.each<[MarketDataUnavailableReason, number, string | undefined]>([
      ['upstream-error', 502, undefined],
      ['invalid-response', 502, undefined],
      ['rate-limited', 503, '30'],
      ['circuit-open', 503, '30'],
      ['timeout', 504, undefined],
    ])('gives %s as HTTP %i', async (reason, status, retryAfter) => {
      const error = new MarketDataUnavailableError(reason, 'Internal detail: do not send.');
      const app = await appWith(new StubService(error));

      const response = await app.inject({ method: 'GET', url: summariesUrl('TSLA') });

      expect(response.statusCode).toBe(status);
      expect(response.headers['retry-after']).toBe(retryAfter);
      // The client gets a general message. The internal message goes only to the log.
      expect(response.body).not.toContain('Internal detail');
    });

    it('gives 500 with a general message for an unexpected error', async () => {
      // A programming error can contain internal data, for example a file path. It must not go to the client.
      const app = await appWith(new StubService(new Error('Secret path C:\\internal\\file.ts')));

      const response = await app.inject({ method: 'GET', url: summariesUrl('TSLA') });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        title: 'Internal Server Error',
        detail: 'An unexpected error occurred.',
      });
      expect(response.body).not.toContain('Secret');
    });

    it('gives a traceId that is the same as the X-Request-Id header', async () => {
      // Support can find the request in the log with this ID.
      const app = await appWith(new StubService(new SymbolNotFoundError('ZZZZZZ1')));

      const response = await app.inject({ method: 'GET', url: summariesUrl('ZZZZZZ1') });
      const body = response.json<{ traceId: string }>();

      expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['x-request-id']).toBe(body.traceId);
    });

    it('gives 404 as Problem Details for a path that does not exist', async () => {
      const app = await appWith();

      const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    });
  });
});

describe('cross-cutting behavior', () => {
  it('answers /health without the market data service', async () => {
    const service = new StubService();
    const app = await appWith(service);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(service.symbols).toEqual([]);
  });

  it('gives 429 as Problem Details after the rate limit, but never limits /health', async () => {
    // The limit is 2 requests in one minute for one client IP address.
    const app = await appWith(new StubService(), { rateLimitPerMinute: 2 });

    const statuses = [];
    for (let request = 0; request < 3; request += 1) {
      statuses.push((await app.inject({ method: 'GET', url: summariesUrl('TSLA') })).statusCode);
    }
    const limited = await app.inject({ method: 'GET', url: summariesUrl('TSLA') });
    const health = await app.inject({ method: 'GET', url: '/health' });

    expect(statuses).toEqual([200, 200, 429]);
    expect(limited.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(limited.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });
    // A monitor must see the health of the API, also when the API limits a client.
    expect(health.statusCode).toBe(200);
  });

  it('behind one proxy, limits a client that writes a different address in X-Forwarded-For each time', async () => {
    // The attack: the client sends "X-Forwarded-For: 10.0.0.N" with a new N for each request.
    // The proxy adds the real client address (203.0.113.7) at the end. With TRUST_PROXY=1, the API
    // trusts only that last entry, so all requests count for one client and the API limits the third one.
    const app = await appWith(new StubService(), { rateLimitPerMinute: 2, trustProxy: 1 });

    const statuses = [];
    for (let request = 0; request < 3; request += 1) {
      const response = await app.inject({
        method: 'GET',
        url: summariesUrl('TSLA'),
        remoteAddress: '172.18.0.3',
        headers: { 'x-forwarded-for': `10.0.0.${String(request)}, 203.0.113.7` },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('without a proxy, ignores X-Forwarded-For and limits by the connection address', async () => {
    // TRUST_PROXY=0 (the default). The API must not read an address from the header at all.
    const app = await appWith(new StubService(), { rateLimitPerMinute: 2, trustProxy: 0 });

    const statuses = [];
    for (let request = 0; request < 3; request += 1) {
      const response = await app.inject({
        method: 'GET',
        url: summariesUrl('TSLA'),
        headers: { 'x-forwarded-for': `10.0.0.${String(request)}` },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('also limits requests to paths that do not exist', async () => {
    // A scanner sends many requests to paths that do not exist. They must also count against the limit.
    const app = await appWith(new StubService(), { rateLimitPerMinute: 2 });

    const statuses = [];
    for (let request = 0; request < 3; request += 1) {
      statuses.push(
        (await app.inject({ method: 'GET', url: `/unknown-${String(request)}` })).statusCode,
      );
    }

    expect(statuses).toEqual([404, 404, 429]);
  });

  it('allows a configured browser origin', async () => {
    const app = await appWith();

    const response = await app.inject({
      method: 'GET',
      url: summariesUrl('TSLA'),
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow a browser origin that is not in the configuration', async () => {
    const app = await appWith();

    const response = await app.inject({
      method: 'GET',
      url: summariesUrl('TSLA'),
      headers: { origin: 'https://evil.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends security headers', async () => {
    const app = await appWith();

    const response = await app.inject({ method: 'GET', url: '/health' });

    // Helmet sets these headers. `nosniff` stops a browser when it tries to read JSON as a script or as HTML.
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('shows the OpenAPI documentation only in development', async () => {
    const development = await appWith(new StubService(), { environment: 'development' });
    const production = await appWith(new StubService(), { environment: 'production' });

    // /docs gives a redirect (301) to /docs/, so the test requests /docs/ directly.
    const docs = await development.inject({ method: 'GET', url: '/docs/' });
    const document = await development.inject({ method: 'GET', url: '/docs/openapi.json' });
    const hidden = await production.inject({ method: 'GET', url: '/docs/' });

    expect(docs.statusCode).toBe(200);
    expect(document.json()).toMatchObject({
      paths: {
        '/api/v1/stocks/{symbol}/daily-summaries': {
          get: { summary: 'Daily summaries of the last month' },
        },
      },
    });
    expect(hidden.statusCode).toBe(404);
  });
});
