// This file makes the Fastify application. It does not start a server, so tests can call it
// with stub services and send requests with `app.inject()`, without a network port.
//
// How Fastify works, in short: the application is a tree of plugins. `app.register(plugin)` adds a plugin,
// for example the CORS rules or a group of routes. `await` on `register` loads the plugins in the order of this file.
// A hook (`addHook`) is a function that Fastify calls at one step of each request, for example before it sends the reply.

// The `node:` prefix names a module that is part of Node.js, not a package from npm.
import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import type { DailySummaryService } from '../core/dailySummaryService.js';
import { problemDetailsErrorHandler, problemDetailsNotFoundHandler } from './errorHandler.js';
import { stockRoutes } from './stockRoutes.js';

/** The parts of the configuration that the HTTP layer uses. `Pick` makes a type with only the named properties. */
export type HttpConfig = Pick<
  AppConfig,
  'environment' | 'logLevel' | 'trustProxy' | 'corsAllowedOrigins' | 'rateLimitPerMinute'
>;

export interface AppDependencies {
  readonly config: HttpConfig;
  readonly dailySummaryService: DailySummaryService;
}

/** Makes the application with all plugins and routes. The caller starts it with `listen` or tests it with `inject`. */
// `{ config, dailySummaryService }` takes the two properties out of the parameter object (destructuring).
export async function buildApp({
  config,
  dailySummaryService,
}: AppDependencies): Promise<FastifyInstance> {
  const showDocs = config.environment === 'development';

  // `withTypeProvider` (at the end of this statement) tells TypeScript to read the types of `request.params`
  // and of the reply from the Zod schemas of each route.
  const app = Fastify({
    // Pino writes one JSON line for each request and each reply. `silent` stops all log output.
    logger: { level: config.logLevel },
    // Behind a reverse proxy, the client IP address comes from `X-Forwarded-For`. Fastify reads the addresses
    // from the end: hop 0 is the connection, hop 1 is the last header entry, and so on. It trusts each hop
    // for which this function gives `true`, and uses the first address that it does not trust.
    // With TRUST_PROXY=1 it trusts the connection (Nginx) and uses the address that Nginx added.
    // With 0 it uses the connection address and ignores the header.
    // Do not use `true`: then Fastify takes the first entry, which the client can write.
    // (Fastify also accepts a number at runtime, but its TypeScript types do not, so this is the typed form.)
    trustProxy: (_address: string, hop: number) => hop < config.trustProxy,
    // A random ID for each request. The ID is in each log line and in each error body as `traceId`.
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  // Zod validates the input and serializes the output of each route that has a schema.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Set the error handler before the plugins and routes, so all of them use it.
  app.setErrorHandler(problemDetailsErrorHandler);

  // Send the request ID in each reply, so a client can give it to support.
  // Fastify calls an `onSend` hook immediately before it sends each reply. `done(null, payload)` tells Fastify to continue.
  app.addHook('onSend', (request, reply, payload, done) => {
    // `reply.header` gives the reply object back, not a value that the code needs. `void` tells ESLint
    // that the code does not use the result on purpose.
    void reply.header('X-Request-Id', request.id);
    done(null, payload);
  });

  // Security headers. The documentation page uses inline scripts, so the content security policy
  // is off only when the documentation is on (development).
  await app.register(helmet, showDocs ? { contentSecurityPolicy: false } : {});

  // A browser on one of these origins can call the API. With no origins, the API sends no CORS headers.
  await app.register(cors, {
    origin: config.corsAllowedOrigins.length > 0 ? [...config.corsAllowedOrigins] : false,
    methods: ['GET'],
  });

  // A limit for each client IP address, to protect the API and the Yahoo quota.
  await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });

  // The rate limit applies to routes, but a path that does not exist has no route.
  // Without this pre-handler, a client could send unlimited requests to unknown paths.
  // `app.rateLimit()` exists only after the code registers the plugin, so this line is after the registration.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, problemDetailsNotFoundHandler);

  // The OpenAPI document and the Scalar page at `/docs`, only in development.
  if (showDocs) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Stock Intraday API',
          description: 'Daily summaries of 15-minute intraday data from Yahoo Finance.',
          version: '1.0.0',
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(scalar, { routePrefix: '/docs' });
  }

  // A liveness check for a load balancer or a container. It does not call Yahoo,
  // because a Yahoo failure must not make the platform restart the API. The rate limit does not apply.
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: { hide: true, response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    // `as const` gives the type `'ok'` (this exact text), not `string`, so it agrees with `z.literal('ok')`.
    () => ({ status: 'ok' as const }),
  );

  await app.register(stockRoutes(dailySummaryService), { prefix: '/api/v1/stocks' });

  return app;
}
