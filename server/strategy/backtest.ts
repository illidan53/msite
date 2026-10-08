import {
  benchmarkIds,
  ruleFamilies,
  variantIds,
  type BacktestBookReport,
  type BacktestRun,
  type BacktestTests,
  type FamilyAdmission,
  type PerformanceStats,
  type RuleFamily,
  type RunId,
  type VariantId,
} from "../../shared/strategy";
import { ruleCatalog } from "../../shared/strategyRules";
import { configHash, type BookDefinition, type StrategyConfig } from "./config";
import { buildPortfolio } from "./portfolio";
import { ruleDiagnostics } from "./ruleCurves";
import {
  simulate,
  simulateBuyHold,
  simulateEqualWeight,
  type SimulationResult,
} from "./simulate";
import {
  deflatedSharpe,
  performanceStats,
  probabilityOfOverfitting,
  sharpeDifference,
  yearlyReturns,
} from "./stats";
import type {
  EngineOptions,
  Panel,
  PortfolioFrame,
  PortfolioOptions,
  SystemFrame,
} from "./types";

/**
 * The weekly backtest report (spec §6): every variant and benchmark on the
 * same evaluation window, statistics, significance tests, rule diagnostics
 * and attribution. The engine is injected so this module only depends on
 * the SystemFrame contract.
 */

export type ComputeSystem = (
  panel: Panel,
  book: BookDefinition,
  config: StrategyConfig,
  options?: EngineOptions,
) => SystemFrame;

export interface BacktestInput {
  panel: Panel;
  books: BookDefinition[];
  config: StrategyConfig;
  computeSystem: ComputeSystem;
  /** Persistent trial log keys from earlier runs (book:variant:configHash). */
  priorTrials: string[];
  failures: { symbol: string; message: string }[];
  onProgress?: (done: number, total: number) => void;
}

/** Event studies that were tried on the same data before this system (spec §6, DSR). */
export const LEGACY_TRIALS = 4;
const FAMILY_MIN_SESSIONS = 252;
const SHORT_WINDOW_SESSIONS = 504;
const JUMP_RETURN = 0.4;
const PBO_BLOCKS = 10;

export const trialKey = (book: string, variant: VariantId, hash: string) =>
  `${book}:${variant}:${hash}`;

/**
 * First session at or after evaluationMinSession where at least
 * evaluationEligibleShare of the symbols that have had any bar are eligible;
 * −1 when the data never gets there.
 */
export function evaluationStart(system: SystemFrame, config: StrategyConfig) {
  const { evaluationMinSession, evaluationEligibleShare } = config.engine;
  const closes = system.panelIndex.map((row) => system.panel.close[row]);
  const seen = new Uint8Array(system.symbols.length);
  let listed = 0;
  for (let t = 0; t < system.dates.length; t++) {
    closes.forEach((close, i) => {
      if (!seen[i] && close[t] > 0) {
        seen[i] = 1;
        listed++;
      }
    });
    if (t < evaluationMinSession || !listed) continue;
    const live = system.eligible.filter((e) => e[t] === 1).length;
    if (live >= evaluationEligibleShare * listed - 1e-9) return t;
  }
  return -1;
}

interface Plan {
  engine?: EngineOptions;
  portfolio?: PortfolioOptions;
  lot?: number;
}
const familyWeights = (family: RuleFamily) =>
  Object.fromEntries(
    ruleCatalog.filter((r) => r.family === family).map((r) => [r.id, 0]),
  );
const plans: Record<VariantId, Plan> = {
  core: {},
  long_short: { portfolio: { longShort: true } },
  trend_filter: { portfolio: { trendFilter: true } },
  vol_attenuation: { engine: { volAttenuation: true } },
  whole_shares: { lot: 1 },
  without_trend: { engine: { ruleWeights: familyWeights("trend") } },
  without_sector_trend: { engine: { ruleWeights: familyWeights("sector_trend") } },
  without_relative_momentum: {
    engine: { ruleWeights: familyWeights("relative_momentum") },
  },
  without_mean_reversion: { engine: { ruleWeights: familyWeights("mean_reversion") } },
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const round = (value: number | null | undefined, digits: number) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const r4 = (value: number | null | undefined) => round(value, 4);
const roundStats = (stats: PerformanceStats): PerformanceStats =>
  Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v]),
  ) as unknown as PerformanceStats;
