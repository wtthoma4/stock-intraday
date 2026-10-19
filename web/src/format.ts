// The number and date formats of the page. All formats use `en-US`, so the page and the tests
// show the same text on each computer.

/** Prices in the table: always 4 decimal places, as the API sends them (for example 40.2958). */
const priceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** Volumes in the table: whole numbers with thousands separators (for example 49,073,348). */
const volumeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Prices on a chart axis: a maximum of 2 decimal places, so the axis stays short. */
const axisPriceFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Volumes on a chart axis: compact (for example 29M), so the axis stays short. */
const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Short dates on a chart axis (for example "Sep 16").
 * The day is a calendar date without a time. UTC keeps the date the same in all time zones of the browser.
 */
const shortDayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export const formatPrice = (value: number): string => priceFormat.format(value);
export const formatVolume = (value: number): string => volumeFormat.format(value);
export const formatAxisPrice = (value: number): string => axisPriceFormat.format(value);
export const formatCompact = (value: number): string => compactFormat.format(value);

/** Changes `2026-09-16` into `Sep 16`. */
export function formatShortDay(day: string): string {
  return shortDayFormat.format(new Date(`${day}T00:00:00Z`));
}
