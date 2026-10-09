import type { StrategyConfig } from "./config";
import {
  decideOrders,
  fillOrders,
  markToMarket,
  oneWayCostBps,
  type DecisionInput,
  type Holdings,
  type Order,
} from "./execution";
import { isMonthStart } from "./portfolio";
import type { PortfolioFrame, Series, SystemFrame } from "./types";

/**
 * Historical simulation with the execution rules shared by paper trading:
 * at each session t from the evaluation start, fill pending orders at t's
 * open, mark to market at t's close, record, then decide the next orders
 * from t's targets. Positions are sized on current equity, so returns
 * compound; idle cash earns nothing.
 */

export interface SimulationResult {
  /** First simulated session; equity before it is flat at the capital. */
  startIndex: number;
  capital: number;
  symbols: string[];
  /** Marked equity at each close (currency). */
  equity: Series;
  /** Close-to-close equity return as a fraction (0 before the start). */
  returns: Series;
  /** Σ|position value| ÷ equity at each close. */
  gross: Series;
  /** Costs paid and traded value at each session's open (currency). */
  cost: Series;
  traded: Series;
  /** Per symbol: summed daily P&L ÷ capital, over the simulated sessions. */
  contribution: Float64Array;
  /** Per symbol: mean signed position value ÷ equity over the simulated sessions. */
  averageWeight: Float64Array;
  /** Per symbol: number of fills. */
  trades: Uint32Array;
  /** State after the last session's decision. */
  holdings: Holdings;
  pending: Order[];
}

export interface SimulationOptions {
  capital: number;
  startIndex: number;
  /** Share lot (config.engine.lot by default; the whole_shares variant uses 1). */
  lot?: number;
  longShort?: boolean;
}

interface Leg {
  symbol: string;
  open: Series;
  close: Series;
  /** Trailing dollar volume for the cost tier; absent for the benchmark rate. */
  dollarVolume?: Series;
}

type Decide = (t: number) => DecisionInput[] | null;

function run(
  dates: string[],
  config: StrategyConfig,
  legs: Leg[],
  options: SimulationOptions & { buffer: number },
  decide: Decide,
): SimulationResult {
  const T = dates.length;
  const n = legs.length;
  const { capital } = options;
  const start = Math.max(0, options.startIndex);
  const lot = options.lot ?? config.engine.lot;
  const longShort = options.longShort ?? false;
  const execution = {
    lot,
    buffer: options.buffer,
    minTradeNotional: config.engine.minTradeNotional,
    longShort,
  };
  const index = new Map(legs.map((leg, i) => [leg.symbol, i]));
  const leg = (symbol: string) => legs[index.get(symbol)!];

  const holdings: Holdings = { cash: capital, shares: {}, lastClose: {} };
  let pending: Order[] = [];
  const equity = new Float64Array(T).fill(capital);
  const returns = new Float64Array(T);
  const gross = new Float64Array(T);
  const cost = new Float64Array(T);
  const traded = new Float64Array(T);
  const contribution = new Float64Array(n);
  const weightSum = new Float64Array(n);
  const trades = new Uint32Array(n);
  const value = (i: number) =>
    (holdings.shares[legs[i].symbol] ?? 0) * (holdings.lastClose[legs[i].symbol] ?? 0);

  let previous = capital;
  for (let t = start; t < T; t++) {
    const date = dates[t];
    const before = Float64Array.from({ length: n }, (_, i) => value(i));
    const flow = new Float64Array(n);
    // An order decided at d first tries to fill at d+1; `waited` counts misses since.
    const decidedAt = new Map(pending.map((o) => [o.symbol, t - 1 - o.waited]));
    const filled = fillOrders(
      holdings,
      pending,
      (symbol) => leg(symbol).open[t],
      (symbol, side) =>
        oneWayCostBps(
          config.costs,
          leg(symbol).dollarVolume?.[decidedAt.get(symbol)!] ?? Number.NaN,
          side,
          date,
          !leg(symbol).dollarVolume,
        ),
      execution,
    );
    pending = filled.carried;
    for (const fill of filled.fills) {
      const i = index.get(fill.symbol)!;
      flow[i] -= fill.shares * fill.price + fill.cost;
      cost[t] += fill.cost;
      traded[t] += Math.abs(fill.shares * fill.price);
      trades[i]++;
    }
    const marked = markToMarket(holdings, (symbol) => leg(symbol).close[t]);
    let exposure = 0;
    for (let i = 0; i < n; i++) {
      const v = value(i);
      contribution[i] += (v - before[i] + flow[i]) / capital;
      weightSum[i] += marked > 0 ? v / marked : 0;
      exposure += Math.abs(v);
    }
    equity[t] = marked;
    returns[t] = previous > 0 ? marked / previous - 1 : 0;
    gross[t] = marked > 0 ? exposure / marked : 0;
    previous = marked;

    const inputs = decide(t);
    if (inputs) {
      // A fresh decision on a session with a close supersedes an order still waiting for a bar.
      const decided = new Set(inputs.filter((d) => d.close > 0).map((d) => d.symbol));
      pending = [
        ...pending.filter((o) => !decided.has(o.symbol)),
        ...decideOrders(holdings, marked, inputs, execution),
      ];
    }
  }
  const sessions = Math.max(0, T - start);
  return {
    startIndex: start,
    capital,
    symbols: legs.map((l) => l.symbol),
    equity,
    returns,
    gross,
    cost,
    traded,
    contribution,
    averageWeight: weightSum.map((w) => (sessions ? w / sessions : 0)),
    trades,
    holdings,
    pending,
  };
}

