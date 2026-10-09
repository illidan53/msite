import { describe, expect, it } from "vitest";
import type { PaperLedger, RuleContribution, Signal } from "../../shared/strategy";
import {
  decideOrders,
  fillOrders,
  markToMarket,
  oneWayCostBps,
  type Holdings,
  type Order,
} from "./execution";
import { buildFrame, opsConfig, sessionDates, sliceSpec, type FrameSpec } from "./opsTestFrames";
import { createLedger, paperSummary, replayPaper } from "./paper";

const config = opsConfig;
const noDrivers = () => [];
const dates = sessionDates("2026-09-28", 8);
const d = (t: number) => dates[t];
const repeat = (n: number, v: number) => Array.from({ length: n }, () => v);
/** Ledgers are persisted as JSON between runs. */
const persist = (ledger: PaperLedger): PaperLedger => JSON.parse(JSON.stringify(ledger));

const baseSpec: FrameSpec = {
  dates,
  symbols: [
    {
      symbol: "A",
      class: "chips",
      close: [100, 100, 100, 100, 100, 102, 104, 103],
      open: [100, 100, 100, 100, 100, 101, 103, 104],
      target: repeat(8, 0.05),
    },
    {
      symbol: "B",
      class: "software",
      close: [50, 50, 50, 50, 50, 51, 52, 53],
      open: [50, 50, 50, 50, 50, 50.5, 51.5, 52.5],
      target: [...repeat(7, 0.02), 0],
      dollarVolume: repeat(8, 50e6),
    },
    { symbol: "C", close: repeat(8, 20), target: repeat(8, 0) },
  ],
};

