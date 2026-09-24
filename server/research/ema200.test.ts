import { describe, it, expect } from "vitest";
import type { PriceBar } from "../../shared/types";
import {
  ema200,
  forwardPath,
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
  it("includes a gap below the line but rejects an approach from below", () => {
    const data = touches();
    data[200] = { ...data[200], open: 90, close: 90, high: 95, low: 89 };
    expect(calculateEma200Study(data.slice(0, 201)).events).toHaveLength(1);
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
  it("widens the primary band to 3% and reports separate 1/3/5% samples", () => {
    const data = touches(221);
    data[200].low = 102;
    const result = calculateEma200Study(data);
    expect(result.version).toBe(2);
    expect(result.bandPercent).toBe(3);
    expect(result.events).toHaveLength(1);
    expect(result.sensitivity.map((s) => s.horizon.events)).toEqual([0, 1, 1]);
    expect(result.sensitivity[1].horizon).toEqual(result.horizons[2]);
  });
  it("distinguishes endpoint from mean floating return and includes the complete path", () => {
    const data = touches(221);
    for (let i = 201; i <= 220; i++)
      data[i] = {
        ...data[i],
        open: 100,
        close: i <= 210 ? 110 : 90,
        high: 112,
        low: 88,
      };
    const result = calculateEma200Study(data);
    const p = result.events[0].paths["20"]!;
    expect(p.endReturn).toBeCloseTo(-10);
    expect(p.averageReturn).toBeCloseTo(0);
    expect(p.maxGain).toBeCloseTo(12);
    expect(p.maxLoss).toBeCloseTo(-12);
    expect(p.hitDay).toBe(1);
    expect(result.horizons[2].hitRate).toBe(100);
    expect(result.horizons[2].medianHitDay).toBe(1);
    expect(result.events[0].outcome).toBe("weak");
    expect(result.events).toHaveLength(1);
  });
  it("does not count incomplete high-hit windows as successes", () => {
    const data = touches(204);
    data[201] = { ...data[201], open: 100, high: 150 };
    const result = calculateEma200Study(data);
    expect(result.events[0].paths["5"]).toBeNull();
    expect(result.horizons[0].hitRate).toBeNull();
    expect(result.events[0].outcome).toBe("pending");
  });
  it("keeps a prolonged decline in one episode until recovery and cooldown both finish", () => {
    const data = touches(270);
    for (let i = 201; i < 246; i++)
      data[i] = { ...data[i], open: 90, close: 90, low: 88, high: 91 };
    for (let i = 246; i <= 248; i++)
      data[i] = { ...data[i], open: 110, close: 110, low: 109, high: 111 };
    data[249].low = 90;
    const result = calculateEma200Study(data);
    expect(result.events).toHaveLength(2);
    expect(result.events[1].date).toBe(data[249].timestamp.slice(0, 10));
    expect(result.events[0].outcome).toBe("weak");
    expect(result.events[0].returns["20"]).toBeCloseTo(0);
  });
  it("waits three sessions after a new low and starts confirmed returns at the next open", () => {
    const data = touches(230);
    data[201].low = 95;
    data[202].low = 94;
    data[203].low = 96;
    data[204].low = 95;
    data[205].low = 95;
    data[206].open = 107;
    data[225].close = 117;
    const before = calculateEma200Study(data.slice(0, 205));
    expect(before.events[0].confirmation).toBeNull();
    const confirmed = calculateEma200Study(data.slice(0, 206)).events[0]
      .confirmation!;
    expect(confirmed.date).toBe(data[205].timestamp.slice(0, 10));
    expect(confirmed.low).toBe(94);
    expect(confirmed.entryPrice).toBeNull();
    const result = calculateEma200Study(data);
    const c = result.events[0].confirmation!;
    expect(c.entryDate).toBe(data[206].timestamp.slice(0, 10));
    expect(c.entryPrice).toBe(107);
    expect(c.paths["20"]!.endReturn).toBeCloseTo((117 / 107 - 1) * 100);
    expect(result.confirmed[2].path.count).toBe(1);
    expect(result.confirmed[2].meanReturn).toBe(c.paths["20"]!.endReturn);
  });
  it("retains failed undercuts, labels reclaims only after maturity, and records near-line cases", () => {
    const reclaimed = calculateEma200Study(touches(221));
    expect(reclaimed.events[0].outcome).toBe("reclaimed");
    const near = touches(221);
    near[200].low = 102;
    expect(calculateEma200Study(near).events[0].outcome).toBe("near");
    const mixed = touches(221);
    for (let i = 200; i <= 220; i++)
      mixed[i] = { ...mixed[i], open: 99, close: 99, low: 98, high: 100 };
    expect(calculateEma200Study(mixed).events[0].outcome).toBe("mixed");
  });
  it("uses entry-relative excursions and hit-only time without inventing gains on losing paths", () => {
    const data = bars(6);
    data[1].open = 110;
    for (let i = 1; i < 6; i++)
      data[i] = { ...data[i], close: 105, high: 110, low: 100 };
    const p = forwardPath(data, 0, 5)!;
    expect(p.maxGain).toBe(0);
    expect(p.maxLoss).toBeCloseTo((100 / 110 - 1) * 100);
    expect(p.hitDay).toBeNull();
    data[1].open = 0;
    expect(forwardPath(data, 0, 5)).toBeNull();
  });
});
