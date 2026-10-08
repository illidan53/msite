import { describe, expect, it } from "vitest";
import {
  bufferedChange,
  decideOrders,
  equity,
  fillOrders,
  markToMarket,
  oneWayCostBps,
  roundHalfEven,
  roundToLot,
  type Holdings,
} from "./execution";

const options = { lot: 1, buffer: 0.1, minTradeNotional: 0, longShort: false };
const costs = {
  benchmarkBps: 1.5,
  tiers: [
    { minDollarVolume: 500e6, bps: 3 },
    { minDollarVolume: 100e6, bps: 5 },
    { minDollarVolume: 10e6, bps: 10 },
    { minDollarVolume: 0, bps: 30 },
  ],
  secFeeBps: 0.206,
  secFeeFrom: "2026-04-04",
};

describe("rounding", () => {
  it("rounds halves to even like pandas", () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([
      0, 2, 2, 0, -2, 2, 3,
    ]);
  });
  it("rounds to fractional lots without float noise", () => {
    expect(roundToLot(1.23456, 0.0001)).toBe(1.2346);
    expect(roundToLot(0.00004, 0.0001)).toBe(0);
    expect(roundToLot(12.5, 1)).toBe(12);
  });
});

describe("buffered trading (AFTS Strategy 8)", () => {
  // Equity 100k, close 100: average position (weight 0.1) = 100 shares, buffer ±10 shares.
  const input = { symbol: "A", close: 100, target: 0.05, average: 0.1 };
  it("trades only to the nearest band edge", () => {
    expect(bufferedChange(0, input, 100_000, options)).toBe(40);
    expect(bufferedChange(45, input, 100_000, options)).toBe(0);
    expect(bufferedChange(70, input, 100_000, options)).toBe(-10);
  });
  it("exits fully on a zero target or a forced exit", () => {
    expect(bufferedChange(7, { ...input, target: 0 }, 100_000, options)).toBe(-7);
    expect(bufferedChange(50, { ...input, forced: true }, 100_000, options)).toBe(-50);
  });
  it("never enters short when long-only and skips dust", () => {
    expect(bufferedChange(0, { ...input, target: -0.05 }, 100_000, options)).toBe(0);
    expect(
      bufferedChange(0, input, 100_000, { ...options, minTradeNotional: 5000 }),
    ).toBe(0);
  });
  it("allows shorts in the long/short variant", () => {
    expect(
      bufferedChange(0, { ...input, target: -0.05 }, 100_000, {
        ...options,
        longShort: true,
      }),
    ).toBe(-40);
  });
  it("does not decide without a bar", () => {
    expect(bufferedChange(10, { ...input, close: Number.NaN }, 100_000, options)).toBe(0);
  });
  it("collects orders for every symbol that must trade", () => {
    const holdings: Holdings = { cash: 100_000, shares: {}, lastClose: {} };
    expect(
      decideOrders(holdings, 100_000, [input, { ...input, symbol: "B", target: 0 }], options),
    ).toEqual([{ symbol: "A", shares: 40, waited: 0 }]);
  });
});

describe("fills and marks", () => {
  it("fills sells before buys, charges costs and carries orders without a bar once", () => {
    const holdings: Holdings = {
      cash: 1000,
      shares: { A: 10 },
      lastClose: { A: 100 },
    };
    const opens: Record<string, number> = { A: 110, B: 50 };
    const result = fillOrders(
      holdings,
      [
        { symbol: "B", shares: 20, waited: 0 },
        { symbol: "A", shares: -10, waited: 0 },
        { symbol: "C", shares: 5, waited: 0 },
        { symbol: "D", shares: 5, waited: 1 },
      ],
      (s) => opens[s] ?? Number.NaN,
      () => 10,
      { lot: 1, longShort: false },
    );
    expect(result.fills.map((f) => f.symbol)).toEqual(["A", "B"]);
    expect(result.carried).toEqual([{ symbol: "C", shares: 5, waited: 1 }]);
    expect(result.cancelled).toEqual([{ symbol: "D", shares: 5, waited: 1 }]);
    expect(holdings.shares).toEqual({ B: 20 });
    expect(holdings.cash).toBeCloseTo(1000 + 1100 - 1.1 - 1000 - 1, 9);
  });
  it("scales buys down when the cash account cannot pay for them", () => {
    const holdings: Holdings = { cash: 1000, shares: {}, lastClose: {} };
    const result = fillOrders(
      holdings,
      [{ symbol: "A", shares: 20, waited: 0 }],
      () => 100,
      () => 0,
      { lot: 1, longShort: false },
    );
    expect(result.scale).toBeCloseTo(0.5);
    expect(holdings.shares.A).toBe(10);
    expect(holdings.cash).toBe(0);
  });
  it("marks held symbols and keeps the last close on days without a bar", () => {
    const holdings: Holdings = { cash: 10, shares: { A: 2, B: 1 }, lastClose: { A: 5, B: 7 } };
    expect(markToMarket(holdings, (s) => (s === "A" ? 6 : Number.NaN))).toBe(10 + 12 + 7);
    expect(equity(holdings)).toBe(29);
  });
});

describe("costs", () => {
  it("uses liquidity tiers, the benchmark rate and the SEC fee on sells", () => {
    expect(oneWayCostBps(costs, 2e9, "buy", "2025-01-02")).toBe(3);
    expect(oneWayCostBps(costs, 50e6, "buy", "2025-01-02")).toBe(10);
    expect(oneWayCostBps(costs, Number.NaN, "buy", "2025-01-02")).toBe(30);
    expect(oneWayCostBps(costs, 2e9, "sell", "2026-04-04")).toBeCloseTo(3.206);
    expect(oneWayCostBps(costs, 0, "buy", "2026-05-01", true)).toBe(1.5);
  });
});
