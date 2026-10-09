import { describe, expect, it } from "vitest";
import { buildPanel } from "./calendar";
import { syntheticBars, testBook, testConfig, weekdays } from "./engineTestUtils";
import { createLedger, replayPaper } from "./paper";
import { buildPortfolio } from "./portfolio";
import { simulate } from "./simulate";
import { computeSystem } from "./system";

/**
 * Forward paper trading must follow exactly the backtest's rules: replaying a
 * ledger over the same sessions reproduces simulate()'s holdings and equity.
 */
describe("paper trading and backtest parity", () => {
  const dates = weekdays("2024-01-02", 420);
  const symbols = ["SPY", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2"];
  const bars = Object.fromEntries(
    symbols.map((symbol, k) => [
      symbol,
      syntheticBars(dates, {
        seed: k + 3,
        drift: (t) => 0.0008 * Math.sin(t / (30 + 7 * k)),
        vol: 0.2 + 0.05 * (k % 3),
        volume: 2e6 + k * 3e5,
        price: 40 + 9 * k,
        ...(symbol === "C2" && { start: 30 }),
      }),
    ]),
  );
  const panel = buildPanel(bars, "SPY");
  const book = testBook({
    alpha: ["A1", "A2", "A3"],
    beta: ["B1", "B2", "B3"],
    gamma: ["C1", "C2"],
  });
  const system = computeSystem(panel, book, testConfig);
  const frame = buildPortfolio(system, testConfig);
  const start = 330;

  it("replays the same fills, holdings and equity as the simulator", () => {
    const sim = simulate(frame, testConfig, { capital: book.capital, startIndex: start });
    const ledger = createLedger(book.id, book.capital, dates[start], "parity");
    ledger.lastSession = panel.dates[start - 1];
    const replay = replayPaper({
      ledger,
      frame,
      config: testConfig,
      drivers: () => [],
    });
    const fills = replay.ledger.fills.length;
    expect(fills).toBeGreaterThan(20);
    expect(fills).toBe(sim.trades.reduce((a, b) => a + b, 0));
    for (const [symbol, shares] of Object.entries(sim.holdings.shares))
      expect(replay.ledger.positions[symbol]?.shares).toBeCloseTo(shares, 8);
    expect(Object.keys(replay.ledger.positions).sort()).toEqual(
      Object.keys(sim.holdings.shares).sort(),
    );
    expect(replay.ledger.cash).toBeCloseTo(sim.holdings.cash, 6);
    const equity = replay.ledger.equity;
    expect(equity).toHaveLength(panel.dates.length - start);
    equity.forEach((point, k) => expect(point.value).toBeCloseTo(sim.equity[start + k], 6));
    // Orders decided at the last close are the live signals in both.
    expect(replay.signals.map((s) => [s.symbol, s.shares])).toEqual(
      sim.pending.map((o) => [o.symbol, o.shares]),
    );
  });
});
