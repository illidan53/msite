import type { RuleId } from "../../shared/strategy";
import { ruleCatalog, ruleIds } from "../../shared/strategyRules";
import { strategyConfigSchema, type BookDefinition, type StrategyConfig } from "./config";
import type { Panel, PortfolioFrame, Series, SystemFrame } from "./types";

/**
 * Hand-built PortfolioFrame fixtures for the paper, signal and e-mail tests.
 * Only the fields paper trading reads carry data; engine-only fields are NaN.
 */

export const opsConfig: StrategyConfig = strategyConfigSchema.parse({
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
      id: "stocks",
      name: { en: "Stock book", zh: "个股组合" },
      source: "symbols",
      className: "test",
      symbols: ["A", "B"],
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
  email: { locale: "zh", sendWhenNoSignals: false, weeklyReport: true, failureAlerts: true },
});

/** `n` weekday session dates starting at `start` (no holidays). */
export function sessionDates(start: string, n: number) {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface FrameSymbolSpec {
  symbol: string;
  class?: string;
  close: number[];
  /** Defaults to the close. */
  open?: number[];
  /** Target weight as a fraction; NaN means no target. */
  target: number[];
  /** Weight at forecast 10; defaults to 0.1. */
  average?: number[];
  /** 1 eligible, 0 not; defaults to 1 wherever the close is finite. */
  eligible?: number[];
  /** Defaults to $1bn (3 bps tier). */
  dollarVolume?: number[];
  combined?: number[];
}
export interface FrameSpec {
  book?: string;
  dates: string[];
  /** SPY closes; defaults to 400 + t. */
  benchmark?: number[];
  symbols: FrameSymbolSpec[];
  /** Book symbols without any bar (SystemFrame.missing). */
  missing?: string[];
  /** Panel rows outside the book, e.g. a symbol that left it but is still fetched. */
  panelOnly?: { symbol: string; close: number[]; open?: number[] }[];
}

const series = (values: number[]) => Float64Array.from(values);
const nan = (n: number) => new Float64Array(n).fill(Number.NaN);
const perRule = <T>(make: () => T) =>
  Object.fromEntries(ruleIds.map((id) => [id, make()])) as Record<RuleId, T>;

export function buildFrame(spec: FrameSpec): PortfolioFrame {
  const n = spec.dates.length;
  const fixed = (values: number[] | undefined, fallback: (t: number) => number) =>
    series(Array.from({ length: n }, (_, t) => values?.[t] ?? fallback(t)));
  const rows = [
    {
      symbol: "SPY",
      close: fixed(spec.benchmark, (t) => 400 + t),
      open: fixed(spec.benchmark, (t) => 400 + t),
    },
    ...spec.symbols.map((s) => ({
      symbol: s.symbol,
      close: fixed(s.close, () => Number.NaN),
      open: fixed(s.open ?? s.close, () => Number.NaN),
    })),
    ...(spec.panelOnly ?? []).map((s) => ({
      symbol: s.symbol,
      close: fixed(s.close, () => Number.NaN),
      open: fixed(s.open ?? s.close, () => Number.NaN),
    })),
  ];
  const panel: Panel = {
    dates: spec.dates,
    symbols: rows.map((r) => r.symbol),
    index: Object.fromEntries(rows.map((r, i) => [r.symbol, i])),
    open: rows.map((r) => r.open),
    high: rows.map((r) => r.close),
    low: rows.map((r) => r.close),
    close: rows.map((r) => r.close),
    volume: rows.map(() => fixed(undefined, () => 1e6)),
    benchmark: "SPY",
  };
  const symbols = spec.symbols.map((s) => s.symbol);
  const classOf = spec.symbols.map((s) => s.class ?? "test");
  const bookSymbols = [...symbols, ...(spec.missing ?? [])];
  const book: BookDefinition = {
    id: spec.book ?? "stocks",
    name: { en: "Stock book", zh: "个股组合" },
    riskTarget: 0.2,
    maxPositionWeight: 0.1,
    capital: 100000,
    symbols: bookSymbols,
    classOf: Object.fromEntries(
      bookSymbols.map((s) => [s, spec.symbols.find((x) => x.symbol === s)?.class ?? "test"]),
    ),
    classes: [{ id: "test", name: "Test", rows: [{ id: "all", symbols: bookSymbols }] }],
  };
  const eligible = spec.symbols.map(
    (s, i) =>
      new Uint8Array(
        Array.from({ length: n }, (_, t) =>
          s.eligible ? s.eligible[t] : Number.isFinite(rows[i + 1].close[t]) ? 1 : 0,
        ),
      ),
  );
  const perSymbol = (make: () => Series) => spec.symbols.map(make);
  const system: SystemFrame = {
    book,
    panel,
    dates: spec.dates,
    symbols,
    classOf,
    panelIndex: symbols.map((s) => panel.index[s]),
    missing: spec.missing ?? [],
    sigma: perSymbol(() => fixed(undefined, () => 0.3)),
    dollarVolume: spec.symbols.map((s) => fixed(s.dollarVolume, () => 1e9)),
    costBps: perSymbol(() => fixed(undefined, () => 3)),
    eligible,
    reason: eligible.map((e) => e.map((v) => (v ? 0 : 1))),
    baseWeights: Object.fromEntries(ruleCatalog.map((r) => [r.id, r.weight])) as Record<
      RuleId,
      number
    >,
    forecasts: perRule(() => perSymbol(() => nan(n))),
    costPass: perRule(() => spec.symbols.map(() => new Uint8Array(n).fill(1))),
    scalars: perRule(() => nan(n)),
    turnover: perRule(() => nan(n)),
    fdm: perSymbol(() => fixed(undefined, () => 1)),
    combined: spec.symbols.map((s) => fixed(s.combined, (t) => s.target[t] * 100)),
    trendFilter: perSymbol(() => nan(n)),
    classIndex: { test: nan(n) },
  };
  return {
    system,
    idm: fixed(undefined, () => 1),
    instrumentWeight: perSymbol(() => fixed(undefined, () => 1 / Math.max(1, symbols.length))),
    forecast: spec.symbols.map((s) => fixed(s.combined, (t) => Math.max(0, s.target[t] * 100))),
    averageWeight: spec.symbols.map((s) => fixed(s.average, () => 0.1)),
    targetWeight: spec.symbols.map((s) => fixed(s.target, () => Number.NaN)),
    multiplier: fixed(undefined, () => 1),
    limit: new Uint8Array(n),
    gross: fixed(undefined, (t) =>
      spec.symbols.reduce((sum, s) => sum + Math.abs(s.target[t] || 0), 0),
    ),
  };
}

/** The same spec cut to its first `length` sessions (what an earlier run saw). */
export function sliceSpec(spec: FrameSpec, length: number): FrameSpec {
  const cut = (values: number[] | undefined) => values?.slice(0, length);
  return {
    ...spec,
    dates: spec.dates.slice(0, length),
    benchmark: cut(spec.benchmark),
    symbols: spec.symbols.map((s) => ({
      ...s,
      close: s.close.slice(0, length),
      open: cut(s.open),
      target: s.target.slice(0, length),
      average: cut(s.average),
      eligible: cut(s.eligible),
      dollarVolume: cut(s.dollarVolume),
      combined: cut(s.combined),
    })),
    panelOnly: spec.panelOnly?.map((s) => ({
      ...s,
      close: s.close.slice(0, length),
      open: cut(s.open),
    })),
  };
}
