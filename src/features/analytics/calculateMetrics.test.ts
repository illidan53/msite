import { describe, expect, it } from "vitest";
import type { PriceBar } from "../../../shared/types";
import { calculateMetrics, completedBars } from "./calculateMetrics";

const now = new Date("2026-09-20T16:00:00Z");
function series(): PriceBar[] {
  const bars: PriceBar[] = [];
  const day = new Date("2026-01-01T05:00:00Z");
  while (bars.length < 70) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const close = 100 + bars.length;
      bars.push({
        timestamp: day.toISOString(),
        open: close,
        high: close + 2,
        low: close - 2,
        close,
        volume: bars.length >= 65 ? 200 : 100,
      });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return bars;
}
describe("ETF activity metrics", () => {
  it("calculates session-based returns and nonoverlapping volume windows", () => {
    const bars = series();
    const spy = bars.map((b) => ({ ...b, close: 100 }));
    const m = calculateMetrics(bars, spy, now);
    expect(m.return5).toBeCloseTo((169 / 164 - 1) * 100);
    expect(m.return20).toBeCloseTo((169 / 149 - 1) * 100);
    expect(m.return60).toBeCloseTo((169 / 109 - 1) * 100);
    expect(m.relative20).toBeCloseTo(m.return20!);
    expect(m.rvol).toBe(2);
    expect(m.cmf).toBe(0);
  });
  it("sorts, deduplicates and excludes the current New York day", () => {
    const bars = series();
    const today = { ...bars[0], timestamp: "2026-09-20T04:00:00Z", close: 999 };
    expect(
      completedBars([today, ...bars.slice().reverse(), bars[0]], now),
    ).toEqual(bars);
    // Before New York midnight the same UTC date still belongs to the preceding local day.
    expect(
      completedBars(
        [{ ...today, timestamp: "2026-09-19T04:00:00Z" }],
        new Date("2026-09-20T01:00:00Z"),
      ),
    ).toEqual([]);
  });
  it("does not bridge a missing session or manufacture a zero for insufficient history", () => {
    const bars = series();
    const gap = bars.filter((_, i) => i !== 60);
    const m = calculateMetrics(gap, bars, now);
    expect(m.return20).toBeNull();
    expect(m.relative20).toBeNull();
    expect(m.cmf).toBeNull();
    expect(m.rvol).toBeNull();
    expect(calculateMetrics(bars.slice(-20), bars, now).return20).toBeNull();
  });
  it("handles zero volume, flat bars and invalid prices", () => {
    const bars = series();
    const zero = bars.map((bar) => ({ ...bar, volume: 0 }));
    expect(calculateMetrics(zero, bars, now).rvol).toBeNull();
    expect(calculateMetrics(zero, bars, now).cmf).toBeNull();
    const flat = bars.map((bar) => ({
      ...bar,
      high: bar.close,
      low: bar.close,
    }));
    expect(calculateMetrics(flat, bars, now).cmf).toBe(0);
    const invalid = [...bars.slice(0, -1), { ...bars.at(-1)!, close: 0 }];
    expect(calculateMetrics(invalid, bars, now).return20).toBeNull();
    expect(calculateMetrics(invalid, bars, now).cmf).toBeNull();
  });
  it("requires matching dates for relative strength and keeps older as-of dates explicit", () => {
    const bars = series();
    expect(calculateMetrics(bars, [], now).relative20).toBeNull();
    const old = bars.slice(0, -1);
    const m = calculateMetrics(old, bars, now);
    expect(m.asOf).toBe(old.at(-1)!.timestamp.slice(0, 10));
    expect(m.relative20).toBe(0);
  });
});
