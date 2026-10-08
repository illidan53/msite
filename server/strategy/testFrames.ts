import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { RuleId } from "../../shared/strategy";
import { ruleCatalog, ruleIds } from "../../shared/strategyRules";
import {
  strategyConfigSchema,
  type BookDefinition,
  type StrategyConfig,
} from "./config";
import { seededRandom } from "./stats";
import type { EngineOptions, Panel, Series, SystemFrame } from "./types";

/**
 * Deterministic synthetic panels and SystemFrames for tests of the portfolio,
 * simulation and report layers without the real engine.
 */

/** The committed config/strategy.yaml. */
export function testConfig(): StrategyConfig {
  return strategyConfigSchema.parse(
    YAML.parse(readFileSync(new URL("../../config/strategy.yaml", import.meta.url), "utf8")),
  );
}

/** Weekday session dates from `start` (holidays are not modelled). */
export function sessionDates(count: number, start = "2022-01-03") {
  const dates: string[] = [];
  for (let day = Date.parse(`${start}T00:00:00Z`); dates.length < count; day += 864e5) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

export interface TestClass {
  id: string;
  rows: string[][];
}

export function testBook(
  classes: TestClass[],
  overrides: Partial<Omit<BookDefinition, "symbols" | "classes" | "classOf">> = {},
): BookDefinition {
  const symbols = classes.flatMap((c) => c.rows.flat());
  return {
    id: "test",
    name: { en: "Test book", zh: "测试组合" },
    riskTarget: 0.2,
    maxPositionWeight: 0.25,
    capital: 100_000,
    ...overrides,
    symbols,
    classOf: Object.fromEntries(classes.flatMap((c) => c.rows.flat().map((s) => [s, c.id]))),
    classes: classes.map((c) => ({
      id: c.id,
      name: c.id.toUpperCase(),
      rows: c.rows.map((symbols, r) => ({ id: `${c.id}-${r}`, symbols })),
    })),
  };
}

export interface TestPanelSpec {
  /** Non-benchmark symbols. */
  symbols: string[];
  sessions: number;
  start?: string;
  benchmark?: string;
  seed?: number;
  /** Daily return std of the random walks (default 1.5%). */
  dailyVol?: number;
  /** Daily drift of the random walks (default 0.03%). */
  drift?: number;
  /** Exact closes instead of the random walk (opens become the previous close). */
  close?: (symbol: string, t: number) => number;
  /** Sessions without a bar per symbol. */
  gaps?: Record<string, number[]>;
  /** First session with a bar per symbol (default 0). */
  firstBar?: Record<string, number>;
  /** Shares traded per session (default 1e7, about $1bn a day at $100). */
  volume?: number;
}

export function testPanel(spec: TestPanelSpec): Panel {
  const benchmark = spec.benchmark ?? "SPY";
  const symbols = [benchmark, ...spec.symbols.filter((s) => s !== benchmark)];
  const dates = sessionDates(spec.sessions, spec.start);
  const random = seededRandom(spec.seed ?? 7);
  const normal = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const vol = spec.dailyVol ?? 0.015;
  const drift = spec.drift ?? 0.0003;
  const series = () => symbols.map(() => new Float64Array(dates.length).fill(Number.NaN));
  const [open, high, low, close, volume] = [series(), series(), series(), series(), series()];
  symbols.forEach((symbol, i) => {
    const gaps = new Set(spec.gaps?.[symbol] ?? []);
    const first = spec.firstBar?.[symbol] ?? 0;
    let last = 100 + 10 * i;
    for (let t = 0; t < dates.length; t++) {
      const shock = normal();
      const gap = normal();
      if (t < first || gaps.has(t)) continue;
      const c = spec.close ? spec.close(symbol, t) : last * (1 + drift + vol * shock);
      const o = spec.close ? last : last * (1 + 0.3 * vol * gap);
      open[i][t] = o;
      close[i][t] = c;
      high[i][t] = Math.max(o, c) * 1.002;
      low[i][t] = Math.min(o, c) * 0.998;
      volume[i][t] = spec.volume ?? 1e7;
      last = c;
    }
  });
  return {
    dates,
    symbols,
    index: Object.fromEntries(symbols.map((s, i) => [s, i])),
    open,
    high,
    low,
    close,
    volume,
    benchmark,
  };
}

export interface TestSystemSpec {
  /** Blended annual σ as a fraction (default 0.25). */
  sigma?: number | ((i: number, t: number) => number);
  /** First eligible session, for all symbols or per symbol (default 0). */
  eligibleFrom?: number | Record<string, number>;
  /** Combined forecast; by default the weighted mean of the rule forecasts. */
  forecast?: (i: number, t: number) => number;
  /** Capped forecast of each rule (default 10). */
  ruleForecast?: (rule: RuleId, i: number, t: number) => number;
  /** Trailing dollar volume (default 1e9, the cheapest tier). */
  dollarVolume?: number;
  fdm?: number;
  trendFilter?: (i: number, t: number) => number;
  /** Rule pass flag for the speed limit (default 1). */
  costPass?: (rule: RuleId, i: number, t: number) => boolean;
}

const tierBps = (config: StrategyConfig, dollarVolume: number) =>
  (config.costs.tiers.find((t) => dollarVolume >= t.minDollarVolume) ?? config.costs.tiers.at(-1)!)
    .bps;

/**
 * A SystemFrame over an existing panel. Engine options act on the synthetic
 * forecasts: rule weights override the catalog and vol attenuation damps
 * the trend-like rules by 20%.
 */
export function systemFromPanel(
  panel: Panel,
  book: BookDefinition,
  config: StrategyConfig,
  spec: TestSystemSpec = {},
  options: EngineOptions = {},
): SystemFrame {
  const T = panel.dates.length;
  const symbols = book.symbols.filter((s) => panel.index[s] !== undefined);
  const panelIndex = symbols.map((s) => panel.index[s]);
  const hasBar = (i: number, t: number) => panel.close[panelIndex[i]][t] > 0;
  const series = (f: (i: number, t: number) => number) =>
    symbols.map((_, i) => Float64Array.from({ length: T }, (_, t) => f(i, t)));
  const firstEligible = (i: number) =>
    typeof spec.eligibleFrom === "number"
      ? spec.eligibleFrom
      : (spec.eligibleFrom?.[symbols[i]] ?? 0);
  const sigmaAt = (i: number, t: number) =>
    hasBar(i, t)
      ? typeof spec.sigma === "function"
        ? spec.sigma(i, t)
        : (spec.sigma ?? 0.25)
      : Number.NaN;
  const sigma = series(sigmaAt);
  const eligible = symbols.map((_, i) =>
    Uint8Array.from({ length: T }, (_, t) =>
      hasBar(i, t) && t >= firstEligible(i) && sigma[i][t] > 0 ? 1 : 0,
    ),
  );
  const reason = symbols.map((_, i) =>
    Uint8Array.from({ length: T }, (_, t) =>
      eligible[i][t] ? 0 : hasBar(i, t) ? 2 : 1,
    ),
  );
  const baseWeights = Object.fromEntries(
    ruleCatalog.map((r) => [r.id, options.ruleWeights?.[r.id] ?? r.weight]),
  ) as Record<RuleId, number>;
  const damp = (rule: RuleId) =>
    options.volAttenuation &&
    ["trend", "sector_trend", "relative_momentum"].includes(
      ruleCatalog.find((r) => r.id === rule)!.family,
    )
      ? 0.8
      : 1;
  const forecasts = Object.fromEntries(
    ruleIds.map((rule) => [
      rule,
      series((i, t) =>
        hasBar(i, t)
          ? Math.max(-20, Math.min(20, (spec.ruleForecast?.(rule, i, t) ?? 10) * damp(rule)))
          : Number.NaN,
      ),
    ]),
  ) as Record<RuleId, Series[]>;
  const fdmValue = spec.fdm ?? 1.2;
  const cap = config.engine.forecastCap;
  const combined = series((i, t) => {
    if (!eligible[i][t]) return Number.NaN;
    if (spec.forecast) return spec.forecast(i, t);
    let sum = 0,
      weight = 0;
    for (const rule of ruleIds)
      if (baseWeights[rule] > 0 && Number.isFinite(forecasts[rule][i][t])) {
        sum += baseWeights[rule] * forecasts[rule][i][t];
        weight += baseWeights[rule];
      }
    return weight ? Math.max(-cap, Math.min(cap, (fdmValue * sum) / weight)) : Number.NaN;
  });
  const dollarVolume = series((i, t) => (hasBar(i, t) ? (spec.dollarVolume ?? 1e9) : Number.NaN));
  const classIds = [...new Set(symbols.map((s) => book.classOf[s]))];
  return {
    book,
    panel,
    dates: panel.dates,
    symbols,
    classOf: symbols.map((s) => book.classOf[s]),
    panelIndex,
    missing: book.symbols.filter((s) => panel.index[s] === undefined),
    sigma,
    dollarVolume,
    costBps: series((i, t) => (hasBar(i, t) ? tierBps(config, dollarVolume[i][t]) : Number.NaN)),
    eligible,
    reason,
    baseWeights,
    forecasts,
    costPass: Object.fromEntries(
      ruleIds.map((rule) => [
        rule,
        symbols.map((_, i) =>
          Uint8Array.from({ length: T }, (_, t) =>
            (spec.costPass?.(rule, i, t) ?? true) ? 1 : 0,
          ),
        ),
      ]),
    ) as Record<RuleId, Uint8Array[]>,
    scalars: Object.fromEntries(
      ruleCatalog.map((r) => [r.id, new Float64Array(T).fill(r.scalar ?? Number.NaN)]),
    ) as Record<RuleId, Series>,
    turnover: Object.fromEntries(
      ruleIds.map((rule) => [rule, new Float64Array(T).fill(12)]),
    ) as Record<RuleId, Series>,
    fdm: series((i, t) => (eligible[i][t] ? fdmValue : Number.NaN)),
    combined,
    trendFilter: series((i, t) =>
      hasBar(i, t) ? (spec.trendFilter?.(i, t) ?? 10) : Number.NaN,
    ),
    classIndex: Object.fromEntries(classIds.map((c) => [c, new Float64Array(T)])),
  };
}

export interface TestFrameSpec extends TestSystemSpec, Omit<TestPanelSpec, "symbols" | "sessions"> {
  classes?: TestClass[];
  sessions?: number;
  book?: Partial<Omit<BookDefinition, "symbols" | "classes" | "classOf">>;
  config?: StrategyConfig;
}

/** Two classes over five symbols by default: A = {AAA, AAB | AAC}, B = {BBA, BBB}. */
export const defaultClasses: TestClass[] = [
  { id: "a", rows: [["AAA", "AAB"], ["AAC"]] },
  { id: "b", rows: [["BBA", "BBB"]] },
];

export function testSystem(spec: TestFrameSpec = {}): SystemFrame {
  const classes = spec.classes ?? defaultClasses;
  const book = testBook(classes, spec.book);
  const panel = testPanel({
    ...spec,
    symbols: book.symbols,
    sessions: spec.sessions ?? 400,
  });
  return systemFromPanel(panel, book, spec.config ?? testConfig(), spec);
}

/** The same frame as if the data ended after `length` sessions (for causality tests). */
export function sliceSystem(system: SystemFrame, length: number): SystemFrame {
  const cut = <A extends Float64Array | Uint8Array>(a: A) => a.slice(0, length) as A;
  const cutAll = <A extends Float64Array | Uint8Array>(list: A[]) => list.map(cut);
  const panel = system.panel;
  const mapRecord = <V, W>(record: Record<string, V>, f: (v: V) => W) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v)]));
  return {
    ...system,
    panel: {
      ...panel,
      dates: panel.dates.slice(0, length),
      open: cutAll(panel.open),
      high: cutAll(panel.high),
      low: cutAll(panel.low),
      close: cutAll(panel.close),
      volume: cutAll(panel.volume),
    },
    dates: system.dates.slice(0, length),
    sigma: cutAll(system.sigma),
    dollarVolume: cutAll(system.dollarVolume),
    costBps: cutAll(system.costBps),
    eligible: cutAll(system.eligible),
    reason: cutAll(system.reason),
    forecasts: mapRecord(system.forecasts, cutAll) as SystemFrame["forecasts"],
    costPass: mapRecord(system.costPass, cutAll) as SystemFrame["costPass"],
    scalars: mapRecord(system.scalars, cut) as SystemFrame["scalars"],
    turnover: mapRecord(system.turnover, cut) as SystemFrame["turnover"],
    fdm: cutAll(system.fdm),
    combined: cutAll(system.combined),
    trendFilter: cutAll(system.trendFilter),
    classIndex: mapRecord(system.classIndex, cut),
  };
}
