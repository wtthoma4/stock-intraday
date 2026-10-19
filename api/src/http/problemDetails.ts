// The API sends each error as "Problem Details for HTTP APIs" (RFC 9457), with the media type
// `application/problem+json`. A client can read the same fields for each error.

// The `node:` prefix names a module that is part of Node.js. `STATUS_CODES` maps each status to its name,
// for example 404 to "Not Found".
import { STATUS_CODES } from 'node:http';

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** The shape of an error body. The OpenAPI document uses this schema to show the error replies. */
export const problemDetailsSchema = z.object({
  /** `about:blank` means that the HTTP status tells the type of problem. */
  type: z.string(),
  /** The name of the HTTP status, for example "Not Found". */
  title: z.string(),
  status: z.number().int(),
  /** A sentence for a person that tells what went wrong in this request. */
  detail: z.string(),
  /** The path of the request. */
  instance: z.string(),
  /** The ID of the request. The same ID is in the server log, so support can find the request. */
  traceId: z.string(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** Makes the error body for a request. */
export function problemDetails(
  request: FastifyRequest,
  status: number,
  detail: string,
): ProblemDetails {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
    instance: request.url,
    traceId: request.id,
  };
}
