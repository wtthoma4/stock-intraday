// `big.js` does arithmetic with decimal numbers. JavaScript numbers are binary, so 0.1 + 0.2 gives
// 0.30000000000000004, and a mean can round the wrong way. `Big` keeps each decimal value exact.
import Big from 'big.js';

// Two notes about the imports in all API files:
// - `import type` imports only a type. The compiler removes the import, so it has no cost at runtime.
// - A relative import ends in `.js`, although the file is `.ts`. Node.js ES modules need the real file name,
//   and the compiler changes each `.ts` file into a `.js` file with the same name.
import type { DailySummary } from './dailySummary.js';
import type { IntradaySeries, TradingSession } from './intradaySeries.js';
import { SUMMARY_WINDOW_MONTHS } from './summaryWindow.js';

/** The API gives prices with 4 decimal places. */
const PRICE_DECIMAL_PLACES = 4;

/** The totals for one day. They increase with each bar of the day. `Big` keeps the decimal values exact. */
interface DayTotals {
  lowSum: Big;
  highSum: Big;
  /** The number of bars with a low and a high. Only these bars go into the averages. */
  priceBarCount: number;
  volume: number;
}

/**
 * Changes intraday bars into one summary for each complete trading day.
 *
 * - Each bar goes on its date in the time zone of the exchange.
 * - The window starts on the same date one calendar month before today, on the exchange.
 *   It ends yesterday, or today if the session of today is closed at `now`.
 * - Bars with a `null` low or high do not go into the averages. A `null` volume adds 0.
 * - A day without a bar that has a low and a high is not in the result.
 *
 * The result is in ascending order of `day`.
 */
export function aggregateDailySummaries(series: IntradaySeries, now: Date): DailySummary[] {
  const toExchangeDate = createExchangeDateFormatter(series.exchangeTimeZone);
  const today = toExchangeDate(now.getTime());
  const firstDay = subtractCalendarMonths(today, SUMMARY_WINDOW_MONTHS);
  const lastDay = isTodayClosed(series.currentSession, today, now, toExchangeDate)
    ? today
    : previousDate(today);

  // A `Map` from the date (yyyy-MM-dd) to the totals of that day. `<string, DayTotals>` gives the types
  // of the keys and the values, so the compiler knows the type of each value that `get` gives.
  const totalsByDay = new Map<string, DayTotals>();
  for (const bar of series.bars) {
    const day = toExchangeDate(bar.timestamp * 1000);
    // The dates have the format yyyy-MM-dd, so a string comparison gives the date order.
    if (day < firstDay || day > lastDay) {
      continue;
    }

    // `get` gives `undefined` for the first bar of a day. Then make the totals for that day.
    let totals = totalsByDay.get(day);
    if (totals === undefined) {
      totals = { lowSum: new Big(0), highSum: new Big(0), priceBarCount: 0, volume: 0 };
      totalsByDay.set(day, totals);
    }

    // `a ?? b` gives `b` only if `a` is `null` or `undefined`. So a `null` volume adds 0, but a volume of 0 stays 0.
    totals.volume += bar.volume ?? 0;
    if (bar.low !== null && bar.high !== null) {
      totals.lowSum = totals.lowSum.plus(bar.low);
      totals.highSum = totals.highSum.plus(bar.high);
      totals.priceBarCount += 1;
    }
  }

  // `[...totalsByDay]` changes the `Map` into an array of `[day, totals]` pairs.
  // `([, totals])` takes the second item of each pair, and `([day, totals])` takes the two items.
  return [...totalsByDay]
    .filter(([, totals]) => totals.priceBarCount > 0)
    .sort(([dayA], [dayB]) => (dayA < dayB ? -1 : 1))
    .map(([day, totals]) => ({
      day,
      lowAverage: roundedMean(totals.lowSum, totals.priceBarCount),
      highAverage: roundedMean(totals.highSum, totals.priceBarCount),
      volume: totals.volume,
    }));
}

/**
 * Makes a function that gives the exchange date (yyyy-MM-dd) of a time in milliseconds.
 * `Intl` uses the time zone rules of each date, so daylight saving changes have no effect on the result.
 */
function createExchangeDateFormatter(timeZone: string): (epochMilliseconds: number) => string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return (epochMilliseconds) => {
    // `format` gives text such as "10/16/2026", and the order of the parts changes with the locale.
    // `formatToParts` gives each part separately ({ type: 'year', value: '2026' }, and so on),
    // so the code does not depend on the date format of a locale.
    const parts = formatter.formatToParts(epochMilliseconds);
    // `find(...)?.value` gives `undefined` if `find` finds no part, and `?? ''` then gives an empty text.
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
}

/**
 * Today is complete only if the current session is on today's exchange date and `now` is at or after its end.
 * A session from an earlier date tells nothing about today.
 */
function isTodayClosed(
  session: TradingSession | null,
  today: string,
  now: Date,
  toExchangeDate: (epochMilliseconds: number) => string,
): boolean {
  if (session === null) {
    return false;
  }
  return toExchangeDate(session.start * 1000) === today && now.getTime() >= session.end * 1000;
}

/**
 * Subtracts calendar months from a yyyy-MM-dd date.
 * If the result month has fewer days, the result is the last day of that month (31 March - 1 month = 28 February).
 */
function subtractCalendarMonths(isoDate: string, months: number): string {
  const [year, month, day] = parseIsoDate(isoDate);
  const monthIndex = year * 12 + (month - 1) - months;
  const resultYear = Math.floor(monthIndex / 12);
  const resultMonth = (monthIndex % 12) + 1;
  // Day 0 of the next month is the last day of this month.
  const daysInResultMonth = new Date(Date.UTC(resultYear, resultMonth, 0)).getUTCDate();
  return formatIsoDate(resultYear, resultMonth, Math.min(day, daysInResultMonth));
}

/** Gives the date before a yyyy-MM-dd date. */
function previousDate(isoDate: string): string {
  const [year, month, day] = parseIsoDate(isoDate);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Changes `2026-10-16` into `[2026, 10, 16]`.
 * The return type is a tuple: an array with exactly three numbers. The names only help a reader.
 */
function parseIsoDate(isoDate: string): [year: number, month: number, day: number] {
  // `= NaN` is a default value. With `noUncheckedIndexedAccess`, each array item can be `undefined`,
  // so the code must give a value for that case. The input always has three parts, so the default is not used.
  const [year = NaN, month = NaN, day = NaN] = isoDate.split('-').map(Number);
  return [year, month, day];
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Divides with exact decimals, then rounds half away from zero. Binary numbers can round a tie down. */
function roundedMean(sum: Big, count: number): number {
  return sum.div(count).round(PRICE_DECIMAL_PLACES, Big.roundHalfUp).toNumber();
}
