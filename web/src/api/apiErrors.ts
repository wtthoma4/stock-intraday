// The errors that the API client gives. The UI uses the class and the status to select a message.
//
// There are three types of failure, and each one needs a different message for the user:
// - `ApiError`: the API replied with an error status (for example 404 for an unknown symbol).
// - `NetworkError`: the browser did not get a reply (for example, the API is off).
// - `InvalidResponseError`: the API replied with success, but the body does not have the expected shape.

import type { ProblemDetails } from '../types/dailySummary.ts';

/** The API replied with an HTTP error status. */
export class ApiError extends Error {
  readonly status: number;
  /** The Problem Details body, if the reply had one. A proxy (for example Nginx) can send HTML instead. */
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null) {
    super(problem?.detail ?? `The API replied with HTTP ${String(status)}.`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /**
   * `true` for a 4xx status. The same request will fail again, so the client must not try again.
   * `get` makes an accessor: code reads it as a property (`error.isClientError`), and the function calculates the value at each read.
   */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** The browser did not get a reply from the API. */
export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('The API did not reply. Make sure that the API is running.', options);
    this.name = 'NetworkError';
  }
}

/** The API replied with success, but the body does not have the shape of the contract. */
export class InvalidResponseError extends Error {
  constructor() {
    super('The API sent data that the application cannot read.');
    this.name = 'InvalidResponseError';
  }
}
