import { describe, expect, it } from "vitest";
import { equity } from "./execution";
import { buildPortfolio } from "./portfolio";
import { simulate, simulateBuyHold, simulateEqualWeight } from "./simulate";
import { systemFromPanel, testBook, testConfig, testPanel, testSystem } from "./testFrames";

const config = testConfig();
const capital = 100_000;

/** One stock (AAA) whose close is 100 + t and whose open is the previous close. */
function single(sessions = 12, start?: string) {
  const book = testBook([{ id: "a", rows: [["AAA"]] }]);
  const panel = testPanel({
    symbols: ["AAA"],
    sessions,
    start,
    close: (s, t) => (s === "SPY" ? 400 + 2 * t : 100 + t),
  });
  return { book, panel, system: systemFromPanel(panel, book, config, { sigma: 0.2 }) };
}

describe("simulate", () => {
  it("decides at the close and fills at the next open with tier costs", () => {
    const { panel, system } = single();
    panel.open[1][4] = 105; // gap up into the first fill
    const frame = buildPortfolio(system, config);
    // Target capped at maxPositionWeight; the buffer uses the uncapped average weight IDM·w·τ/σ = 1.
    expect(frame.targetWeight[0][3]).toBeCloseTo(0.25, 12);
    expect(frame.averageWeight[0][3]).toBeCloseTo(1, 12);
    const sim = simulate(frame, config, { capital, startIndex: 3, lot: 1 });
    expect(Array.from(sim.equity.slice(0, 4))).toEqual([capital, capital, capital, capital]);
    expect(sim.returns[3]).toBe(0);
    // Close 103: target 242.7 shares, band ±97.1, so buy to the lower edge: 146.
    const cost = (146 * 105 * 3) / 1e4;
    expect(sim.traded[4]).toBe(146 * 105);
    expect(sim.cost[4]).toBeCloseTo(cost, 12);
    const marked = capital - 146 * 105 - cost + 146 * 104;
    expect(sim.equity[4]).toBeCloseTo(marked, 9);
    expect(sim.returns[4]).toBeCloseTo(marked / capital - 1, 12);
    expect(sim.gross[4]).toBeCloseTo((146 * 104) / marked, 12);
    // Inside the band afterwards: no more trades.
    expect(sim.trades[0]).toBe(1);
    expect(sim.holdings.shares).toEqual({ AAA: 146 });
  });

  it("conserves cash plus value and attributes all P&L", () => {
    const system = testSystem({
      sessions: 500,
      sigma: (i, t) => 0.2 + 0.05 * Math.sin(t / 30 + i),
      forecast: (i, t) => 12 * Math.sin(t / 20 + i),
      eligibleFrom: { BBB: 100 },
    });
    const frame = buildPortfolio(system, config);
    for (const options of [{}, { lot: 1 }, { longShort: true }]) {
      const sim = simulate(
        options.longShort ? buildPortfolio(system, config, { longShort: true }) : frame,
        config,
        { capital, startIndex: 50, ...options },
      );
      const end = sim.equity[499];
      expect(end).toBeCloseTo(equity(sim.holdings), 6);
      let growth = 1;
      for (let t = 50; t < 500; t++) growth *= 1 + sim.returns[t];
      expect(growth * capital).toBeCloseTo(end, 6);
      const pnl = sim.contribution.reduce((s, v) => s + v, 0) * capital;
      expect(pnl).toBeCloseTo(end - capital, 6);
      const costs = sim.cost.reduce((s, v) => s + v, 0);
      expect(costs).toBeGreaterThan(0);
      if (options.lot === 1)
        for (const shares of Object.values(sim.holdings.shares))
          expect(Number.isInteger(shares)).toBe(true);
      if (options.longShort)
        expect(Object.values(sim.holdings.shares).some((s) => s < 0)).toBe(true);
      else expect(Object.values(sim.holdings.shares).every((s) => s > 0)).toBe(true);
    }
  });

  it("forces ineligible symbols out at the next open", () => {
    const { system } = single(30);
    const frame = buildPortfolio(system, config);
    system.eligible[0].fill(0, 20); // a stale or illiquid symbol keeps its target in this frame
    const sim = simulate(frame, config, { capital, startIndex: 5 });
    expect(sim.trades[0]).toBe(2);
    expect(sim.traded[21]).toBeGreaterThan(0);
    expect(sim.holdings.shares).toEqual({});
    expect(sim.gross[21]).toBe(0);
  });

  it("charges the SEC fee on sells from its effective date", () => {
    const { system } = single(30, "2026-03-23");
    const frame = buildPortfolio(system, config);
    system.eligible[0].fill(0, 20);
    const sim = simulate(frame, config, { capital, startIndex: 5 });
    const sell = system.dates[21];
    expect(sell >= config.costs.secFeeFrom).toBe(true);
    expect(sim.cost[21]).toBeCloseTo((sim.traded[21] * (3 + 0.206)) / 1e4, 9);
  });

  it("keeps equity flat at the capital before the evaluation start", () => {
    const sim = simulate(buildPortfolio(testSystem({ sessions: 60 }), config), config, {
      capital,
      startIndex: 40,
    });
    expect(sim.startIndex).toBe(40);
    for (let t = 0; t <= 40; t++) {
      expect(sim.equity[t]).toBe(capital);
      expect(sim.returns[t]).toBe(0);
    }
    expect(sim.traded[41]).toBeGreaterThan(0);
  });
});

describe("benchmark simulations", () => {
  it("buys the benchmark once at the first evaluation open at the benchmark rate", () => {
    const { panel, system } = single(20);
    const sim = simulateBuyHold(system, config, { capital, startIndex: 5 });
    const open = panel.open[0][6];
    expect(sim.symbols).toEqual(["SPY"]);
    expect(sim.trades[0]).toBe(1);
    expect(sim.cost[6]).toBeCloseTo((sim.traded[6] * 1.5) / 1e4, 12);
    expect(sim.traded[6]).toBeGreaterThan(capital * 0.999);
    expect(sim.traded[6] + sim.cost[6]).toBeLessThanOrEqual(capital);
    const shares = sim.holdings.shares.SPY;
    expect(sim.equity[19]).toBeCloseTo(sim.holdings.cash + shares * panel.close[0][19], 9);
    expect(sim.traded[6]).toBeCloseTo(shares * open, 9);
  });

  it("rebalances to equal weights over eligible symbols on month starts only", () => {
    const system = testSystem({ sessions: 120, start: "2023-01-02", eligibleFrom: { BBB: 30 } });
    const sim = simulateEqualWeight(system, config, { capital, startIndex: 10 });
    // Decided at the start (Jan 16) and each month's first session, filled at the next open.
    expect(system.dates.filter((_, t) => sim.traded[t] > 0)).toEqual([
      "2023-01-17",
      "2023-02-02",
      "2023-03-02",
      "2023-04-04",
      "2023-05-02",
      "2023-06-02",
    ]);
    expect(Object.keys(sim.holdings.shares).sort()).toEqual(system.symbols.slice().sort());
    // Before BBB is eligible the first rebalance holds four names at 25% each.
    const first = simulateEqualWeight(
      { ...system, dates: system.dates.slice(0, 12) },
      config,
      { capital, startIndex: 10 },
    );
    expect(Object.keys(first.holdings.shares)).toHaveLength(4);
    for (const [symbol, shares] of Object.entries(first.holdings.shares)) {
      const close = system.panel.close[system.panel.index[symbol]][10];
      expect((shares * close) / capital).toBeGreaterThan(0.249);
      expect((shares * close) / capital).toBeLessThanOrEqual(0.25 + 1e-6);
    }
  });
});
