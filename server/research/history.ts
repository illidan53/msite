import { setImmediate } from "node:timers/promises";
import type { PriceBar } from "../../shared/types";
import type { ResearchMetricHistory } from "../../shared/research";
import { newYorkDate } from "../../shared/marketDate";
import { calculateResearch } from "./quant";

// Each point uses a prefix of the same input snapshot. Display range never
// truncates the warm-up history or changes an indicator's reference window.
export async function calculateMetricHistory(
  bars: PriceBar[],
  benchmark: PriceBar[],
  basis: ResearchMetricHistory["basis"] = "snapshot",
): Promise<ResearchMetricHistory> {
  const dates = new Map(
    [...bars, ...benchmark].map((b) => [
      b.timestamp,
      newYorkDate(b.timestamp)!,
    ]),
  );
  const dateFor = (value: string | number | Date) =>
    dates.get(String(value)) ?? newYorkDate(value);
  const history: ResearchMetricHistory = {
    dates: [],
    values: {},
    dataStart: bars[0] ? dateFor(bars[0].timestamp)! : "",
    asOf: bars.at(-1) ? dateFor(bars.at(-1)!.timestamp)! : "",
    fetchedAt: new Date().toISOString(),
    basis,
  };
  let benchmarkEnd = 0;
  for (let end = Math.max(0, bars.length - 252); end < bars.length; end++) {
    const date = dateFor(bars[end].timestamp)!;
    while (
      benchmarkEnd < benchmark.length &&
      dateFor(benchmark[benchmarkEnd].timestamp)! <= date
    )
      benchmarkEnd++;
    const result = calculateResearch(
      bars.slice(0, end + 1),
      benchmark.slice(0, benchmarkEnd),
      dateFor,
    );
    history.dates.push(date);
    for (const metric of result.metrics)
      (history.values[metric.id] ??= []).push(metric.value);
    if (end % 16 === 0) await setImmediate();
  }
  return history;
}
