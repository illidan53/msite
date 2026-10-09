import type {
  PaperFill,
  PaperLedger,
  PaperOrder,
  PaperSummary,
  RuleContribution,
  Signal,
} from "../../shared/strategy";
import type { StrategyConfig } from "./config";
import {
  decideOrders,
  fillOrders,
  markToMarket,
  oneWayCostBps,
  roundToLot,
  type DecisionInput,
  type ExecutionOptions,
  type Holdings,
} from "./execution";
import { classifyAction } from "./signals";
import type { PortfolioFrame, Series } from "./types";

/**
 * Forward paper trading (spec §7.3). The ledger is an append-only record:
 * each run replays only the sessions after `lastSession` through the same
 * execution.ts semantics as the backtest, so history is never recomputed when
 * the data window rolls or a split re-adjusts past prices.
 */

export const PAPER_FILL_LIMIT = 5000;
/** Stored vs re-fetched close ratio beyond which a held symbol is treated as split. */
export const SPLIT_TOLERANCE = 0.005;

/**
 * A fresh ledger: all cash, nothing replayed yet (`lastSession` ""). Its
 * first replay processes only the frame's newest session, so it starts
 * trading from today's signals instead of back-filling history.
 */
export function createLedger(
  book: string,
  capital: number,
  inception: string,
  configHash: string,
): PaperLedger {
  return {
    version: 1,
    book,
    inception,
    capital,
    configHash,
    cash: capital,
    positions: {},
    pending: [],
    lastSession: "",
    equity: [],
    fills: [],
    events: [
      {
        date: inception,
        kind: "inception",
        detail: `Opened with ${capital} cash (config ${configHash})`,
      },
    ],
  };
}

export interface PaperReplayInput {
  ledger: PaperLedger;
  frame: PortfolioFrame;
  config: StrategyConfig;
  /** Top rule contributions for frame symbol i at session t (signals only). */
  drivers: (i: number, t: number) => RuleContribution[];
  /** Share lot; defaults to config.engine.lot. */
  lot?: number;
  /** Current config hash; a change is logged as a `config` event. */
  configHash?: string;
}
export interface PaperReplayResult {
  ledger: PaperLedger;
  /** Orders decided at the frame's newest session. */
  signals: Signal[];
  /** Fill or cancel outcomes of orders settled during this replay. */
  fills: { signalId: string; fill: Signal["fill"] }[];
}

