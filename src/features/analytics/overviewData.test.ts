import { describe, expect, it } from "vitest";
import type { PriceSeries } from "../../../shared/types";
import { buildOverview, linePath } from "./overviewData";
import { calculateMetrics } from "./calculateMetrics";

const now = new Date("2026-09-20T12:00:00Z");
function history(symbol: string): PriceSeries {
  const bars: PriceSeries["bars"] = [];
  const day = new Date("2025-01-01T00:00:00Z");
  while (bars.length < 150) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const i = bars.length;
      const close = symbol === "SPY" ? 100 + i * 0.1 : 100 + i;
      bars.push({
        timestamp: day.toISOString(),
        open: close,
        high: close + 1,
        low: close - 3,
        close,
        volume: i >= 145 ? 200 : 100,
      });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { symbol, range: "1y", bars };
}

describe("rotation history", () => {
  it("uses the same start date, rolling formulas and five-session sampling", () => {
    const records = { SPY: history("SPY"), SOXX: history("SOXX") };
    const data = buildOverview(records, 60, now);
    expect(data.dates).toHaveLength(61);
    expect(data.sampleIndices).toEqual([
      5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
    expect(data.series.SOXX[0].priceChange).toBe(0);
    expect(data.series.SOXX.at(-1)?.priceChange).toBeCloseTo(
      (249 / 189 - 1) * 100,
    );
    expect(data.series.SOXX.at(-1)?.metrics).toEqual(
      calculateMetrics(records.SOXX.bars, records.SPY.bars, now),
    );
    expect(data.series.SOXX.at(-1)?.metrics?.rvol).toBe(2);
    expect(data.series.SOXX.at(-1)?.metrics?.cmf).toBe(0.5);
    expect(data.series.SPY.at(-1)?.metrics?.relative20).toBe(0);
    expect(buildOverview(records, 120, now).dates).toHaveLength(121);
  });

  it("calculates historical snapshots without future observations", () => {
    const spy = history("SPY"),
      soxx = history("SOXX");
    const before = buildOverview({ SPY: spy, SOXX: soxx }, 60, now);
    const mutated = {
      ...soxx,
      bars: soxx.bars.map((bar, i) =>
        i > 120 ? { ...bar, close: 9999, volume: 99999 } : bar,
      ),
    };
    const after = buildOverview({ SPY: spy, SOXX: mutated }, 60, now);
    expect(after.series.SOXX.slice(0, 32)).toEqual(
      before.series.SOXX.slice(0, 32),
    );
    expect(after.series.SOXX.at(-1)).not.toEqual(before.series.SOXX.at(-1));
  });

  it("leaves gaps and stale dates blank instead of carrying values forward", () => {
    const spy = history("SPY"),
      soxx = history("SOXX");
    soxx.bars = soxx.bars.filter((_, i) => i !== 135 && i < 149);
    const data = buildOverview({ SPY: spy, SOXX: soxx }, 60, now);
    expect(data.series.SOXX[46].metrics).toBeNull();
    expect(data.series.SOXX[46].priceChange).toBeNull();
    expect(data.series.SOXX[47].metrics?.relative20).toBeNull();
    expect(data.series.SOXX.at(-1)?.metrics).toBeNull();
    expect(data.series.SOXX.at(-1)?.priceChange).toBeNull();
    expect(data.asOf.SOXX).toBe(soxx.bars.at(-1)?.timestamp.slice(0, 10));
    expect(data.series.IGV.every((point) => point.metrics === null)).toBe(true);
    expect(
      linePath(
        [0, 2, null, 3],
        (x) => x,
        (y) => y,
      ),
    ).toBe("M0.00,0.00 L1.00,2.00  M3.00,3.00");
  });

  it("does not change the rebasing date to hide a missing initial price", () => {
    const spy = history("SPY"),
      soxx = history("SOXX");
    soxx.bars = soxx.bars.filter((_, i) => i !== 89);
    const data = buildOverview({ SPY: spy, SOXX: soxx }, 60, now);
    expect(data.series.SOXX.every((point) => point.priceChange === null)).toBe(
      true,
    );
    expect(data.series.SOXX.at(-1)?.metrics?.return20).not.toBeNull();
  });

  it("requires a shared benchmark calendar and excludes the current NY date", () => {
    expect(buildOverview({ SOXX: history("SOXX") }, 60, now).dates).toEqual([]);
    const spy = history("SPY");
    const latest = spy.bars.at(-1)!;
    spy.bars.push({ ...latest, timestamp: "2026-09-20T00:00:00Z" });
    expect(buildOverview({ SPY: spy }, 60, now).dates.at(-1)).toBe(
      latest.timestamp.slice(0, 10),
    );
  });
});