describe("paper ledger: first run", () => {
  it("opens with cash and signals entries at the newest session only", () => {
    const calls: [number, number][] = [];
    const drivers = (i: number, t: number): RuleContribution[] => {
      calls.push([i, t]);
      return [{ rule: "ewmac16", contribution: 3.5 }];
    };
    const ledger = createLedger("stocks", 100000, d(4), "abc123");
    const result = replayPaper({
      ledger,
      frame: buildFrame(sliceSpec(baseSpec, 5)),
      config,
      drivers,
      lot: 1,
    });
    expect(ledger.lastSession).toBe("");
    expect(result.signals).toEqual([
      {
        id: `stocks:${d(4)}:A`,
        book: "stocks",
        symbol: "A",
        class: "chips",
        asOf: d(4),
        action: "entry",
        fromShares: 0,
        toShares: 40,
        shares: 40,
        price: 100,
        notional: 4000,
        fromWeight: 0,
        toWeight: 4,
        forecast: 5,
        drivers: [{ rule: "ewmac16", contribution: 3.5 }],
        reason: "forecast",
      },
      expect.objectContaining({ symbol: "B", action: "entry", shares: 20, toWeight: 1 }),
    ]);
    expect(calls).toEqual([
      [0, 4],
      [1, 4],
    ]);
    expect(result.fills).toEqual([]);
    expect(result.ledger).toMatchObject({
      inception: d(4),
      lastSession: d(4),
      cash: 100000,
      positions: {},
      equity: [{ date: d(4), value: 100000, benchmark: 404 }],
      pending: [
        { signalId: `stocks:${d(4)}:A`, symbol: "A", shares: 40, decidedAt: d(4), waited: 0 },
        { signalId: `stocks:${d(4)}:B`, symbol: "B", shares: 20, decidedAt: d(4), waited: 0 },
      ],
    });
    expect(result.ledger.events).toEqual([
      expect.objectContaining({ kind: "inception", date: d(4) }),
    ]);
  });

  it("does nothing when no new session exists", () => {
    const first = replayPaper({
      ledger: createLedger("stocks", 100000, d(4), "abc123"),
      frame: buildFrame(sliceSpec(baseSpec, 5)),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    const again = replayPaper({
      ledger: persist(first.ledger),
      frame: buildFrame(sliceSpec(baseSpec, 5)),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    expect(again.signals).toEqual([]);
    expect(again.ledger).toEqual(first.ledger);
  });
});

describe("paper ledger: replay", () => {
  const first = replayPaper({
    ledger: createLedger("stocks", 100000, d(4), "abc123"),
    frame: buildFrame(sliceSpec(baseSpec, 5)),
    config,
    drivers: noDrivers,
    lot: 1,
  });
  const second = replayPaper({
    ledger: persist(first.ledger),
    frame: buildFrame(baseSpec),
    config,
    drivers: noDrivers,
    lot: 1,
  });

  it("fills at the next open with tier costs and marks every missed session", () => {
    // A: 40 @ 101 at 3 bps; B: 20 @ 50.5 at 10 bps ($50m tier).
    expect(second.ledger.fills).toEqual([
      { date: d(5), symbol: "A", side: "buy", shares: 40, price: 101, cost: 40 * 101 * 3e-4, signalId: `stocks:${d(4)}:A` },
      { date: d(5), symbol: "B", side: "buy", shares: 20, price: 50.5, cost: 20 * 50.5 * 1e-3, signalId: `stocks:${d(4)}:B` },
    ]);
    expect(second.fills).toEqual([
      { signalId: `stocks:${d(4)}:A`, fill: { date: d(5), price: 101, cost: 1.212 } },
      { signalId: `stocks:${d(4)}:B`, fill: { date: d(5), price: 50.5, cost: 1.01 } },
    ]);
    expect(second.ledger.cash).toBeCloseTo(94947.778, 6);
    expect(second.ledger.equity.map((e) => [e.date, e.benchmark])).toEqual([
      [d(4), 404],
      [d(5), 405],
      [d(6), 406],
      [d(7), 407],
    ]);
    const values = second.ledger.equity.map((e) => e.value);
    expect(values[0]).toBe(100000);
    expect(values[1]).toBeCloseTo(94947.778 + 40 * 102 + 20 * 51, 6);
    expect(values[2]).toBeCloseTo(94947.778 + 40 * 104 + 20 * 52, 6);
    expect(values[3]).toBeCloseTo(94947.778 + 40 * 103 + 20 * 53, 6);
    expect(second.ledger.positions).toEqual({
      A: { symbol: "A", shares: 40, averageCost: 101, lastClose: 103, lastDate: d(7) },
      B: { symbol: "B", shares: 20, averageCost: 50.5, lastClose: 53, lastDate: d(7) },
    });
    expect(second.ledger.lastSession).toBe(d(7));
  });

  it("returns only the newest session's orders as signals", () => {
    // Sessions 5 and 6 stay inside the buffer; B's target drops to 0 at session 7.
    const equity = 94947.778 + 40 * 103 + 20 * 53;
    expect(second.signals).toHaveLength(1);
    expect(second.signals[0]).toMatchObject({
      id: `stocks:${d(7)}:B`,
      action: "exit",
      fromShares: 20,
      toShares: 0,
      shares: -20,
      price: 53,
      notional: 1060,
      toWeight: 0,
      forecast: 0,
      reason: "forecast",
    });
    expect(second.signals[0].fromWeight).toBeCloseTo((1060 / equity) * 100, 3);
    expect(second.ledger.pending).toEqual([
      { signalId: `stocks:${d(7)}:B`, symbol: "B", shares: -20, decidedAt: d(7), waited: 0 },
    ]);
  });

  it("charges the SEC fee on sells", () => {
    const spec: FrameSpec = {
      ...baseSpec,
      dates: sessionDates("2026-09-28", 9),
      symbols: baseSpec.symbols.map((s) => ({
        ...s,
        close: [...s.close, s.close[7]],
        open: [...(s.open ?? s.close), s.symbol === "B" ? 54 : s.close[7]],
        target: [...s.target, s.target[7]],
        dollarVolume: s.dollarVolume ? [...s.dollarVolume, 50e6] : undefined,
      })),
    };
    const third = replayPaper({
      ledger: persist(second.ledger),
      frame: buildFrame(spec),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    expect(third.ledger.fills.at(-1)).toEqual({
      date: spec.dates[8],
      symbol: "B",
      side: "sell",
      shares: 20,
      price: 54,
      cost: (20 * 54 * (10 + 0.206)) / 1e4,
      signalId: `stocks:${d(7)}:B`,
    });
    expect(third.ledger.positions.B).toBeUndefined();
  });

  it("logs a config change instead of resetting the ledger", () => {
    const next = replayPaper({
      ledger: persist(first.ledger),
      frame: buildFrame(baseSpec),
      config,
      drivers: noDrivers,
      lot: 1,
      configHash: "def456",
    });
    expect(next.ledger.configHash).toBe("def456");
    expect(next.ledger.events.at(-1)).toMatchObject({ kind: "config", detail: "Config abc123 → def456" });
    expect(next.ledger.cash).toBeCloseTo(second.ledger.cash, 9);
  });
});

/** Deterministic LCG for fixture paths. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function parityFrame(): FrameSpec {
  const n = 40;
  const rand = lcg(20261008);
  const days = sessionDates("2026-08-03", n);
  const symbols = ["A", "B", "C", "D"].map((symbol, k) => {
    let price = 50 + 40 * k;
    const close: number[] = [];
    const open: number[] = [];
    const target: number[] = [];
    const eligible: number[] = [];
    const dollarVolume: number[] = [];
    for (let t = 0; t < n; t++) {
      const gap = 1 + (rand() - 0.5) * 0.02;
      open.push(price * gap);
      price *= 1 + (rand() - 0.5) * 0.06;
      close.push(price);
      const raw = rand();
      target.push(raw < 0.15 ? 0 : 0.02 + raw * 0.12);
      eligible.push(1);
      dollarVolume.push([2e9, 2e8, 5e7, 5e6][(k + t) % 4]);
    }
    return { symbol, close, open, target, eligible, dollarVolume, average: repeat(n, 0.08) };
  });
  // C has no bar for two sessions: orders wait once, then cancel.
  for (const t of [20, 21]) {
    symbols[2].close[t] = Number.NaN;
    symbols[2].open[t] = Number.NaN;
    symbols[2].eligible[t] = 0;
  }
  // D turns ineligible for a while: forced exits, then re-entry.
  for (const t of [30, 31, 32]) {
    symbols[3].eligible[t] = 0;
    symbols[3].target[t] = Number.NaN;
  }
  return { dates: days, symbols };
}

/** The backtest's loop written directly against execution.ts. */
function handLoop(spec: FrameSpec, from: number, capital: number) {
  const frame = buildFrame(spec);
  const { panel, symbols } = frame.system;
  const options = {
    lot: config.engine.lot,
    buffer: config.engine.buffer,
    minTradeNotional: config.engine.minTradeNotional,
    longShort: false,
  };
  const h: Holdings = { cash: capital, shares: {}, lastClose: {} };
  let pending: (Order & { decidedAt: number })[] = [];
  const equity: number[] = [];
  const fills: string[] = [];
  let cancelled = 0;
  for (let t = from; t < spec.dates.length; t++) {
    const decidedAt = new Map(pending.map((o) => [o.symbol, o.decidedAt]));
    const result = fillOrders(
      h,
      pending.map(({ symbol, shares, waited }) => ({ symbol, shares, waited })),
      (s) => panel.open[panel.index[s]][t],
      (s, side) =>
        oneWayCostBps(
          config.costs,
          frame.system.dollarVolume[symbols.indexOf(s)][decidedAt.get(s)!],
          side,
          spec.dates[t],
        ),
      options,
    );
    fills.push(...result.fills.map((f) => `${spec.dates[t]} ${f.symbol} ${f.shares} ${f.price} ${f.cost}`));
    cancelled += result.cancelled.length;
    pending = result.carried.map((o) => ({ ...o, decidedAt: decidedAt.get(o.symbol)! }));
    const value = markToMarket(h, (s) => panel.close[panel.index[s]][t]);
    equity.push(value);
    const waiting = new Set(pending.map((o) => o.symbol));
    const orders = decideOrders(
      h,
      value,
      symbols
        .map((symbol, i) => {
          const target = frame.targetWeight[i][t];
          const forced = frame.system.eligible[i][t] !== 1 || !Number.isFinite(target);
          return {
            symbol,
            close: panel.close[panel.index[symbol]][t],
            target: forced ? 0 : target,
            average: frame.averageWeight[i][t],
            forced,
          };
        })
        .filter((x) => !waiting.has(x.symbol)),
      options,
    );
    pending.push(...orders.map((o) => ({ ...o, decidedAt: t })));
  }
  return { cash: h.cash, shares: h.shares, equity, fills, cancelled, pending };
}

describe("paper ledger: parity with the backtest loop", () => {
  const spec = parityFrame();
  const start = 10;
  const reference = handLoop(spec, start, 100000);
  const fillKeys = (ledger: PaperLedger) =>
    ledger.fills.map((f) => `${f.date} ${f.symbol} ${f.side === "buy" ? f.shares : -f.shares} ${f.price} ${f.cost}`);

  it("exercises fills, carries and cancels", () => {
    expect(reference.fills.length).toBeGreaterThan(20);
    expect(reference.cancelled).toBeGreaterThan(0);
  });

  it("matches the loop when sessions are replayed in one catch-up run", () => {
    const opened = replayPaper({
      ledger: createLedger("stocks", 100000, spec.dates[start], "h"),
      frame: buildFrame(sliceSpec(spec, start + 1)),
      config,
      drivers: noDrivers,
    });
    const caught = replayPaper({
      ledger: persist(opened.ledger),
      frame: buildFrame(spec),
      config,
      drivers: noDrivers,
    });
    const ledger = caught.ledger;
    expect(ledger.equity.map((e) => e.value)).toEqual(reference.equity);
    expect(ledger.cash).toBe(reference.cash);
    expect(Object.fromEntries(Object.entries(ledger.positions).map(([s, p]) => [s, p.shares]))).toEqual(
      reference.shares,
    );
    expect(fillKeys(ledger)).toEqual(reference.fills);
    expect(ledger.pending.map((o) => [o.symbol, o.shares, o.waited])).toEqual(
      reference.pending.map((o) => [o.symbol, o.shares, o.waited]),
    );
    expect(ledger.events.filter((e) => e.kind === "cancel")).toHaveLength(reference.cancelled);
  });

  it("matches the loop when run every day", () => {
    let ledger = createLedger("stocks", 100000, spec.dates[start], "h");
    const signalIds: string[] = [];
    const outcomes = new Map<string, Signal["fill"]>();
    for (let t = start; t < spec.dates.length; t++) {
      const result = replayPaper({
        ledger: persist(ledger),
        frame: buildFrame(sliceSpec(spec, t + 1)),
        config,
        drivers: noDrivers,
      });
      ledger = result.ledger;
      signalIds.push(...result.signals.map((s) => s.id));
      for (const f of result.fills) outcomes.set(f.signalId, f.fill);
    }
    expect(ledger.equity.map((e) => e.value)).toEqual(reference.equity);
    expect(ledger.cash).toBe(reference.cash);
    expect(fillKeys(ledger)).toEqual(reference.fills);
    // Every order became a signal on its own day, and every settled one reported back.
    expect(new Set(ledger.fills.map((f) => f.signalId))).toEqual(
      new Set([...outcomes].filter(([, f]) => f && "price" in f).map(([id]) => id)),
    );
    for (const id of outcomes.keys()) expect(signalIds).toContain(id);
  });
});

describe("paper ledger: corporate actions and removals", () => {
  const holding = (ledger: PaperLedger, symbol: string, shares: number, close: number, date: string) => {
    ledger.positions[symbol] = { symbol, shares, averageCost: close, lastClose: close, lastDate: date };
    ledger.cash -= shares * close;
  };

  it("rescales shares, cost and pending orders after a split", () => {
    const ledger = createLedger("stocks", 100000, d(3), "h");
    ledger.lastSession = d(4);
    holding(ledger, "A", 40, 200, d(4));
    ledger.positions.A.averageCost = 90;
    holding(ledger, "B", 10, 50.15, d(4));
    ledger.pending = [{ signalId: `stocks:${d(4)}:A`, symbol: "A", shares: 10, decidedAt: d(4), waited: 0 }];
    const cash = ledger.cash;
    // History re-fetched after a 2:1 split is adjusted: the stored 200 now reads 100.
    const spec: FrameSpec = {
      dates: dates.slice(0, 6),
      symbols: [
        {
          symbol: "A",
          close: [100, 100, 100, 100, 100, 101],
          open: [100, 100, 100, 100, 100, 100.5],
          target: repeat(6, 0.1),
        },
        // 0.3% drift is data noise, not a split.
        { symbol: "B", close: repeat(6, 50), target: repeat(6, 0.005), average: repeat(6, 0.005) },
      ],
    };
    const result = replayPaper({ ledger, frame: buildFrame(spec), config, drivers: noDrivers, lot: 1 });
    const splits = result.ledger.events.filter((e) => e.kind === "split");
    expect(splits).toHaveLength(1);
    expect(splits[0]).toMatchObject({ date: d(5), symbol: "A" });
    const fillCost = 20 * 100.5 * 3e-4;
    expect(result.ledger.fills).toEqual([
      expect.objectContaining({ symbol: "A", shares: 20, price: 100.5, cost: fillCost }),
    ]);
    expect(result.ledger.positions.A).toEqual({
      symbol: "A",
      shares: 100,
      averageCost: (80 * 45 + 20 * 100.5) / 100,
      lastClose: 101,
      lastDate: d(5),
    });
    expect(result.ledger.positions.B.shares).toBe(10);
    expect(result.ledger.cash).toBeCloseTo(cash - 20 * 100.5 - fillCost, 9);
    expect(result.ledger.equity).toEqual([
      { date: d(5), value: result.ledger.cash + 100 * 101 + 10 * 50, benchmark: 405 },
    ]);
  });

  it("forces out symbols that left the book or turned ineligible, but holds through a failed fetch", () => {
    const ledger = createLedger("stocks", 100000, d(3), "h");
    ledger.lastSession = d(4);
    holding(ledger, "A", 10, 100, d(4)); // ineligible at session 5
    holding(ledger, "Z", 5, 30, d(4)); // left the book, still fetched
    holding(ledger, "Y", 4, 25, d(4)); // left the book, no data at all
    holding(ledger, "M", 3, 40, d(4)); // book symbol whose fetch failed
    const spec: FrameSpec = {
      dates: dates.slice(0, 7),
      symbols: [
        {
          symbol: "A",
          close: repeat(7, 100),
          target: [...repeat(5, 0.05), Number.NaN, 0.05],
          eligible: [1, 1, 1, 1, 1, 0, 1],
        },
      ],
      missing: ["M"],
      panelOnly: [{ symbol: "Z", close: [30, 30, 30, 30, 30, 31, 32], open: [30, 30, 30, 30, 30, 30.5, 31.5] }],
    };
    const decided = replayPaper({
      ledger,
      frame: buildFrame(sliceSpec(spec, 6)),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    expect(
      decided.signals.map((s) => [s.symbol, s.action, s.shares, s.reason, s.price, s.drivers]),
    ).toEqual([
      ["A", "exit", -10, "ineligible", 100, []],
      ["Z", "exit", -5, "removed", 31, []],
      ["Y", "exit", -4, "removed", 25, []],
    ]);
    expect(decided.ledger.events.filter((e) => e.kind === "removed").map((e) => e.symbol)).toEqual([
      "Z",
      "Y",
    ]);
    const filled = replayPaper({
      ledger: persist(decided.ledger),
      frame: buildFrame(spec),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    // Symbols absent from the panel exit at their last mark; costs use the top tier.
    expect(filled.ledger.fills.map((f) => [f.symbol, f.side, f.shares, f.price, f.cost])).toEqual([
      ["A", "sell", 10, 100, (10 * 100 * 3.206) / 1e4],
      ["Z", "sell", 5, 31.5, (5 * 31.5 * 30.206) / 1e4],
      ["Y", "sell", 4, 25, (4 * 25 * 30.206) / 1e4],
    ]);
    // M is still in the book: a missing fetch keeps the position at its last mark.
    expect(Object.keys(filled.ledger.positions)).toEqual(["M"]);
    expect(filled.ledger.positions.M).toMatchObject({ shares: 3, lastClose: 40 });
    // A is eligible again at session 6 and re-enters.
    expect(filled.signals.map((s) => [s.symbol, s.action, s.shares])).toEqual([["A", "entry", 40]]);
  });

  it("exits a held book symbol at its last close after it stops trading", () => {
    const long = sessionDates("2026-09-01", 16);
    const closes = [...repeat(4, 20), ...repeat(12, Number.NaN)];
    const spec: FrameSpec = {
      dates: long,
      symbols: [{ symbol: "H", close: closes, target: repeat(16, 0.05) }],
    };
    const ledger = createLedger("stocks", 100000, long[3], "h");
    ledger.lastSession = long[3];
    holding(ledger, "H", 50, 20, long[3]);
    const result = replayPaper({ ledger, frame: buildFrame(spec), config, drivers: noDrivers, lot: 1 });
    // No bar for STALE_EXIT_SESSIONS (10) sessions: the exit is decided at long[13]
    // and fills at the last close on the next session.
    expect(result.ledger.fills.map((f) => [f.symbol, f.date, f.shares, f.price])).toEqual([
      ["H", long[14], 50, 20],
    ]);
    expect(result.ledger.positions).toEqual({});
  });

  it("cancels an order after waiting one session without a bar", () => {
    const spec: FrameSpec = {
      dates,
      symbols: [
        {
          symbol: "A",
          close: [100, 100, 100, 100, 100, Number.NaN, Number.NaN, 100],
          target: repeat(8, 0.05),
        },
      ],
    };
    const opened = replayPaper({
      ledger: createLedger("stocks", 100000, d(4), "h"),
      frame: buildFrame(sliceSpec(spec, 5)),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    const waited = replayPaper({
      ledger: persist(opened.ledger),
      frame: buildFrame(sliceSpec(spec, 6)),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    expect(waited.ledger.pending).toEqual([
      { signalId: `stocks:${d(4)}:A`, symbol: "A", shares: 40, decidedAt: d(4), waited: 1 },
    ]);
    expect(waited.signals).toEqual([]);
    expect(waited.fills).toEqual([]);
    const later = replayPaper({
      ledger: persist(waited.ledger),
      frame: buildFrame(spec),
      config,
      drivers: noDrivers,
      lot: 1,
    });
    expect(later.fills).toEqual([{ signalId: `stocks:${d(4)}:A`, fill: { cancelled: d(6) } }]);
    expect(later.ledger.events.at(-1)).toMatchObject({ kind: "cancel", symbol: "A", date: d(6) });
    expect(later.ledger.fills).toEqual([]);
    expect(later.signals.map((s) => [s.id, s.action, s.shares])).toEqual([
      [`stocks:${d(7)}:A`, "entry", 40],
    ]);
    expect(later.ledger.equity.map((e) => e.value)).toEqual([100000, 100000, 100000, 100000]);
  });

  it("refuses a ledger from another book", () => {
    expect(() =>
      replayPaper({
        ledger: createLedger("sectors", 1, d(0), "h"),
        frame: buildFrame(baseSpec),
        config,
        drivers: noDrivers,
      }),
    ).toThrow(/sectors/);
  });
});

describe("paper summary", () => {
  it("reports returns against SPY in percent", () => {
    const ledger = createLedger("stocks", 100000, d(0), "h");
    ledger.cash = 50000;
    ledger.positions.A = { symbol: "A", shares: 500, averageCost: 100, lastClose: 104, lastDate: d(2) };
    ledger.equity = [
      { date: d(0), value: 100000, benchmark: 400 },
      { date: d(1), value: 101000, benchmark: 404 },
      { date: d(2), value: 102000, benchmark: 410 },
    ];
    ledger.lastSession = d(2);
    expect(paperSummary(ledger)).toEqual({
      inception: d(0),
      lastSession: d(2),
      capital: 100000,
      equity: 102000,
      cash: 50000,
      dayReturn: 0.9901,
      totalReturn: 2,
      benchmarkReturn: 2.5,
      positions: 1,
      gross: 50.9804,
    });
    expect(paperSummary(createLedger("stocks", 100, d(0), "h"))).toMatchObject({
      equity: 100,
      dayReturn: null,
      totalReturn: null,
      benchmarkReturn: null,
      gross: 0,
    });
  });
});
