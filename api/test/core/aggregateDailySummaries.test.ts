// These tests examine `aggregateDailySummaries`. This function changes 15-minute bars into one summary for each day.
//
// The function has three tasks:
//   1. Put each bar on its date in the time zone of the exchange (not UTC and not the server time zone).
//   2. For each day, calculate the mean of the lows, the mean of the highs and the sum of the volumes.
//   3. Keep only complete days in the window. The window starts on the same date one calendar month ago.
//      It ends yesterday, or today if the trading session of today is closed.
//
// The tests use small, made-up series. Each test changes one condition, so a failure shows one problem.

import { describe, expect, it } from 'vitest';

import { aggregateDailySummaries } from '../../src/core/aggregateDailySummaries.js';
import type { IntradayBar, IntradaySeries, TradingSession } from '../../src/core/intradaySeries.js';

const NEW_YORK = 'America/New_York';
const SYDNEY = 'Australia/Sydney';

/**
 * Changes an ISO 8601 time into Unix seconds, the time format that Yahoo uses.
 * Each test writes times with an offset (for example `-04:00`), so the exchange time is simple to read.
 */
function unix(iso: string): number {
  return Date.parse(iso) / 1000;
}

/** Makes one 15-minute bar. A `null` value means "no value", as in the Yahoo data. */
function bar(
  iso: string,
  low: number | null,
  high: number | null,
  volume: number | null,
): IntradayBar {
  return { timestamp: unix(iso), low, high, volume };
}

/**
 * Makes a series for one symbol.
 * The default is New York and no current session. Without a current session, the function never keeps today.
 */
function series(
  bars: IntradayBar[],
  exchangeTimeZone = NEW_YORK,
  currentSession: TradingSession | null = null,
): IntradaySeries {
  return { symbol: 'TEST', exchangeTimeZone, currentSession, bars };
}

// Most tests use this time as "now": Friday 16 October 2026 at 18:00 in New York, after the market closed.
// For this time, the window is 16 September 2026 to 15 October 2026.
// As a result, all bars on 13, 14 and 15 October are in the window.
const AFTER_CLOSE_FRIDAY = new Date('2026-10-16T22:00:00Z');

