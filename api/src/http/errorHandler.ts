// This file is the only place that changes errors into HTTP status codes.
// The core and infrastructure layers throw domain errors. They do not know HTTP.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import {
  InvalidSymbolError,
  MarketDataUnavailableError,
  SymbolNotFoundError,
  type MarketDataUnavailableReason,
} from '../core/errors.js';
import { PROBLEM_CONTENT_TYPE, problemDetails } from './problemDetails.js';

/**
 * The seconds that a client must wait before it tries again, for each temporary reason.
 * The API sends this value in the `Retry-After` header with HTTP 503.
 */
const RETRY_AFTER_SECONDS = 30;

/**
 * The HTTP status and the message for each reason why market data is not available.
 * `Record<MarketDataUnavailableReason, ...>` is an object with one property for each reason. If a developer adds
 * a reason to the union type and forgets it here, the compiler shows an error.
 */
const UNAVAILABLE_REPLIES: Record<MarketDataUnavailableReason, { status: number; detail: string }> =
  {
    // Yahoo refused requests for a time. The API itself is correct, but it cannot serve now: 503.
    'rate-limited': {
      status: 503,
      detail: 'The market data provider limits requests at the moment. Try again later.',
    },
    // The client stopped requests to Yahoo after too many failures: 503.
    'circuit-open': {
      status: 503,
      detail: 'The market data provider is not available at the moment. Try again later.',
    },
    // Yahoo did not reply in time: 504 Gateway Timeout.
    timeout: {
      status: 504,
      detail: 'The market data provider did not reply in time. Try again later.',
    },
    // Yahoo failed or sent a bad reply: 502 Bad Gateway.
    'upstream-error': {
      status: 502,
      detail: 'The market data provider failed. Try again later.',
    },
    'invalid-response': {
      status: 502,
      detail: 'The market data provider sent data that the API cannot read.',
    },
  };

/** The status that some servers use when the client closed the connection before the reply. */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * Changes an error into a Problem Details reply.
 *
 * - Bad input: 400. The message tells the user how to correct the input.
 * - Unknown symbol: 404.
 * - Market data not available: 502, 503 or 504, with a general message. The log has the details.
 * - Other HTTP errors from Fastify or its plugins (for example 429 from the rate limit): the status of the error.
 * - All other errors: 500 with a general message. The message of a programming error can contain internal data.
 */
// `error: unknown`: JavaScript code can throw any value, not only `Error` objects. Each `instanceof` check below
// tells the compiler the real type of `error` in that branch, so the code can read its properties.
export function problemDetailsErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const send = (status: number, detail: string): FastifyReply =>
    reply
      .code(status)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problemDetails(request, status, detail));

  // The route schema rejected the input. Each Zod issue has a message for the user.
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send(400, error.validation.map((issue) => issue.message).join(' '));
  }
  if (error instanceof InvalidSymbolError) {
    return send(400, error.message);
  }
  if (error instanceof SymbolNotFoundError) {
    return send(404, `No market data was found for the symbol "${error.symbol}".`);
  }
  if (error instanceof MarketDataUnavailableError) {
    const { status, detail } = UNAVAILABLE_REPLIES[error.reason];
    // A warning, not an error: the API is correct, but the provider is not available.
    request.log.warn({ err: error, reason: error.reason }, 'Market data is not available.');
    if (status === 503) {
      // `void`: the code does not need the result of `header` (the reply object), and says so to ESLint.
      void reply.header('Retry-After', String(RETRY_AFTER_SECONDS));
    }
    return send(status, detail);
  }
  // The client closed the connection, so nobody reads the reply. Log it at a low level.
  if (error instanceof Error && error.name === 'AbortError') {
    request.log.info('The client closed the request before the reply.');
    return send(CLIENT_CLOSED_REQUEST, 'The client closed the request.');
  }
  // Fastify and its plugins give a `statusCode` to their HTTP errors, for example 429 from the rate limit.
  // Their messages do not contain internal data, so the API sends them.
  const statusCode = statusCodeOf(error);
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return send(statusCode, error instanceof Error ? error.message : 'The request is not valid.');
  }

  request.log.error({ err: error }, 'An unexpected error occurred.');
  return send(500, 'An unexpected error occurred.');
}

/** Gives the `statusCode` property of an error, if it has one. */
function statusCodeOf(error: unknown): number | undefined {
  // `'statusCode' in error` makes sure that the property exists. After this check, the compiler permits `error.statusCode`.
  // `typeof null` is `'object'` in JavaScript, so the code must also exclude `null`.
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }
  return undefined;
}

/** The reply for a path that does not exist. */
export function problemDetailsNotFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return reply
    .code(404)
    .type(PROBLEM_CONTENT_TYPE)
    .send(
      problemDetails(request, 404, `The path ${request.method} ${request.url} does not exist.`),
    );
}
