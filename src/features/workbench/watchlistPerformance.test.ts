import { describe, expect, it } from "vitest";
import type { MarketSnapshot, Watchlist } from "../../../shared/types";
import { watchlistPerformances } from "./watchlistPerformance";
const watchlists: Watchlist[] = [
  {
    id: "test",
    name: "Test",
    pinnedSymbols: [],
    rows: [
      {
        id: "r",
        name: "r",
        expandedByDefault: true,
        symbols: ["a", "B", "A", "C"],
      },
    ],
  },
];
function quote(
  symbol: string,
  value: number | null,
  sessionDate = "2026-09-18",
): MarketSnapshot {
  return {
    symbol,
    price: 100,
    change: null,
    changePercent: value,
    sessionChange: null,
    sessionChangePercent: value,
    sessionDate,
    volume: 1,
    updatedAt: null,
    timeframe: "PREVIOUS_CLOSE",
  };
}
describe("watchlist daily performance", () => {
  it("deduplicates symbols and gives each stock equal weight", () => {
    const result = watchlistPerformances(watchlists, {
      A: quote("A", 3),
      B: quote("B", -1),
      C: quote("C", 1),
    }).test;
    expect(result).toEqual({
      changePercent: 1,
      sessionDate: "2026-09-18",
      covered: 3,
      total: 3,
    });
  });
  it("excludes missing, nonfinite and older-session values rather than counting zero", () => {
    expect(
      watchlistPerformances(watchlists, {
        A: quote("A", 3),
        B: quote("B", -99, "2026-09-17"),
        C: quote("C", NaN),
      }).test,
    ).toEqual({
      changePercent: 3,
      sessionDate: "2026-09-18",
      covered: 1,
      total: 3,
    });
    expect(watchlistPerformances(watchlists, {}).test.changePercent).toBeNull();
    expect(
      watchlistPerformances(watchlists, { A: quote("A", 0) }).test
        .changePercent,
    ).toBe(0);
  });
  it("uses a shared latest session across lists and does not invent fallback dates", () => {
    const other = {
      ...watchlists[0],
      id: "other",
      rows: [{ ...watchlists[0].rows[0], symbols: ["D"] }],
    };
    const results = watchlistPerformances([...watchlists, other], {
      A: quote("A", -2, "2026-09-17"),
      D: quote("D", 1),
    });
    expect(results.test.changePercent).toBeNull();
    expect(results.other.changePercent).toBe(1);
    expect(
      watchlistPerformances(watchlists, {
        A: { ...quote("A", 5), sessionDate: null },
      }).test.changePercent,
    ).toBeNull();
  });
  it("uses the New York date for timestamped quotes and prefers session change", () => {
    const a = {
      ...quote("A", 99),
      sessionDate: undefined,
      timeframe: "DELAYED" as const,
      updatedAt: "2026-09-19T00:30:00Z",
      sessionChangePercent: -0.004,
    };
    const result = watchlistPerformances(watchlists, { A: a }).test;
    expect(result.sessionDate).toBe("2026-09-18");
    expect(result.changePercent).toEqual(-0);
  });
});
