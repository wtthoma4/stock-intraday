// The JSON contract of the API, as TypeScript types. These types must agree with the API exactly.

/** One complete trading day. The API sends an array of these objects, in ascending order of `day`. */
export interface DailySummary {
  /** The date on the exchange, in the format `yyyy-MM-dd`. */
  readonly day: string;
  /** The mean of the 15-minute lows, with 4 decimal places. */
  readonly lowAverage: number;
  /** The mean of the 15-minute highs, with 4 decimal places. */
  readonly highAverage: number;
  /** The sum of the 15-minute volumes. */
  readonly volume: number;
}

/** The body of each error reply from the API ("Problem Details", RFC 9457). */
export interface ProblemDetails {
  readonly type: string;
  /** The name of the HTTP status, for example "Not Found". */
  readonly title: string;
  readonly status: number;
  /** A sentence for a person that tells what went wrong. */
  readonly detail: string;
  readonly instance: string;
  /** The ID of the request in the server log. */
  readonly traceId: string;
}
