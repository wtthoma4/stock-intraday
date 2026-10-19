// The table of the daily summaries. It shows each value as text, so the data is available
// without the charts (for example, to a screen reader or for a copy into a spreadsheet).

import { formatPrice, formatVolume } from '../format.ts';
import type { DailySummary } from '../types/dailySummary.ts';

interface DailySummaryTableProps {
  readonly symbol: string;
  /** The summaries in ascending order of day, as the API sends them. */
  readonly summaries: readonly DailySummary[];
}

export function DailySummaryTable({ symbol, summaries }: DailySummaryTableProps) {
  // The newest day is the most important to the user, so it is first. `toReversed` gives a new array in the
  // opposite order. `reverse` would change the original array, which is the cached data of TanStack Query.
  const newestFirst = summaries.toReversed();

  return (
    // On a narrow screen, the table scrolls horizontally in its box, not the full page.
    // `tabIndex` lets a keyboard user scroll the box. The label tells a screen reader what the box contains.
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`Daily summaries for ${symbol}`}
    >
      <table className="summary-table">
        <caption>Daily summaries for {symbol}, newest day first</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" className="numeric">
              Low average
            </th>
            <th scope="col" className="numeric">
              High average
            </th>
            <th scope="col" className="numeric">
              Volume
            </th>
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((summary) => (
            <tr key={summary.day}>
              <th scope="row">{summary.day}</th>
              <td className="numeric">{formatPrice(summary.lowAverage)}</td>
              <td className="numeric">{formatPrice(summary.highAverage)}</td>
              <td className="numeric">{formatVolume(summary.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
