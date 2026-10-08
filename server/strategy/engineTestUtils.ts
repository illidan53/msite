import { expect } from "vitest";
import type { PriceBar } from "../../shared/types";
import { strategyConfigSchema, type BookDefinition, type StrategyConfig } from "./config";

/** Element-wise toBeCloseTo, with NaN expected exactly where the golden vector has NaN. */
export function expectSeries(actual: ArrayLike<number>, expected: number[], digits = 12) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, i) => {
    if (Number.isNaN(value)) expect(actual[i], `index ${i}`).toBeNaN();
    else expect(actual[i], `index ${i}`).toBeCloseTo(value, digits);
  });
}

/** The 300-bar golden series (integer LCG drifting up, down, then up; mirrored in pandas). */
export function goldenCloses() {
  const uniform = lcg(12345);
  const closes = [100];
  for (let k = 1; k < 300; k++) {
    const drift = k < 120 ? 0.003 : k < 200 ? -0.004 : 0.002;
    const r = drift + 0.03 * (uniform() - 0.5);
    closes.push(closes[k - 1] * (1 + r));
  }
  return Float64Array.from(closes);
}

/** Deterministic uniform [0, 1) generator (integer LCG, identical in Python). */
export function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Standard normal draws from an LCG via Box–Muller. */
export function gaussian(seed: number) {
  const uniform = lcg(seed);
  return () =>
    Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** `count` weekday session dates from `start` (YYYY-MM-DD). */
export function weekdays(start: string, count: number) {
  const dates: string[] = [];
  const day = new Date(`${start}T00:00:00Z`);
  while (dates.length < count) {
    if (day.getUTCDay() % 6 !== 0) dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}

export interface PathSpec {
  seed: number;
  /** Daily log drift, constant or per session index. */
  drift?: number | ((k: number) => number);
  /** Annualised volatility (fraction). */
  vol?: number;
  /** First session index with a bar (late listing). */
  start?: number;
  /** Session indices without a bar. */
  gaps?: number[];
  /** Shares per day; dollar volume is close × volume. */
  volume?: number;
  price?: number;
  /** Session index range [from, to) where the close does not move (stale prices). */
  flat?: [number, number];
}

/** Random-walk bars on the given sessions, stamped at 16:00 New York time. */
export function syntheticBars(dates: string[], spec: PathSpec): PriceBar[] {
  const draw = gaussian(spec.seed);
  const gaps = new Set(spec.gaps ?? []);
  const daily = (spec.vol ?? 0.3) / 16;
  let close = spec.price ?? 100;
  const bars: PriceBar[] = [];
  dates.forEach((date, k) => {
    if (k < (spec.start ?? 0)) return;
    const drift = typeof spec.drift === "function" ? spec.drift(k) : (spec.drift ?? 0);
    const open = close;
    const move = Math.exp(drift + daily * draw());
    if (!spec.flat || k < spec.flat[0] || k >= spec.flat[1]) close *= move;
    if (gaps.has(k)) return;
    bars.push({
      timestamp: `${date}T20:00:00.000Z`,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: spec.volume ?? 5e6,
    });
  });
  return bars;
}

/** The committed config/strategy.yaml engine and cost settings. */
export const testConfig: StrategyConfig = strategyConfigSchema.parse({
  version: 1,
  benchmark: "SPY",
  engine: {
    forecastCap: 20,
    buffer: 0.1,
    lot: 0.0001,
    minTradeNotional: 25,
    eligibilitySessions: 256,
    evaluationMinSession: 320,
    evaluationEligibleShare: 0.8,
    ruleCostLimitSharpe: 0.15,
    instrumentCostLimitSharpe: 0.01,
    diversificationCap: 2.5,
    overlay: { gross: 1, normalRisk: 1.75, correlationShock: 4, jumpRisk: 4 },
  },
  costs: {
    benchmarkBps: 1.5,
    tiers: [
      { minDollarVolume: 500e6, bps: 3 },
      { minDollarVolume: 100e6, bps: 5 },
      { minDollarVolume: 10e6, bps: 10 },
      { minDollarVolume: 0, bps: 30 },
    ],
    secFeeBps: 0.206,
    secFeeFrom: "2026-04-04",
  },
  books: [
    {
      id: "test",
      name: { en: "Test", zh: "测试" },
      source: "symbols",
      className: "Test",
      symbols: ["AAA", "BBB"],
      riskTarget: 0.2,
      maxPositionWeight: 0.1,
      capital: 100000,
    },
  ],
  schedule: {
    timezone: "America/New_York",
    dailyAt: "07:00",
    dailyRetryMinutes: 30,
    dailyGiveUpAt: "12:00",
    weeklyDay: 6,
    weeklyAt: "09:00",
  },
  email: {
    locale: "zh",
    sendWhenNoSignals: false,
    weeklyReport: true,
    failureAlerts: true,
  },
});

/** A book with one row per class, classes in the given order. */
export function testBook(classes: Record<string, string[]>): BookDefinition {
  const entries = Object.entries(classes);
  return {
    id: "test",
    name: { en: "Test", zh: "测试" },
    riskTarget: 0.2,
    maxPositionWeight: 0.1,
    capital: 100000,
    symbols: entries.flatMap(([, symbols]) => symbols),
    classOf: Object.fromEntries(
      entries.flatMap(([id, symbols]) => symbols.map((s) => [s, id])),
    ),
    classes: entries.map(([id, symbols]) => ({
      id,
      name: id,
      rows: [{ id: "all", symbols }],
    })),
  };
}

/** Bars whose session date is before `end` (the panel a run on that day would have seen). */
export function barsBefore(bars: Record<string, PriceBar[]>, end: string) {
  return Object.fromEntries(
    Object.entries(bars).map(([symbol, list]) => [
      symbol,
      list.filter((bar) => bar.timestamp.slice(0, 10) < end),
    ]),
  );
}
