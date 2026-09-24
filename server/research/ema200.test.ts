import { describe, it, expect } from "vitest";
import type { PriceBar } from "../../shared/types";
import {
  ema200,
  association,
  blockInterval,
  calculateEma200Study,
} from "./ema200";
function bars(n: number): PriceBar[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2020, 0, i + 1, 21)).toISOString(),
    open: 110,
    close: 110,
    low: 109,
    high: 111,
    volume: 100,
  }));
}
function touches(n = 270) {
  const data = bars(n);
  for (let i = 0; i < 199; i++)
    data[i] = { ...data[i], open: 100, close: 100, low: 99, high: 101 };
  data[200] = { ...data[200], low: 100, high: 112 };
  return data;
}
describe("EMA200 pullback study", () => {
  it("seeds with SMA200 and applies the exact recursive EMA without future input", () => {
    const series = ema200([...Array(200).fill(100), 120, 80]);
    expect(series.slice(0, 199).every((v) => v === null)).toBe(true);
    expect(series[199]).toBe(100);
    expect(series[200]).toBeCloseTo(100 + (20 * 2) / 201, 12);
    expect(series[201]).toBeCloseTo(
      series[200]! + ((80 - series[200]!) * 2) / 201,
      12,
    );
    expect(ema200([1, 2])).toEqual([null, null]);
  });
  it("detects above-line touch against the prior EMA, uses next open, and debounces 20 sessions", () => {
    const data = touches();
    data[201].open = 105;
    data[205].close = 115;
    data[210].low = 100;
    data[221].low = 100;
    const result = calculateEma200Study(data);
    expect(result.events[0].date).toBe("2020-07-19");
    expect(result.events[0].referenceEma).toBeCloseTo(100.05);
    expect(result.events[0].entryPrice).toBe(105);
    expect(result.events[0].returns["5"]).toBeCloseTo((115 / 105 - 1) * 100);
    expect(result.events.some((e) => e.date === "2020-07-29")).toBe(false);
    expect(result.events[1].date).toBe("2020-08-09");
  });
  it("does not treat a gap entirely below the line, or an approach from below, as a pullback touch", () => {
    const data = touches();
    data[200] = { ...data[200], open: 90, close: 90, high: 95, low: 89 };
    expect(calculateEma200Study(data.slice(0, 201)).events).toHaveLength(0);
    const below = bars(205).map((b) => ({ ...b, close: 100 }));
    below[199].close = 90;
    below[200].low = 99;
    below[200].high = 110;
    expect(calculateEma200Study(below.slice(0, 201)).events).toHaveLength(0);
  });
  it("leaves unfinished outcomes missing and never treats them as losses", () => {
    const result = calculateEma200Study(touches(204));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].returns).toEqual({
      "5": null,
      "10": null,
      "20": null,
    });
    expect(result.horizons[2].events).toBe(0);
    expect(result.horizons[2].positiveRate).toBeNull();
    expect(result.status).toBe("insufficient");
    expect(result.confidenceInterval).toBeNull();
  });
  it("event recognition and matured returns cannot be changed by future prices", () => {
    const original = touches(250);
    const before = calculateEma200Study(original.slice(0, 225));
    for (let i = 225; i < 250; i++)
      original[i] = {
        ...original[i],
        open: 2000,
        close: 2000,
        low: 1900,
        high: 2100,
      };
    const after = calculateEma200Study(original);
    expect(after.events[0]).toEqual(before.events[0]);
  });
  it("returns exact point-biserial limits and undefined constant-series correlation", () => {
    expect(association([2, 2], [0, 0])).toEqual({ lift: 2, correlation: 1 });
    expect(association([0, 0], [2, 2])).toEqual({ lift: -2, correlation: -1 });
    expect(association([1, 3], [1, 3]).correlation).toBe(0);
    expect(association([2, 2], [2, 2]).correlation).toBeNull();
    expect(association([], [2]).lift).toBeNull();
  });
  it("block intervals preserve a deterministic effect, are repeatable, and refuse empty groups", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      i % 22 === 0
        ? { group: 1 as const, value: 4 }
        : { group: 0 as const, value: 1 },
    );
    const a = blockInterval(rows);
    expect(a.interval).toEqual([3, 3]);
    expect(a.samples).toBe(1000);
    expect(blockInterval(rows)).toEqual(a);
    expect(blockInterval(Array(100).fill(null)).interval).toBeNull();
  });
  it("distinguishes positive and negative evidence when enough mature events exist", () => {
    const make = (entryMultiplier: number) => {
      const data = bars(1600).map((b, i) => ({
        ...b,
        open: 100 + i * 0.2,
        close: 100 + i * 0.2,
        low: 100 + i * 0.2 - 0.1,
        high: 100 + i * 0.2 + 0.1,
      }));
      const line = ema200(data.map((b) => b.close));
      for (let i = 300; i < 1550; i += 60) {
        data[i].low = line[i - 1]!;
        data[i + 1].open = data[i + 1].close * entryMultiplier;
        data[i + 1].low = Math.min(data[i + 1].low, data[i + 1].open);
        data[i + 1].high = Math.max(data[i + 1].high, data[i + 1].open);
      }
      return calculateEma200Study(data);
    };
    const positive = make(0.9),
      negative = make(1.1);
    expect(positive.horizons[2].events).toBeGreaterThanOrEqual(12);
    expect(positive.horizons[2].controls).toBeGreaterThanOrEqual(252);
    expect(positive.status).toBe("positive");
    expect(positive.confidenceInterval![0]).toBeGreaterThan(0);
    expect(negative.status).toBe("negative");
    expect(negative.confidenceInterval![1]).toBeLessThan(0);
  });
  it("handles missing EMA warmup, flat prices, zero entry and missing samples honestly", () => {
    expect(calculateEma200Study(bars(199)).ema).toBeNull();
    const flat = calculateEma200Study(bars(500));
    expect(flat.events).toHaveLength(0);
    expect(flat.distance).toBe(0);
    expect(flat.status).toBe("insufficient");
    const data = touches();
    data[201].open = 0;
    expect(calculateEma200Study(data).events[0].returns["20"]).toBeNull();
  });
});
