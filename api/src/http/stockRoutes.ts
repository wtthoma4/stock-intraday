// The routes for stocks. The application registers them with the prefix `/api/v1/stocks`.

import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { DailySummaryService } from '../core/dailySummaryService.js';
import { SYMBOL_PATTERN } from '../core/symbol.js';
import { problemDetailsSchema } from './problemDetails.js';

/**
 * The symbol in the path. Zod removes spaces at the ends and changes the symbol to upper case,
 * then it applies the pattern of the core layer. Because of this, the route and the service use the same rule.
 * `.describe` adds a text to the OpenAPI document at `/docs`.
 */
const paramsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      SYMBOL_PATTERN,
      'The symbol must have 1 to 15 characters: letters, digits, ".", "-", "^" or "=".',
    )
    .describe('A Yahoo Finance symbol, for example TSLA, BRK-B, 7203.T or ^GSPC.'),
});

/** The JSON shape for one day. The names and the precision come from the assessment brief. */
const dailySummarySchema = z.object({
  day: z.string().describe('The date on the exchange, yyyy-MM-dd.'),
  lowAverage: z.number().describe('The mean of the 15-minute lows, 4 decimal places.'),
  highAverage: z.number().describe('The mean of the 15-minute highs, 4 decimal places.'),
  volume: z.number().int().describe('The sum of the 15-minute volumes.'),
});

/**
 * Makes a signal that aborts when the client closes the connection before the reply is complete.
 * The service gives the signal to the market data provider, so the API stops a Yahoo request that nobody waits for.
 */
function abortSignalFor(reply: FastifyReply): AbortSignal {
  // An `AbortController` makes a signal. `controller.abort()` tells each listener of the signal to stop.
  const controller = new AbortController();
  // `reply.raw` is the Node.js response object under the Fastify reply. Node.js sends `close` when the connection ends.
  // `once` removes the listener after the first event.
  reply.raw.once('close', () => {
    // After a complete reply, `close` is normal. Abort only if the reply did not finish.
    // `writableFinished` is `true` when Node.js sent all of the reply.
    if (!reply.raw.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}

/**
 * Makes a Fastify plugin with the stock routes. A plugin is a function that adds routes or hooks to the application.
 * This plugin uses the callback form: it must call `done()` when it has added its routes.
 * The function gets the service as a parameter, so a test can give a stub service.
 */
export function stockRoutes(service: DailySummaryService): FastifyPluginCallbackZod {
  // `_options` starts with `_` because the plugin does not use it. The compiler then accepts the unused parameter.
  return (app, _options, done) => {
    app.get(
      '/:symbol/daily-summaries',
      {
        schema: {
          summary: 'Daily summaries of the last month',
          description:
            'Gives one entry for each complete trading day in the last calendar month, in ascending order of day. ' +
            'A day is complete after its regular session closes. The days use the date of the exchange.',
          tags: ['stocks'],
          params: paramsSchema,
          response: {
            200: z.array(dailySummarySchema).readonly(),
            400: problemDetailsSchema.describe('The symbol is not valid.'),
            404: problemDetailsSchema.describe(
              'The market data provider does not know the symbol.',
            ),
            429: problemDetailsSchema.describe('Too many requests from this client.'),
            502: problemDetailsSchema.describe('The market data provider failed.'),
            503: problemDetailsSchema.describe(
              'The market data provider is not available for a time.',
            ),
            504: problemDetailsSchema.describe('The market data provider did not reply in time.'),
          },
        },
      },
      (request, reply) => service.getDailySummaries(request.params.symbol, abortSignalFor(reply)),
    );
    done();
  };
}