describe('aggregateDailySummaries', () => {
  it('gives an empty array for a series without bars', () => {
    // A symbol without trades in the window must give an empty result, not an error.
    expect(aggregateDailySummaries(series([]), AFTER_CLOSE_FRIDAY)).toEqual([]);
  });

  it('calculates the averages and the volume sum for each exchange day', () => {
    // Two bars on 14 October and one bar on 15 October.
    // 14 October: lows 10 and 11 give 10.5, highs 12 and 14 give 13, and volumes 100 + 200 give 300.
    // 15 October: one bar, so the averages are the values of that bar.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', 10, 12, 100),
        bar('2026-10-14T09:45:00-04:00', 11, 14, 200),
        bar('2026-10-15T09:30:00-04:00', 20, 22, 300),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result).toEqual([
      { day: '2026-10-14', lowAverage: 10.5, highAverage: 13, volume: 300 },
      { day: '2026-10-15', lowAverage: 20, highAverage: 22, volume: 300 },
    ]);
  });

  it('ignores bars without a low or a high in the averages', () => {
    // Yahoo sends `null` when it has no price for a bar, for example during a trading halt.
    // The two bars in the middle each have one `null` price. Their other price (50 and 1) is very different
    // from the other bars. If the function used one of these prices, the averages would change.
    // Only the first and the last bar give prices: lows (10 + 20) / 2 = 15, highs (12 + 22) / 2 = 17.
    // The volume of all four bars goes into the sum: 100 + 0 + 0 + 100 = 200.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', 10, 12, 100),
        bar('2026-10-14T09:45:00-04:00', null, 50, 0),
        bar('2026-10-14T10:00:00-04:00', 1, null, 0),
        bar('2026-10-14T10:15:00-04:00', 20, 22, 100),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result).toEqual([{ day: '2026-10-14', lowAverage: 15, highAverage: 17, volume: 200 }]);
  });

  it('adds a null volume as 0', () => {
    // A `null` volume must not make the sum `NaN` or `null`. The function adds it as 0.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', 10, 12, 100),
        bar('2026-10-14T09:45:00-04:00', 10, 12, null),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result[0]?.volume).toBe(100);
  });

  it('removes a day that has no bar with a low and a high', () => {
    // On 14 October, all prices are `null`. The function cannot calculate a mean for this day,
    // so it must remove the day. A mean of 0 or `NaN` would be wrong data.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', null, null, null),
        bar('2026-10-15T09:30:00-04:00', 10, 12, 100),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result.map((summary) => summary.day)).toEqual(['2026-10-15']);
  });

  it('rounds to 4 decimal places, half away from zero, without binary floating-point errors', () => {
    // The exact mean of the lows is (40.29555 + 40.29575) / 2 = 40.29565.
    // The 5th decimal place is 5, so the correct result is 40.2957.
    // JavaScript numbers are binary, so `Math.round(mean * 1e4) / 1e4` gives 40.2956. This value is wrong.
    // The highs have a mean of 41.12345. This mean also has 5 in the 5th place, so it must give 41.1235.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', 40.29555, 41.123449, 1),
        bar('2026-10-14T09:45:00-04:00', 40.29575, 41.123451, 1),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result[0]?.lowAverage).toBe(40.2957);
    expect(result[0]?.highAverage).toBe(41.1235);
  });

  it('removes the binary noise from Yahoo prices', () => {
    // These two prices are from the TSLA fixture. Yahoo keeps prices as 32-bit floats,
    // so 361.9 comes as 361.8999938964844. After the function rounds to 4 places, the value is 361.9 again.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-14T09:30:00-04:00', 361.8999938964844, 364.44000244140625, 1),
        bar('2026-10-14T09:45:00-04:00', 361.8999938964844, 364.44000244140625, 1),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result[0]).toMatchObject({ lowAverage: 361.9, highAverage: 364.44 });
  });

  it('gives the days in ascending order', () => {
    // Yahoo sends bars in time order, but the function must not depend on this.
    // The input is in the wrong order on purpose.
    const result = aggregateDailySummaries(
      series([
        bar('2026-10-15T09:30:00-04:00', 1, 2, 1),
        bar('2026-10-13T09:30:00-04:00', 1, 2, 1),
        bar('2026-10-14T09:30:00-04:00', 1, 2, 1),
      ]),
      AFTER_CLOSE_FRIDAY,
    );

    expect(result.map((summary) => summary.day)).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
  });

  // In New York, a trading session never goes across midnight UTC. Because of this, New York data cannot show
  // a time zone error. These tests use Sydney, because its session starts before midnight UTC.
  describe('exchange time zone', () => {
    // On 16 October 2026, Sydney uses AEDT (UTC+11). 06:00 UTC is 17:00 in Sydney, after the market closed.
    const AFTER_CLOSE_SYDNEY = new Date('2026-10-16T06:00:00Z');

    it('puts a bar at 23:30 UTC on the next date in Sydney', () => {
      // 23:30 UTC on 14 October is 10:30 on 15 October in Sydney.
      // 04:00 UTC on 15 October is 15:00 on 15 October in Sydney.
      // Both bars are on 15 October in Sydney. If the function used UTC dates, it would make two days.
      const result = aggregateDailySummaries(
        series(
          [bar('2026-10-14T23:30:00Z', 10, 12, 100), bar('2026-10-15T04:00:00Z', 20, 22, 100)],
          SYDNEY,
        ),
        AFTER_CLOSE_SYDNEY,
      );

      expect(result).toEqual([{ day: '2026-10-15', lowAverage: 15, highAverage: 17, volume: 200 }]);
    });

    it('uses the correct offset on each side of a daylight saving change', () => {
      // Sydney changed from AEST (UTC+10) to AEDT (UTC+11) on 4 October 2026.
      // Before the change, the 10:00 open is 00:00 UTC on the same date.
      // After the change, the 10:00 open is 23:00 UTC on the date before.
      // Each pair of bars is the first and the last bar of one session. Each pair must stay on one date.
      // A fixed offset (for example, always +10 or always +11) puts one pair on two dates.
      const result = aggregateDailySummaries(
        series(
          [
            // Friday 2 October, AEST: 10:00 and 15:45 in Sydney.
            bar('2026-10-02T00:00:00Z', 10, 12, 1),
            bar('2026-10-02T05:45:00Z', 10, 12, 1),
            // Monday 5 October, AEDT: 10:00 and 15:45 in Sydney.
            bar('2026-10-04T23:00:00Z', 20, 22, 1),
            bar('2026-10-05T04:45:00Z', 20, 22, 1),
          ],
          SYDNEY,
        ),
        AFTER_CLOSE_SYDNEY,
      );

      expect(result).toEqual([
        { day: '2026-10-02', lowAverage: 10, highAverage: 12, volume: 2 },
        { day: '2026-10-05', lowAverage: 20, highAverage: 22, volume: 2 },
      ]);
    });
  });

  // The function shows only complete trading days. These tests examine the two ends of the window.
  describe('window of complete days', () => {
    it('removes the days before the same date one calendar month ago', () => {
      // Today is 16 October in New York, so the first day in the window is 16 September.
      // The bar on 15 September is one day too old. The function must remove it.
      // The bar on 16 September is the first day in the window. The function must keep it.
      const result = aggregateDailySummaries(
        series([
          bar('2026-09-15T15:00:00-04:00', 1, 2, 1),
          bar('2026-09-16T09:30:00-04:00', 1, 2, 1),
          bar('2026-10-15T09:30:00-04:00', 1, 2, 1),
        ]),
        AFTER_CLOSE_FRIDAY,
      );

      expect(result.map((summary) => summary.day)).toEqual(['2026-09-16', '2026-10-15']);
    });

    it('uses the last day of the month when the earlier month is shorter', () => {
      // Today is 31 March 2026. February 2026 has no 31st day, so the first day in the window is 28 February.
      // A simple date calculation gives 3 March (31 days after 31 January). That result removes too many days.
      // The bar on 27 February is too old. The bars on 28 February and 2 March are in the window.
      const result = aggregateDailySummaries(
        series([
          bar('2026-02-27T10:00:00-05:00', 1, 2, 1),
          bar('2026-02-28T10:00:00-05:00', 1, 2, 1),
          bar('2026-03-02T10:00:00-05:00', 1, 2, 1),
        ]),
        new Date('2026-03-31T12:00:00-04:00'),
      );

      expect(result.map((summary) => summary.day)).toEqual(['2026-02-28', '2026-03-02']);
    });

    // Today is complete only after the regular session closes. Yahoo gives the times of the
    // current session in `meta.currentTradingPeriod.regular`. The series keeps them as `currentSession`.
    describe('today', () => {
      // The session of Friday 16 October: 09:30 to 16:00 in New York.
      const todaySession: TradingSession = {
        start: unix('2026-10-16T09:30:00-04:00'),
        end: unix('2026-10-16T16:00:00-04:00'),
      };
      // One bar yesterday and one bar today. Each test changes only "now" and the session.
      const bars = [
        bar('2026-10-15T09:30:00-04:00', 1, 2, 1),
        bar('2026-10-16T09:30:00-04:00', 3, 4, 1),
      ];

      it('removes today before the session closes', () => {
        // One second before the close, today is not complete. The averages can still change.
        const result = aggregateDailySummaries(
          series(bars, NEW_YORK, todaySession),
          new Date('2026-10-16T15:59:59-04:00'),
        );

        expect(result.map((summary) => summary.day)).toEqual(['2026-10-15']);
      });

      it('keeps today when the session is closed', () => {
        // At the exact time of the close, today is complete.
        const result = aggregateDailySummaries(
          series(bars, NEW_YORK, todaySession),
          new Date('2026-10-16T16:00:00-04:00'),
        );

        expect(result.map((summary) => summary.day)).toEqual(['2026-10-15', '2026-10-16']);
      });

      it('removes today when the current session is from an earlier date', () => {
        // The session data is from yesterday, and its close is in the past.
        // This close time does not tell us that today is closed, so the function must not keep today.
        const yesterdaySession: TradingSession = {
          start: unix('2026-10-15T09:30:00-04:00'),
          end: unix('2026-10-15T16:00:00-04:00'),
        };

        const result = aggregateDailySummaries(
          series(bars, NEW_YORK, yesterdaySession),
          new Date('2026-10-16T17:00:00-04:00'),
        );

        expect(result.map((summary) => summary.day)).toEqual(['2026-10-15']);
      });

      it('removes today when Yahoo gives no current session', () => {
        // Without session data, the function cannot know if today is complete.
        // It removes today, because an incomplete day is worse than one day less.
        const result = aggregateDailySummaries(
          series(bars, NEW_YORK, null),
          new Date('2026-10-16T17:00:00-04:00'),
        );

        expect(result.map((summary) => summary.day)).toEqual(['2026-10-15']);
      });
    });
  });
});
