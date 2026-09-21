import { describe, it, expect } from "vitest";
import { calculateResearch, closedBars } from "./quant";
import type { PriceBar } from "../../shared/types";
function bars(values: number[]): PriceBar[] {
  return values.map((close, i) => ({
    timestamp: new Date(Date.UTC(2020, 0, i + 1, 21)).toISOString(),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}
const metric = (values: number[], id: string) =>
  calculateResearch(bars(values), bars(values)).metrics.find(
    (m) => m.id === id,
  )!.value;
describe("research financial calculations", () => {
  it("computes drawdown and ongoing underwater periods from peaks", () => {
    expect(metric([100, 120, 90, 108], "maxDrawdown")).toBe(-25);
    expect(metric([100, 120, 90, 108], "drawdown")).toBeCloseTo(-10);
    expect(metric([100, 120, 90, 108], "underwater")).toBe(2);
    expect(metric([100, 120, 90, 125], "underwater")).toBe(0);
  });
  it("does not invent annual metrics with insufficient observations", () => {
    for (const id of [
      "return252",
      "sharpe",
      "sortino",
      "calmar",
      "vol252",
      "beta",
      "sma200",
    ])
      expect(metric([100, 110], id)).toBeNull();
  });
  it("returns undefined ratios on flat prices and neutral RSI", () => {
    const values = Array(300).fill(100);
    for (const id of [
      "sharpe",
      "sortino",
      "calmar",
      "beta",
      "correlation",
      "bbPosition",
    ])
      expect(metric(values, id)).toBeNull();
    expect(metric(values, "rsi")).toBe(50);
    expect(metric(values, "maxDrawdown")).toBe(0);
  });
  it("aligns benchmark dates and recovers beta, alpha and correlation", () => {
    const values = Array.from(
      { length: 300 },
      (_, i) => 100 + i * 0.1 + Math.sin(i) * 2,
    );
    expect(metric(values, "beta")).toBeCloseTo(1);
    expect(metric(values, "alpha")).toBeCloseTo(0);
    expect(metric(values, "correlation")).toBeCloseTo(1);
    expect(metric(values, "excess")).toBe(0);
    const unmatched = bars(values).map((b) => ({
      ...b,
      timestamp: b.timestamp.replace("2020", "2019"),
    }));
    expect(
      calculateResearch(bars(values), unmatched).metrics.find(
        (m) => m.id === "beta",
      )!.value,
    ).toBeNull();
  });
  it("uses Wilder RSI and ATR and prior-session volume baseline", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(metric(values, "rsi")).toBe(100);
    expect(metric(values, "atr")).toBeCloseTo((2 / 129) * 100);
    const data = bars(values);
    data.at(-1)!.volume = 300;
    expect(
      calculateResearch(data, []).metrics.find((m) => m.id === "rvol")!.value,
    ).toBe(3);
  });
  it("filters current sessions, malformed data and duplicates then sorts", () => {
    const data = bars([100, 101, 102]);
    expect(
      closedBars(
        [
          data[1],
          data[0],
          data[0],
          data[2],
          { ...data[0], timestamp: "bad" },
          { ...data[0], close: -1 },
        ],
        new Date("2020-01-03T23:00:00Z"),
      ),
    ).toEqual([data[0], data[1]]);
  });
});
