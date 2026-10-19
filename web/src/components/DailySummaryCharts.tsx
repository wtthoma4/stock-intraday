// Two charts of the daily summaries, one above the other, with the same days on the horizontal axis:
//   1. Price: the high average and the low average as lines, on one price axis.
//   2. Volume: one bar for each day.
//
// Why two charts and not one chart with two vertical axes:
// Two axes on one chart make a relation between price and volume that the data does not have.
// The position of a line against a bar depends only on the scale of each axis. Two charts
// with a shared day axis show the same data without that false relation.
//
// The charts use `syncId`, so a pointer on one chart also shows the same day on the other chart.
// The table under the charts gives all values as text. As a result, no value is only in a tooltip.

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  formatAxisPrice,
  formatCompact,
  formatPrice,
  formatShortDay,
  formatVolume,
} from '../format.ts';
import type { DailySummary } from '../types/dailySummary.ts';

/**
 * The series of the charts. Each series has a fixed color in the CSS (`--series-*`), from a palette
 * that the data visualization validator accepted for color blindness, in light and dark mode.
 * Text never uses these colors. Text uses the text colors, and a colored key shows the series.
 */
const SERIES = {
  high: { label: 'High average', color: 'var(--series-high)' },
  low: { label: 'Low average', color: 'var(--series-low)' },
  volume: { label: 'Volume', color: 'var(--series-volume)' },
} as const;
// `as const` makes the object read-only and keeps the exact text of each value in its type.

/** The plot height plus the band for the axis labels, so the labels are never cut. */
const PRICE_CHART_HEIGHT = 260;
const VOLUME_CHART_HEIGHT = 180;

/** The same `syncId` connects the pointer of the two charts. */
const SYNC_ID = 'daily-summaries';

/** Small, quiet axis text in the muted text color. */
const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };

interface DailySummaryChartsProps {
  /** The summaries in ascending order of day, as the API sends them. */
  readonly summaries: readonly DailySummary[];
}

export function DailySummaryCharts({ summaries }: DailySummaryChartsProps) {
  // Recharts needs a mutable array. The copy also protects the cached data of TanStack Query.
  const data = [...summaries];
  // A `Map` from the day to its summary. The tooltip uses it to find the summary of the day under the pointer.
  const byDay = new Map(data.map((summary) => [summary.day, summary]));

  return (
    <div className="charts">
      <figure className="chart">
        <figcaption>
          <span className="chart-title">Daily price averages</span>
          {/* A legend for the two lines. The lines are close together, so labels at the line ends would collide. */}
          <ul className="legend" aria-label="Legend">
            <LegendItem label={SERIES.high.label} color={SERIES.high.color} />
            <LegendItem label={SERIES.low.label} color={SERIES.low.color} />
          </ul>
        </figcaption>
        <ResponsiveContainer width="100%" height={PRICE_CHART_HEIGHT}>
          <LineChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {/* Horizontal hairlines only. They help to read values, but stay quiet. */}
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            {/* Each chart has its own date axis, so a reader can read each chart alone. */}
            <XAxis
              dataKey="day"
              tickFormatter={formatShortDay}
              tick={AXIS_TICK}
              axisLine={{ stroke: 'var(--axis)' }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              domain={['auto', 'auto']}
              // Show every tick. By default, Recharts hides a label at the end of the axis if it touches the edge.
              interval={0}
              tickFormatter={formatAxisPrice}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            {/*
              `content` is a "render prop": Recharts calls this function when the pointer moves, and shows the
              element that it gives. `active` is true when the pointer is on the chart, and `label` is the day.
            */}
            <Tooltip
              cursor={{ stroke: 'var(--axis)' }}
              content={({ active, label }) => (
                <ChartTooltip
                  summary={active && typeof label === 'string' ? byDay.get(label) : undefined}
                  rows={(summary) => [
                    { ...SERIES.high, value: formatPrice(summary.highAverage) },
                    { ...SERIES.low, value: formatPrice(summary.lowAverage) },
                  ]}
                />
              )}
            />
            <Line
              // Straight lines between the days. A value exists only for each day. A smooth curve would show values
              // between the days that do not exist.
              type="linear"
              dataKey="highAverage"
              name={SERIES.high.label}
              stroke={SERIES.high.color}
              strokeWidth={2}
              dot={false}
              // The point under the pointer has a ring in the surface color, so it stays clear on the line.
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="lowAverage"
              name={SERIES.low.label}
              stroke={SERIES.low.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </figure>

      <figure className="chart">
        {/* One series, so the title names it and there is no legend. */}
        <figcaption>
          <span className="chart-title">Daily volume</span>
        </figcaption>
        <ResponsiveContainer width="100%" height={VOLUME_CHART_HEIGHT}>
          <BarChart data={data} syncId={SYNC_ID} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="day"
              tickFormatter={formatShortDay}
              tick={AXIS_TICK}
              axisLine={{ stroke: 'var(--axis)' }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={formatCompact}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              content={({ active, label }) => (
                <ChartTooltip
                  summary={active && typeof label === 'string' ? byDay.get(label) : undefined}
                  rows={(summary) => [{ ...SERIES.volume, value: formatVolume(summary.volume) }]}
                />
              )}
            />
            <Bar
              dataKey="volume"
              name={SERIES.volume.label}
              fill={SERIES.volume.color}
              // Thin bars with a round top and a square base. The space between bars separates them.
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}

/** One legend entry: a short colored line as the key, and the name in the text color. */
function LegendItem({ label, color }: { label: string; color: string }) {
  return (
    <li className="legend-item">
      <span className="legend-key" style={{ background: color }} aria-hidden="true" />
      {label}
    </li>
  );
}

interface TooltipRow {
  readonly label: string;
  readonly color: string;
  readonly value: string;
}

/** The tooltip of one day: the date, then one row for each series with a colored key. */
function ChartTooltip({
  summary,
  rows,
}: {
  summary: DailySummary | undefined;
  rows: (summary: DailySummary) => TooltipRow[];
}): ReactNode {
  if (summary === undefined) {
    return null;
  }
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-day">{summary.day}</p>
      <dl>
        {rows(summary).map((row) => (
          <div key={row.label} className="chart-tooltip-row">
            <dt>
              <span className="legend-key" style={{ background: row.color }} aria-hidden="true" />
              {row.label}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
