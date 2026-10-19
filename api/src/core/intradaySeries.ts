// The data types of the core layer. An `interface` only describes the shape of an object for the compiler.
// It does not exist at runtime.
//
// `readonly` means that the compiler stops code that changes the property after the object exists.
// The aggregation reads these objects but never changes them.
// `number | null` is a union type: the value is a number or `null`, and the code must check for the two cases.

/**
 * One 15-minute bar from a market data provider.
 * A `null` value means that the provider has no value for this bar.
 */
export interface IntradayBar {
  /** The start of the bar, in Unix seconds (UTC). */
  readonly timestamp: number;
  readonly low: number | null;
  readonly high: number | null;
  readonly volume: number | null;
}

/** The start and the end of a regular trading session, in Unix seconds (UTC). */
export interface TradingSession {
  readonly start: number;
  readonly end: number;
}

/** The bars for one symbol, with the data that is necessary to put each bar on its exchange date. */
export interface IntradaySeries {
  readonly symbol: string;
  /** The IANA time zone of the exchange, for example `America/New_York`. */
  readonly exchangeTimeZone: string;
  /**
   * The regular session that the provider calls "current". After the close, this can be today or an earlier day.
   * The value is `null` if the provider does not give it.
   */
  readonly currentSession: TradingSession | null;
  // `readonly IntradayBar[]` is an array that the code cannot change (no `push`, no `sort` in place).
  readonly bars: readonly IntradayBar[];
}
