// Zod checks the Yahoo reply at runtime. A TypeScript type alone cannot do this, because types do not exist
// at runtime, and the reply comes from outside the program.
import { z } from 'zod';

/**
 * The parts of the Yahoo chart response that this application uses.
 * Zod removes all other fields. If Yahoo changes the shape of these fields, the parse fails at this boundary.
 *
 * The shape (from saved responses):
 * `chart.result[0].timestamp[i]` is the start of bar `i` in Unix seconds, and
 * `chart.result[0].indicators.quote[0].low[i]` (also `high` and `volume`) is the value of bar `i` or `null`.
 *
 * Two Zod words that this file uses:
 * - `.nullable()`: the field is present, but its value can be `null`.
 * - `.optional()`: the field can be absent from the object.
 */

/**
 * Gives `true` if the runtime knows the IANA time zone.
 * `Intl.DateTimeFormat` throws a `RangeError` for an unknown time zone, so the function tries to make one.
 */
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** An array of numbers in which each item can be `null` (a bar without a value). */
const nullableNumbers = z.array(z.number().nullable());

const quoteSchema = z.object({
  low: nullableNumbers.optional(),
  high: nullableNumbers.optional(),
  volume: nullableNumbers.optional(),
});

const chartResultSchema = z.object({
  meta: z.object({
    symbol: z.string(),
    // `.refine` adds a custom rule. The parse fails with the message if the function gives `false`.
    exchangeTimezoneName: z.string().refine(isKnownTimeZone, 'Unknown IANA time zone'),
    currentTradingPeriod: z
      .object({ regular: z.object({ start: z.number(), end: z.number() }) })
      .optional(),
  }),
  // Yahoo does not send `timestamp` when there are no bars in the range.
  timestamp: z.array(z.number()).optional(),
  indicators: z.object({ quote: z.array(quoteSchema) }),
});

export const yahooChartResponseSchema = z.object({
  chart: z.object({
    // For a known symbol, `result` has the data and `error` is `null`. For an unknown symbol, it is the opposite.
    result: z.array(chartResultSchema).nullable(),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

// `z.infer` makes the TypeScript type from the schema, so the type always agrees with the runtime check.
export type YahooChartResult = z.infer<typeof chartResultSchema>;