const finite = (v: number) => Number.isFinite(v);
/** A held symbol without any bar for this many sessions is exited at its last close. */
export const STALE_EXIT_SESSIONS = 10;
const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export function replayPaper(input: PaperReplayInput): PaperReplayResult {
  const { frame, config } = input;
  const system = frame.system;
  const { panel, dates } = system;
  const ledger = structuredClone(input.ledger);
  if (ledger.book !== system.book.id)
    throw new Error(`Ledger ${ledger.book} replayed against book ${system.book.id}`);
  const lot = input.lot ?? config.engine.lot;
  const options: ExecutionOptions = {
    lot,
    buffer: config.engine.buffer,
    minTradeNotional: config.engine.minTradeNotional,
    longShort: false,
  };
  const signals: Signal[] = [];
  const outcomes: PaperReplayResult["fills"] = [];
  const last = dates.length - 1;
  if (input.configHash && input.configHash !== ledger.configHash) {
    ledger.events.push({
      date: dates[last] ?? ledger.lastSession,
      kind: "config",
      detail: `Config ${ledger.configHash} → ${input.configHash}`,
    });
    ledger.configHash = input.configHash;
  }
  const start =
    ledger.lastSession === ""
      ? last
      : dates.findIndex((d) => d > ledger.lastSession);
  if (last < 0 || start < 0) return { ledger, signals, fills: outcomes };

  const frameIndex = new Map(system.symbols.map((s, i) => [s, i]));
  const dateIndex = new Map(dates.map((d, t) => [d, t]));
  const inBook = new Set(system.book.symbols);
  const inPanel = (symbol: string) => panel.index[symbol] !== undefined;
  const at = (series: Series[], symbol: string, t: number) =>
    inPanel(symbol) ? series[panel.index[symbol]][t] : Number.NaN;
  /** No bar in the last STALE_EXIT_SESSIONS sessions up to t. */
  const stale = (symbol: string, t: number) => {
    if (!inPanel(symbol) || t < STALE_EXIT_SESSIONS - 1) return false;
    const close = panel.close[panel.index[symbol]];
    for (let k = t; k > t - STALE_EXIT_SESSIONS; k--) if (close[k] > 0) return false;
    return true;
  };

  // Split check once up front: after it, every mark comes from this frame.
  const firstDate = dates[start];
  for (const position of Object.values(ledger.positions)) {
    const t = dateIndex.get(position.lastDate);
    if (t === undefined) continue;
    const fresh = at(panel.close, position.symbol, t);
    if (!(fresh > 0) || !(position.lastClose > 0)) continue;
    const ratio = position.lastClose / fresh;
    if (Math.abs(ratio - 1) <= SPLIT_TOLERANCE) continue;
    const shares = roundToLot(position.shares * ratio, lot);
    ledger.events.push({
      date: firstDate,
      kind: "split",
      symbol: position.symbol,
      detail: `Close on ${position.lastDate} ${position.lastClose} → ${fresh} (×${round(ratio, 6)}); shares ${position.shares} → ${shares}`,
    });
    position.shares = shares;
    position.averageCost /= ratio;
    position.lastClose = fresh;
    for (const order of ledger.pending)
      if (order.symbol === position.symbol)
        order.shares = roundToLot(order.shares * ratio, lot);
  }

  const holdings: Holdings = { cash: ledger.cash, shares: {}, lastClose: {} };
  const basis = new Map<string, { averageCost: number; lastDate: string }>();
  for (const p of Object.values(ledger.positions)) {
    if (p.shares === 0) continue;
    holdings.shares[p.symbol] = p.shares;
    holdings.lastClose[p.symbol] = p.lastClose;
    basis.set(p.symbol, { averageCost: p.averageCost, lastDate: p.lastDate });
  }
  let pending: PaperOrder[] = ledger.pending;
  const newFills: PaperFill[] = [];
  const benchmarkRow = panel.index[panel.benchmark];

  for (let t = start; t <= last; t++) {
    const date = dates[t];

    // 1. Orders decided at the previous close fill at this open.
    if (pending.length) {
      const bySymbol = new Map(pending.map((o) => [o.symbol, o]));
      const open = (symbol: string) => {
        if (inPanel(symbol) && !stale(symbol, t - 1))
          return panel.open[panel.index[symbol]][t];
        // A held symbol that left the book, or stopped trading long ago, will
        // not get a usable bar again: exits fill at its last mark.
        return (bySymbol.get(symbol)?.shares ?? 0) < 0
          ? (holdings.lastClose[symbol] ?? Number.NaN)
          : Number.NaN;
      };
      const costBps = (symbol: string, side: "buy" | "sell") => {
        const i = frameIndex.get(symbol);
        const d = dateIndex.get(bySymbol.get(symbol)?.decidedAt ?? "");
        const dollarVolume =
          i === undefined || d === undefined ? Number.NaN : system.dollarVolume[i][d];
        return oneWayCostBps(config.costs, dollarVolume, side, date);
      };
      const before = { ...holdings.shares };
      const result = fillOrders(
        holdings,
        pending.map((o) => ({ symbol: o.symbol, shares: o.shares, waited: o.waited })),
        open,
        costBps,
        options,
      );
      for (const fill of result.fills) {
        const order = bySymbol.get(fill.symbol)!;
        const held = before[fill.symbol] ?? 0;
        const now = holdings.shares[fill.symbol] ?? 0;
        const entry = basis.get(fill.symbol);
        if (now === 0) basis.delete(fill.symbol);
        else if (!entry || held === 0 || Math.sign(held) !== Math.sign(now))
          basis.set(fill.symbol, { averageCost: fill.price, lastDate: "" });
        else if (Math.abs(now) > Math.abs(held))
          entry.averageCost =
            (held * entry.averageCost + fill.shares * fill.price) / now;
        newFills.push({
          date,
          symbol: fill.symbol,
          side: fill.shares > 0 ? "buy" : "sell",
          shares: Math.abs(fill.shares),
          price: fill.price,
          cost: fill.cost,
          signalId: order.signalId,
        });
        outcomes.push({
          signalId: order.signalId,
          fill: { date, price: fill.price, cost: round(fill.cost, 4) },
        });
      }
      for (const order of result.cancelled) {
        const paper = bySymbol.get(order.symbol)!;
        ledger.events.push({
          date,
          kind: "cancel",
          symbol: order.symbol,
          detail: `No bar to fill ${order.shares} shares decided ${paper.decidedAt}; cancelled`,
        });
        outcomes.push({ signalId: paper.signalId, fill: { cancelled: date } });
      }
      pending = result.carried.map((o) => ({ ...bySymbol.get(o.symbol)!, waited: o.waited }));
    }

    // 2. Mark to market at this close.
    const value = markToMarket(holdings, (s) => at(panel.close, s, t));
    for (const symbol of Object.keys(holdings.shares))
      if (at(panel.close, symbol, t) > 0) basis.get(symbol)!.lastDate = date;
    const benchmark = benchmarkRow === undefined ? Number.NaN : panel.close[benchmarkRow][t];
    ledger.equity.push({ date, value, benchmark: finite(benchmark) ? benchmark : null });

    // 3. Decide at this close. A symbol still waiting for a bar keeps its order.
    const waiting = new Set(pending.map((o) => o.symbol));
    const inputs: (DecisionInput & { i: number; reason: Signal["reason"] })[] = [];
    system.symbols.forEach((symbol, i) => {
      if (waiting.has(symbol)) return;
      const target = frame.targetWeight[i][t];
      const average = frame.averageWeight[i][t];
      const forced = system.eligible[i][t] !== 1 || !finite(target);
      // Halted or delisted while still listed in the book: exit at the last mark.
      const dead = holdings.shares[symbol] !== undefined && stale(symbol, t);
      inputs.push({
        symbol,
        close: dead ? holdings.lastClose[symbol] : at(panel.close, symbol, t),
        target: forced ? 0 : target,
        average: finite(average) ? average : 0,
        forced,
        i,
        reason: forced ? "ineligible" : "forecast",
      });
    });
    for (const symbol of Object.keys(holdings.shares)) {
      if (frameIndex.has(symbol) || waiting.has(symbol)) continue;
      // A book symbol missing from today's data (e.g. a failed fetch) is held,
      // not liquidated at a stale price; only symbols that left the book exit.
      if (inBook.has(symbol)) continue;
      inputs.push({
        symbol,
        close: inPanel(symbol) ? at(panel.close, symbol, t) : holdings.lastClose[symbol],
        target: 0,
        average: 0,
        forced: true,
        i: -1,
        reason: inBook.has(symbol) ? "ineligible" : "removed",
      });
    }
    const decided = decideOrders(holdings, value, inputs, options);
    const byInput = new Map(inputs.map((x) => [x.symbol, x]));
    for (const order of decided) {
      const x = byInput.get(order.symbol)!;
      const signalId = `${ledger.book}:${date}:${order.symbol}`;
      pending.push({ signalId, symbol: order.symbol, shares: order.shares, decidedAt: date, waited: 0 });
      if (x.reason === "removed")
        ledger.events.push({
          date,
          kind: "removed",
          symbol: order.symbol,
          detail: `No longer in book ${ledger.book}; exiting ${-order.shares} shares`,
        });
      if (t !== last) continue;
      const from = holdings.shares[order.symbol] ?? 0;
      const to = roundToLot(from + order.shares, lot);
      const combined = x.i >= 0 ? system.combined[x.i][t] : Number.NaN;
      signals.push({
        id: signalId,
        book: ledger.book,
        symbol: order.symbol,
        class: x.i >= 0 ? system.classOf[x.i] : (system.book.classOf[order.symbol] ?? ""),
        asOf: date,
        action: classifyAction(from, to),
        fromShares: from,
        toShares: to,
        shares: order.shares,
        price: x.close,
        notional: round(Math.abs(order.shares) * x.close, 2),
        fromWeight: round(((from * x.close) / value) * 100, 4),
        toWeight: round(((to * x.close) / value) * 100, 4),
        forecast: finite(combined) ? round(combined, 2) : null,
        drivers: x.i >= 0 ? input.drivers(x.i, t) : [],
        reason: x.reason,
      });
    }
  }

  ledger.cash = holdings.cash;
  ledger.positions = Object.fromEntries(
    Object.entries(holdings.shares).map(([symbol, shares]) => {
      const entry = basis.get(symbol)!;
      return [
        symbol,
        {
          symbol,
          shares,
          averageCost: entry.averageCost,
          lastClose: holdings.lastClose[symbol],
          lastDate: entry.lastDate,
        },
      ];
    }),
  );
  ledger.pending = pending;
  ledger.lastSession = dates[last];
  // Chronological, like `equity`; only the newest fills are kept.
  ledger.fills = [...ledger.fills, ...newFills].slice(-PAPER_FILL_LIMIT);
  return { ledger, signals, fills: outcomes };
}

/** Headline numbers for the snapshot and e-mail; returns and gross in percent. */
export function paperSummary(ledger: PaperLedger): PaperSummary {
  const equity = ledger.equity.at(-1)?.value ?? ledger.cash;
  const previous = ledger.equity.at(-2)?.value;
  const first = ledger.equity.find((e) => e.benchmark !== null)?.benchmark ?? null;
  const latest = ledger.equity.at(-1)?.benchmark ?? null;
  const gross = Object.values(ledger.positions).reduce(
    (sum, p) => sum + Math.abs(p.shares * p.lastClose),
    0,
  );
  const pct = (v: number) => round(v * 100, 4);
  return {
    inception: ledger.inception,
    lastSession: ledger.lastSession,
    capital: ledger.capital,
    equity: round(equity, 2),
    cash: round(ledger.cash, 2),
    dayReturn: previous ? pct(equity / previous - 1) : null,
    totalReturn: ledger.equity.length ? pct(equity / ledger.capital - 1) : null,
    benchmarkReturn: first && latest ? pct(latest / first - 1) : null,
    positions: Object.keys(ledger.positions).length,
    gross: equity > 0 ? pct(gross / equity) : 0,
  };
}
