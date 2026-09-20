import type { PriceSeries } from "../../../shared/types";
import {
  calculateCompletedMetrics,
  completedBars,
  type ActivityMetrics,
} from "./calculateMetrics";
import { etfs } from "./catalog";

export type OverviewMetric = Exclude<keyof ActivityMetrics, "asOf">;
export interface OverviewPoint {
  date: string;
  metrics: ActivityMetrics | null;
  priceChange: number | null;
}
export interface OverviewData {
  dates: string[];
  sampleIndices: number[];
  series: Record<string, OverviewPoint[]>;
  asOf: Record<string, string | null>;
}

export function buildOverview(
  records: Record<string, PriceSeries>,
  sessions: number,
  now = new Date(),
): OverviewData {
  const benchmark = completedBars(records.SPY?.bars ?? [], now);
  const dates = benchmark
    .slice(-(sessions + 1))
    .map((bar) => bar.timestamp.slice(0, 10));
  const offset = benchmark.length - dates.length;
  const sampleIndices: number[] = [];
  // Samples end on the shared latest date, spaced five trading sessions apart.
  for (let i = dates.length - 1; i > 0; i -= 5) sampleIndices.unshift(i);
  const series: OverviewData["series"] = {};
  const asOf: OverviewData["asOf"] = {};
  for (const { symbol } of etfs) {
    const bars = completedBars(records[symbol]?.bars ?? [], now);
    const byDate = new Map(
      bars.map((bar, i) => [bar.timestamp.slice(0, 10), i]),
    );
    asOf[symbol] = bars.at(-1)?.timestamp.slice(0, 10) ?? null;
    const startIndex = byDate.get(dates[0]);
    const base = startIndex === undefined ? null : bars[startIndex].close;
    series[symbol] = dates.map((date, i) => {
      const index = byDate.get(date);
      // A stale ETF must never be carried forward onto a newer benchmark date.
      if (index === undefined)
        return { date, metrics: null, priceChange: null };
      const close = bars[index].close;
      return {
        date,
        metrics: calculateCompletedMetrics(
          bars.slice(Math.max(0, index - 60), index + 1),
          benchmark.slice(Math.max(0, offset + i - 60), offset + i + 1),
        ),
        priceChange:
          base !== null &&
          base > 0 &&
          Number.isFinite(base) &&
          close > 0 &&
          Number.isFinite(close)
            ? (close / base - 1) * 100
            : null,
      };
    });
  }
  return { dates, sampleIndices, series, asOf };
}

export function linePath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (value: number) => number,
) {
  let connected = false;
  return values
    .map((value, i) => {
      if (value === null || !Number.isFinite(value)) {
        connected = false;
        return "";
      }
      const segment = `${connected ? "L" : "M"}${x(i).toFixed(2)},${y(value).toFixed(2)}`;
      connected = true;
      return segment;
    })
    .join(" ");
}

export type ComparisonMetric = "priceChange" | "relative20" | "rvol" | "cmf";

export function comparisonValue(
  point: OverviewPoint | undefined,
  metric: ComparisonMetric,
): number | null {
  return (
    (metric === "priceChange"
      ? point?.priceChange
      : point?.metrics?.[metric]) ?? null
  );
}

export function comparisonScale(values: number[], metric: ComparisonMetric) {
  if (metric === "cmf") return { min: -1, max: 1, reference: 0 };
  const finite = values.filter(Number.isFinite);
  if (metric === "rvol")
    return {
      min: 0,
      max: Math.max(2, ...finite.map((value) => value * 1.1)),
      reference: 1,
    };
  const lower = Math.min(0, ...finite),
    upper = Math.max(0, ...finite);
  const padding = Math.max(1, (upper - lower) * 0.1);
  return { min: lower - padding, max: upper + padding, reference: 0 };
}