const roundInterval = (interval: [number, number] | null) =>
  interval && ([r4(interval[0]), r4(interval[1])] as [number, number]);

interface RunResult {
  id: RunId;
  kind: BacktestRun["kind"];
  sim: SimulationResult;
  multiplier?: Float64Array;
  /** Window series as fractions of the previous close's equity. */
  returns: Float64Array;
  cost: Float64Array;
  traded: Float64Array;
  gross: Float64Array;
}

function windowSeries(
  id: RunId,
  kind: BacktestRun["kind"],
  sim: SimulationResult,
  start: number,
  end: number,
  frame?: PortfolioFrame,
): RunResult {
  const length = end - start + 1;
  const cost = new Float64Array(length);
  const traded = new Float64Array(length);
  for (let k = 0; k < length; k++) {
    const t = start + k;
    const base = t > 0 && t > sim.startIndex ? sim.equity[t - 1] : sim.capital;
    cost[k] = base > 0 ? sim.cost[t] / base : 0;
    traded[k] = base > 0 ? sim.traded[t] / base : 0;
  }
  return {
    id,
    kind,
    sim,
    multiplier: frame?.multiplier.slice(start, end + 1),
    returns: sim.returns.slice(start, end + 1),
    cost,
    traded,
    gross: sim.gross.slice(start, end + 1),
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

async function bookReport(
  input: BacktestInput,
  book: BookDefinition,
  trials: number,
  progress: () => void,
): Promise<BacktestBookReport> {
  const { panel, config, computeSystem } = input;
  const core = computeSystem(panel, book, config);
  const T = core.dates.length;
  const found = evaluationStart(core, config);
  const start = found >= 0 ? found : Math.max(0, T - 1);
  const end = T - 1;
  const dates = core.dates.slice(start, end + 1);
  const sessions = dates.length;
  const simOptions = { capital: book.capital, startIndex: start };

  const runs = new Map<RunId, RunResult>();
  const corePortfolio = buildPortfolio(core, config);
  for (const variant of variantIds) {
    const plan = plans[variant];
    const system = plan.engine ? computeSystem(panel, book, config, plan.engine) : core;
    const frame =
      system === core && !plan.portfolio
        ? corePortfolio
        : buildPortfolio(system, config, plan.portfolio);
    const sim = simulate(frame, config, {
      ...simOptions,
      lot: plan.lot,
      longShort: plan.portfolio?.longShort,
    });
    runs.set(variant, windowSeries(variant, "variant", sim, start, end, frame));
    progress();
    await tick();
  }
  const riskParity = buildPortfolio(core, config, { constantForecast: 10 });
  runs.set(
    "risk_parity_buy_hold",
    windowSeries(
      "risk_parity_buy_hold",
      "benchmark",
      simulate(riskParity, config, simOptions),
      start,
      end,
      riskParity,
    ),
  );
  progress();
  await tick();
  runs.set(
    "spy_buy_hold",
    windowSeries("spy_buy_hold", "benchmark", simulateBuyHold(core, config, simOptions), start, end),
  );
  progress();
  await tick();
  runs.set(
    "equal_weight_buy_hold",
    windowSeries(
      "equal_weight_buy_hold",
      "benchmark",
      simulateEqualWeight(core, config, simOptions),
      start,
      end,
    ),
  );
  progress();

  const get = (id: RunId) => runs.get(id)!;
  const reportRuns: BacktestRun[] = [...variantIds, ...benchmarkIds].map(get).map((run) => {
    const stats = performanceStats({
      dates,
      returns: run.returns,
      cost: run.cost,
      traded: run.traded,
      gross: run.gross,
      multiplier: run.multiplier,
      riskParity: get("risk_parity_buy_hold").returns,
      spy: get("spy_buy_hold").returns,
    });
    const curve = Array.from(
      run.sim.equity.subarray(start, end + 1),
      (v) => round((v / run.sim.capital) * 100, 2) ?? 0,
    );
    return {
      id: run.id,
      kind: run.kind,
      stats: roundStats(stats),
      yearly: yearlyReturns(dates, run.returns).map((y) => ({
        year: y.year,
        return: r4(y.return),
      })),
      curve,
    };
  });
  const coreRun = reportRuns.find((r) => r.id === "core")!;

  const difference = (a: RunId, b: RunId) => sharpeDifference(get(a).returns, get(b).returns);
  const rounded = (d: ReturnType<typeof difference>) => ({
    difference: r4(d.difference),
    interval: roundInterval(d.interval),
    z: r4(d.z),
    p: r4(d.p),
  });
  const families = ruleFamilies.map((family) => {
    const d = difference("core", `without_${family}` as VariantId);
    const status: FamilyAdmission =
      sessions < FAMILY_MIN_SESSIONS || !d.interval
        ? "insufficient"
        : d.interval[0] > 0
          ? "adds"
          : d.interval[1] < 0
            ? "detracts"
            : "neutral";
    const { difference: delta, interval } = rounded(d);
    return { family, difference: delta, interval, status };
  });
  const variantReturns = variantIds.map((id) => get(id).returns);
  const dsr = deflatedSharpe({ returns: get("core").returns, variants: variantReturns, trials });
  const pbo = probabilityOfOverfitting(variantReturns, PBO_BLOCKS);
  const tests: BacktestTests = {
    sharpeDifferences: (
      ["risk_parity_buy_hold", "spy_buy_hold", "equal_weight_buy_hold"] as RunId[]
    ).map((b) => ({ a: "core" as RunId, b, ...rounded(difference("core", b)) })),
    families,
    deflatedSharpe: {
      probability: r4(dsr.probability),
      trials: dsr.trials,
      effectiveTrials: r4(dsr.effectiveTrials),
      benchmarkSharpe: r4(dsr.benchmarkSharpe),
    },
    overfitting: { ...pbo, probability: r4(pbo.probability) },
  };

  const rules = ruleDiagnostics(core, start, end).map((rule) => ({
    ...rule,
    scalar: r4(rule.scalar),
    meanAbsForecast: r4(rule.meanAbsForecast),
    turnover: r4(rule.turnover),
    costPassRate: r4(rule.costPassRate),
    sharpe: r4(rule.sharpe),
    longOnlySharpe: r4(rule.longOnlySharpe),
    correlationToTrend: r4(rule.correlationToTrend),
    weight: r4(rule.weight) ?? 0,
  }));

  const coreSim = get("core").sim;
  const symbols = core.symbols.map((symbol, i) => ({
    symbol,
    class: core.classOf[i],
    contribution: coreSim.contribution[i] * 100,
    averageWeight: coreSim.averageWeight[i] * 100,
    trades: coreSim.trades[i],
  }));
  const classes = book.classes.map((c) => {
    const members = symbols.filter((s) => s.class === c.id);
    const sum = (key: "contribution" | "averageWeight") =>
      members.length ? r4(members.reduce((s, m) => s + m[key], 0)) : null;
    return {
      id: c.id,
      name: c.name,
      contribution: sum("contribution"),
      averageWeight: sum("averageWeight"),
    };
  });

  const eligibleAt = (t: number) =>
    core.symbols.flatMap((_, i) => (core.eligible[i][t] === 1 ? [i] : []));
  const fdmValues: number[] = [];
  for (let t = start; t <= end; t++)
    for (const i of eligibleAt(t))
      if (Number.isFinite(core.fdm[i][t])) fdmValues.push(core.fdm[i][t]);
  const idmWindow = Array.from(corePortfolio.idm.subarray(start, end + 1)).filter(
    Number.isFinite,
  );

  const bookSymbols = new Set([...book.symbols, panel.benchmark]);
  const failures = input.failures.filter((f) => bookSymbols.has(f.symbol));
  for (const symbol of core.missing)
    if (!failures.some((f) => f.symbol === symbol))
      failures.push({ symbol, message: "No bars" });
  const jumps: BacktestBookReport["dataQuality"]["jumps"] = [];
  core.panelIndex.forEach((row, i) => {
    const close = panel.close[row];
    let prev = -1;
    for (let t = 0; t < T; t++) {
      if (!(close[t] > 0)) continue;
      if (prev >= 0) {
        const r = close[t] / close[prev] - 1;
        if (Math.abs(r) > JUMP_RETURN)
          jumps.push({ symbol: core.symbols[i], date: core.dates[t], return: r4(r * 100)! });
      }
      prev = t;
    }
  });
  // Symbols still warming up (or not yet listed) when the evaluation starts.
  const shortHistory = core.symbols.filter((_, i) => {
    if (core.eligible[i][start] === 1) return false;
    const close = panel.close[core.panelIndex[i]];
    let seen = false;
    for (let t = 0; t <= start && !seen; t++) seen = close[t] > 0;
    return !seen || core.reason[i][start] === 2;
  });

  const warnings: BacktestBookReport["warnings"] = [];
  const offScale = rules.filter(
    (r) =>
      core.baseWeights[r.id] > 0 &&
      r.meanAbsForecast !== null &&
      (r.meanAbsForecast < 7 || r.meanAbsForecast > 13),
  );
  if (offScale.length)
    warnings.push({
      code: "forecast_scale",
      detail: offScale.map((r) => `${r.id} ${r.meanAbsForecast!.toFixed(1)}`).join(", "),
    });
  const { costSharpe, sharpe } = coreRun.stats;
  if (costSharpe !== null && sharpe !== null && costSharpe > sharpe / 3)
    warnings.push({
      code: "cost_budget",
      detail: `cost ${costSharpe.toFixed(2)} SR vs Sharpe ${sharpe.toFixed(2)}`,
    });
  if (sessions < SHORT_WINDOW_SESSIONS)
    warnings.push({ code: "short_window", detail: `${sessions} evaluation sessions` });
  if (failures.length)
    warnings.push({
      code: "data_failures",
      detail: failures.map((f) => f.symbol).join(", "),
    });
  if (jumps.length)
    warnings.push({
      code: "price_jumps",
      detail: jumps.map((j) => `${j.symbol} ${j.date} ${j.return}%`).join(", "),
    });
  const detracting = families.filter((f) => f.status === "detracts");
  if (detracting.length)
    warnings.push({
      code: "family_detracts",
      detail: detracting.map((f) => f.family).join(", "),
    });

  return {
    book: book.id,
    name: book.name,
    riskTarget: book.riskTarget * 100,
    capital: book.capital,
    universe: {
      symbols: book.symbols.length,
      eligibleAtStart: eligibleAt(start).length,
      classes: book.classes.map((c) => ({
        id: c.id,
        name: c.name,
        symbols: c.rows.reduce((s, r) => s + r.symbols.length, 0),
      })),
    },
    window: {
      dataStart: panel.dates[0] ?? "",
      start: dates[0] ?? "",
      end: dates.at(-1) ?? "",
      sessions,
    },
    dates,
    runs: reportRuns,
    tests,
    rules,
    classes,
    symbols: symbols.map((s) => ({
      ...s,
      contribution: r4(s.contribution),
      averageWeight: r4(s.averageWeight),
    })),
    idm: {
      last: r4(corePortfolio.idm[end]),
      average: r4(mean(idmWindow)),
    },
    fdm: {
      last: r4(mean(eligibleAt(end).map((i) => core.fdm[i][end]).filter(Number.isFinite))),
      average: r4(mean(fdmValues)),
    },
    warnings,
    dataQuality: { failures, jumps, shortHistory },
  };
}

/**
 * Runs every variant and benchmark for each book. Variants that only change
 * sizing or execution reuse the core SystemFrame; each engine variant's frame
 * is dropped once simulated. Yields to the event loop between runs.
 */
export async function runBacktest(
  input: BacktestInput,
): Promise<{ books: BacktestBookReport[]; trialKeys: string[] }> {
  const hash = configHash(input.config, input.books);
  const trialKeys = input.books.flatMap((book) =>
    variantIds.map((variant) => trialKey(book.id, variant, hash)),
  );
  const trials = new Set([...input.priorTrials, ...trialKeys]).size + LEGACY_TRIALS;
  const total = input.books.length * (variantIds.length + 3);
  let done = 0;
  const progress = () => input.onProgress?.(++done, total);
  const books: BacktestBookReport[] = [];
  for (const book of input.books) {
    books.push(await bookReport(input, book, trials, progress));
    await tick();
  }
  return { books, trialKeys };
}