const systemLegs = (system: SystemFrame): Leg[] =>
  system.symbols.map((symbol, i) => ({
    symbol,
    open: system.panel.open[system.panelIndex[i]],
    close: system.panel.close[system.panelIndex[i]],
    dollarVolume: system.dollarVolume[i],
  }));

/** Simulates a portfolio frame; symbols that are ineligible at a decision are forced out. */
export function simulate(
  frame: PortfolioFrame,
  config: StrategyConfig,
  options: SimulationOptions,
): SimulationResult {
  const { system } = frame;
  const legs = systemLegs(system);
  return run(
    system.dates,
    config,
    legs,
    { ...options, buffer: config.engine.buffer },
    (t) =>
      legs.map((leg, i) => {
        const target = frame.targetWeight[i][t];
        const average = frame.averageWeight[i][t];
        return {
          symbol: leg.symbol,
          close: leg.close[t],
          target: Number.isFinite(target) ? target : 0,
          average: Number.isFinite(average) ? average : 0,
          forced: system.eligible[i][t] !== 1,
        };
      }),
  );
}

/**
 * spy_buy_hold: the whole capital in the benchmark, decided at the start
 * session's close like every other run and filled at the first evaluation
 * open, then never rebalanced. Benchmark cost rate.
 */
export function simulateBuyHold(
  system: SystemFrame,
  config: StrategyConfig,
  options: Omit<SimulationOptions, "longShort">,
): SimulationResult {
  const { panel } = system;
  const row = panel.index[panel.benchmark];
  const leg: Leg = { symbol: panel.benchmark, open: panel.open[row], close: panel.close[row] };
  const start = Math.max(0, options.startIndex);
  return run(system.dates, config, [leg], { ...options, buffer: 0 }, (t) =>
    t === start
      ? [{ symbol: leg.symbol, close: leg.close[t], target: 1, average: 1 }]
      : null,
  );
}

/**
 * equal_weight_buy_hold: 1/n of equity in each symbol eligible at the start
 * and at each month's first session, rebalanced at the next open with no
 * buffer, held untouched in between. Same cost tiers as the system.
 */
export function simulateEqualWeight(
  system: SystemFrame,
  config: StrategyConfig,
  options: Omit<SimulationOptions, "longShort">,
): SimulationResult {
  const legs = systemLegs(system);
  const start = Math.max(0, options.startIndex);
  return run(system.dates, config, legs, { ...options, buffer: 0 }, (t) => {
    if (t !== start && !isMonthStart(system.dates, t)) return null;
    const live = system.eligible.filter((e) => e[t] === 1).length;
    return legs.map((leg, i) => {
      const target = live && system.eligible[i][t] === 1 ? 1 / live : 0;
      return { symbol: leg.symbol, close: leg.close[t], target, average: target };
    });
  });
}
