import type { StrategyConfig } from "./config";

/**
 * Trading semantics shared by the backtest simulator and forward paper
 * trading, so both follow exactly the same rules:
 *
 * 1. After session t's close: equity is marked at the latest closes and new
 *    orders are decided from t's target and average weights (AFTS Strategy 8
 *    buffering: trade only outside target ± 10% of the average position, and
 *    only to the nearest band edge; a zero long-only target exits fully).
 * 2. At session t+1's open: sells fill first, then buys. A cash account
 *    scales buys down when the open gap leaves too little cash. A symbol
 *    without a bar keeps its order for one more session, then it is cancelled.
 * 3. Costs are one-way bps of traded value, plus the SEC fee on sells.
 */

export interface Holdings {
  cash: number;
  /** Signed share counts; zero positions are removed. */
  shares: Record<string, number>;
  /** Latest close seen for each held symbol (marks positions on days without a bar). */
  lastClose: Record<string, number>;
}

export interface DecisionInput {
  symbol: string;
  /** Decision-session close; NaN when the symbol has no bar (no decision). */
  close: number;
  /** Target weight as a fraction of equity (signed for long/short). */
  target: number;
  /** Average-position weight (forecast 10) for the buffer width. */
  average: number;
  /** Exit fully regardless of the band (removed from the book or ineligible). */
  forced?: boolean;
}

export interface ExecutionOptions {
  lot: number;
  buffer: number;
  minTradeNotional: number;
  longShort: boolean;
}

export interface Order {
  symbol: string;
  /** Signed share change. */
  shares: number;
  /** Sessions already waited without a bar to fill at. */
  waited: number;
}

export interface Fill {
  symbol: string;
  shares: number;
  price: number;
  cost: number;
}

/** Banker's rounding, matching pandas/numpy round. */
export function roundHalfEven(value: number) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

export function roundToLot(shares: number, lot: number) {
  const units = roundHalfEven(shares / lot);
  const decimals = Math.max(0, Math.ceil(-Math.log10(lot) - 1e-9));
  const value = Number((units * lot).toFixed(decimals));
  return value === 0 ? 0 : value;
}

export function equity(holdings: Holdings) {
  let value = holdings.cash;
  for (const [symbol, shares] of Object.entries(holdings.shares))
    value += shares * (holdings.lastClose[symbol] ?? 0);
  return value;
}

/** Records closes for held symbols; symbols without a finite close keep their last mark. */
export function markToMarket(
  holdings: Holdings,
  close: (symbol: string) => number,
) {
  for (const symbol of Object.keys(holdings.shares)) {
    const price = close(symbol);
    if (Number.isFinite(price) && price > 0) holdings.lastClose[symbol] = price;
  }
  return equity(holdings);
}

/**
 * The buffered share change for one symbol, or 0. `equityValue` is the
 * marked equity at the decision close; weights are fractions of it.
 */
export function bufferedChange(
  current: number,
  input: DecisionInput,
  equityValue: number,
  options: ExecutionOptions,
) {
  if (!(input.close > 0) || !(equityValue > 0)) return 0;
  const target = input.forced ? 0 : input.target;
  // A zero target exits fully instead of keeping Carver's residual inside the
  // band: a long-only cash account should not leave stub holdings.
  if (target === 0) return current === 0 ? 0 : -current;
  const targetShares = (equityValue * target) / input.close;
  const width =
    (options.buffer * equityValue * Math.abs(input.average)) / input.close;
  let lo = roundToLot(targetShares - width, options.lot);
  let hi = roundToLot(targetShares + width, options.lot);
  if (!options.longShort) {
    lo = Math.max(0, lo);
    hi = Math.max(0, hi);
  }
  const desired = current < lo ? lo : current > hi ? hi : current;
  const change = roundToLot(desired - current, options.lot);
  // Dust trades are skipped; exits to zero are handled above and always go through.
  if (Math.abs(change) * input.close < options.minTradeNotional) return 0;
  return change;
}

export function decideOrders(
  holdings: Holdings,
  equityValue: number,
  inputs: DecisionInput[],
  options: ExecutionOptions,
): Order[] {
  const orders: Order[] = [];
  for (const input of inputs) {
    const shares = bufferedChange(
      holdings.shares[input.symbol] ?? 0,
      input,
      equityValue,
      options,
    );
    if (shares !== 0) orders.push({ symbol: input.symbol, shares, waited: 0 });
  }
  return orders;
}

/** One-way cost model from config: liquidity tier by trailing dollar volume, SEC fee on sells. */
export function oneWayCostBps(
  costs: StrategyConfig["costs"],
  dollarVolume: number,
  side: "buy" | "sell",
  date: string,
  isBenchmark = false,
) {
  const tier = isBenchmark
    ? costs.benchmarkBps
    : (costs.tiers.find(
        (t) => Number.isFinite(dollarVolume) && dollarVolume >= t.minDollarVolume,
      ) ?? costs.tiers.at(-1)!).bps;
  return tier + (side === "sell" && date >= costs.secFeeFrom ? costs.secFeeBps : 0);
}

/**
 * Fills orders at the open. Returns fills, orders carried to the next session
 * (no bar today, first wait) and cancelled orders (no bar for a second session).
 */
export function fillOrders(
  holdings: Holdings,
  orders: Order[],
  open: (symbol: string) => number,
  costBps: (symbol: string, side: "buy" | "sell") => number,
  options: Pick<ExecutionOptions, "lot" | "longShort">,
) {
  const fills: Fill[] = [];
  const carried: Order[] = [];
  const cancelled: Order[] = [];
  const ready: { order: Order; price: number }[] = [];
  for (const order of orders) {
    const price = open(order.symbol);
    if (Number.isFinite(price) && price > 0) ready.push({ order, price });
    else if (order.waited < 1) carried.push({ ...order, waited: order.waited + 1 });
    else cancelled.push(order);
  }
  const execute = (symbol: string, shares: number, price: number) => {
    if (shares === 0) return;
    const side = shares > 0 ? "buy" : "sell";
    const cost = (Math.abs(shares) * price * costBps(symbol, side)) / 1e4;
    holdings.cash -= shares * price + cost;
    const next = roundToLot((holdings.shares[symbol] ?? 0) + shares, options.lot);
    if (next === 0) delete holdings.shares[symbol];
    else holdings.shares[symbol] = next;
    holdings.lastClose[symbol] ??= price;
    fills.push({ symbol, shares, price, cost });
  };
  const sells = ready.filter((r) => r.order.shares < 0);
  const buys = ready.filter((r) => r.order.shares > 0);
  for (const { order, price } of sells) execute(order.symbol, order.shares, price);
  let scale = 1;
  if (!options.longShort) {
    const needed = buys.reduce(
      (sum, { order, price }) =>
        sum +
        order.shares * price * (1 + costBps(order.symbol, "buy") / 1e4),
      0,
    );
    if (needed > holdings.cash) scale = Math.max(0, holdings.cash) / needed;
  }
  for (const { order, price } of buys) {
    let shares = order.shares * scale;
    if (scale < 1) shares = Math.floor(shares / options.lot) * options.lot;
    execute(order.symbol, roundToLot(shares, options.lot), price);
  }
  return { fills, carried, cancelled, scale };
}
