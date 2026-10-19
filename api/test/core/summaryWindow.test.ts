// These tests examine `dataRangeFor`. This function gives the time range that the service requests from the provider.
//
// The range must have two properties:
//   1. It must start before the first day of the window in all time zones. Then the first day has all its bars.
//   2. It must stay in the 60-day limit of Yahoo for 15-minute bars.

import { describe, expect, it } from 'vitest';

import { dataRangeFor } from '../../src/core/summaryWindow.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

describe('dataRangeFor', () => {
  it('ends at the current time', () => {
    const now = new Date('2026-10-16T14:48:44Z');

    expect(dataRangeFor(now).to).toEqual(now);
  });

  it('starts 33 days before the current time', () => {
    // 31 days for the longest calendar month, and 2 days for the time zone buffer.
    const now = new Date('2026-10-16T14:48:44Z');

    expect(dataRangeFor(now).from).toEqual(new Date('2026-09-13T14:48:44Z'));
  });

  it('starts before the first day of the window on the exchange with the largest UTC offset', () => {
    // Today is 31 March 2026 in New York. The window starts on 28 February 2026 (the last day of February).
    // The largest UTC offset is +14 hours (Pacific/Kiritimati). There, 28 February starts at 10:00 UTC on 27 February.
    // The range must start at or before that time.
    const now = new Date('2026-03-31T12:00:00-04:00');
    const startOfFirstDayAtPlus14 = new Date('2026-02-28T00:00:00+14:00');

    expect(dataRangeFor(now).from.getTime()).toBeLessThanOrEqual(startOfFirstDayAtPlus14.getTime());
  });

  it('stays in the 60-day limit of Yahoo', () => {
    const now = new Date('2026-10-16T14:48:44Z');
    const { from, to } = dataRangeFor(now);

    expect((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY).toBeLessThan(60);
  });
});
