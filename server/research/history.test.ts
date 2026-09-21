import { describe, it, expect } from "vitest";
import type { PriceBar } from "../../shared/types";
import { calculateMetricHistory } from "./history";
import { calculateResearch } from "./quant";
import { newYorkDate } from "../../shared/marketDate";
function bars(n: number, scale = 1): PriceBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = scale * (100 + i / 2 + 10 * Math.sin(i / 8));
    return {
      timestamp: new Date(Date.UTC(2020, 0, i + 1, 21)).toISOString(),
      open: close,
      close,
      high: close + 2,
      low: close - 2,
      volume: 100 + i,
    };
  });
}
describe("as-of metric history", () => {
  it("keeps the final point identical to every report metric and retains warm-up history", async () => {
    const asset = bars(330),
      benchmark = bars(330, 2);
    const history = await calculateMetricHistory(asset, benchmark);
    expect(history.dates).toHaveLength(252);
    expect(history.dataStart).toBe(newYorkDate(asset[0].timestamp));
    for (const metric of calculateResearch(asset, benchmark).metrics) {
      expect(history.values[metric.id]).toHaveLength(252);
      expect(history.values[metric.id].at(-1)).toEqual(metric.value);
    }
    // A 200-day average is valid even at the start of a shorter display slice.
    expect(history.values.sma200.slice(-21).every((v) => v !== null)).toBe(
      true,
    );
  });
  it("adding extreme future asset and benchmark prices never changes prior observations", async () => {
    const asset = bars(330),
      benchmark = bars(330, 2);
    const earlier = await calculateMetricHistory(
      asset.slice(0, 300),
      benchmark.slice(0, 300),
    );
    for (let i = 300; i < 330; i++) {
      asset[i] = {
        ...asset[i],
        close: 100000,
        high: 100001,
        low: 99999,
        volume: 999999,
      };
      benchmark[i] = { ...benchmark[i], close: 0.1, high: 1, low: 0.01 };
    }
    const later = await calculateMetricHistory(asset, benchmark);
    for (const [index, date] of earlier.dates.entries()) {
      const j = later.dates.indexOf(date);
      if (j < 0) continue;
      for (const id of Object.keys(earlier.values))
        expect(later.values[id][j], `${id} at ${date}`).toEqual(
          earlier.values[id][index],
        );
    }
  });
  it("uses historical mean, peak, volume and matching benchmark endpoints", async () => {
    const asset = bars(310),
      benchmark = bars(310, 2);
    asset[299].volume = 1000;
    const history = await calculateMetricHistory(asset, benchmark);
    const index = history.dates.indexOf(newYorkDate(asset[299].timestamp)!);
    const close = asset[299].close;
    const sma = asset.slice(280, 300).reduce((s, b) => s + b.close, 0) / 20;
    expect(history.values.distance20[index]).toBeCloseTo(
      (close / sma - 1) * 100,
    );
    expect(history.values.drawdown[index]).toBeCloseTo(
      (close / Math.max(...asset.slice(0, 300).map((b) => b.close)) - 1) * 100,
    );
    expect(history.values.rvol[index]).toBeCloseTo(
      1000 / (asset.slice(279, 299).reduce((s, b) => s + b.volume, 0) / 20),
    );
    const expectedExcess =
      (close / asset[47].close - benchmark[299].close / benchmark[47].close) *
      100;
    expect(history.values.excess[index]).toBeCloseTo(expectedExcess);
  });
  it("leaves warm-up, missing benchmark and undefined denominator values null", async () => {
    const data = bars(50).map((b) => ({
      ...b,
      close: 100,
      high: 101,
      low: 99,
      open: 100,
    }));
    const history = await calculateMetricHistory(data, []);
    expect(history.values.sma20.slice(0, 19)).toEqual(Array(19).fill(null));
    expect(history.values.sma20[19]).toBe(100);
    for (const id of ["return252", "sharpe", "beta", "excess", "bbPosition"])
      expect(history.values[id].every((v) => v === null)).toBe(true);
    expect(history.values.rsi.at(-1)).toBe(50);
  });
});
