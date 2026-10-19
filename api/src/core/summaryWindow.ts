/**
 * The summary window starts on the same date this number of calendar months before today, on the exchange.
 * `aggregateDailySummaries` applies the window. `dataRangeFor` makes sure that the data covers it.
 */
export const SUMMARY_WINDOW_MONTHS = 1;

/** The longest calendar month has 31 days. */
const MAX_DAYS_IN_WINDOW = 31 * SUMMARY_WINDOW_MONTHS;

/**
 * Extra days before the window. The exchange time zone is not known before the provider replies.
 * UTC offsets are between -12 and +14 hours, so 2 days cover the start of the first day in all time zones.
 */
const TIME_ZONE_BUFFER_DAYS = 2;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Gives the time range to request from a market data provider at the time `now`.
 * The range starts before the first day of the window, so the first day has all its bars.
 * The aggregation removes the extra days. The range is 33 days, in the 60-day limit of Yahoo for 15-minute bars.
 */
export function dataRangeFor(now: Date): { from: Date; to: Date } {
  const days = MAX_DAYS_IN_WINDOW + TIME_ZONE_BUFFER_DAYS;
  return { from: new Date(now.getTime() - days * MILLISECONDS_PER_DAY), to: now };
}
