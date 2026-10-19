/** The summary of one complete trading day. The API sends this shape as JSON. */
export interface DailySummary {
  /** The date on the exchange, in the format `yyyy-MM-dd`. */
  readonly day: string;
  /** The mean of the bar lows, rounded to 4 decimal places. */
  readonly lowAverage: number;
  /** The mean of the bar highs, rounded to 4 decimal places. */
  readonly highAverage: number;
  /** The sum of the bar volumes. */
  readonly volume: number;
}
