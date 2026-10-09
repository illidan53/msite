/**
 * Quant System: a forecast-combination, volatility-targeted portfolio system
 * after Robert Carver, Advanced Futures Trading Strategies (Harriman House,
 * 2023), adapted to long-only daily US stock and ETF bars.
 *
 * Units: every return-like number is a percent (12.3 means 12.3%); weights
 * are percent of capital; forecasts are on Carver's scale (average |f| 10,
 * capped at ±20); sigma is annualised percent volatility. Dates are New York
 * session dates (YYYY-MM-DD).
 */

/** Bump when any rule, sizing, execution or stored shape changes. */
export const STRATEGY_ENGINE_VERSION = 1;

export interface Bilingual {
  en: string;
  zh: string;
}

export type RuleFamily =
  "trend" | "sector_trend" | "relative_momentum" | "mean_reversion";
export const ruleFamilies: RuleFamily[] = [
  "trend",
  "sector_trend",
  "relative_momentum",
  "mean_reversion",
];

export type RuleId =
  | "ewmac8"
  | "ewmac16"
  | "ewmac32"
  | "ewmac64"
  | "breakout40"
  | "breakout80"
  | "breakout160"
  | "breakout320"
  | "accel32"
  | "accel64"
  | "assettrend16"
  | "assettrend32"
  | "assettrend64"
  | "relmom40"
  | "relmom80"
  | "mr5"
  | "mr20";

/** Portfolio variants re-run by every backtest. `core` is the live system. */
export type VariantId =
  | "core"
  | "long_short"
  | "trend_filter"
  | "vol_attenuation"
  | "whole_shares"
  | "without_trend"
  | "without_sector_trend"
  | "without_relative_momentum"
  | "without_mean_reversion";
export const variantIds: VariantId[] = [
  "core",
  "long_short",
  "trend_filter",
  "vol_attenuation",
  "whole_shares",
  "without_trend",
  "without_sector_trend",
  "without_relative_momentum",
  "without_mean_reversion",
];
export type BenchmarkId =
  "spy_buy_hold" | "equal_weight_buy_hold" | "risk_parity_buy_hold";
export const benchmarkIds: BenchmarkId[] = [
  "spy_buy_hold",
  "equal_weight_buy_hold",
  "risk_parity_buy_hold",
];
export type RunId = VariantId | BenchmarkId;

export interface PerformanceStats {
  start: string;
  end: string;
  sessions: number;
  /** Compounded return over the whole window. */
  totalReturn: number | null;
  cagr: number | null;
  /** Mean daily return × 256 (Carver's convention). */
  annualReturn: number | null;
  /** Daily standard deviation × 16. */
  annualVol: number | null;
  /** annualReturn ÷ annualVol with a zero risk-free rate. */
  sharpe: number | null;
  /** Lo (2002) iid standard error of the annual Sharpe ratio. */
  sharpeError: number | null;
  sortino: number | null;
  /** Positive numbers: peak-to-trough on the compounded equity curve. */
  maxDrawdown: number | null;
  averageDrawdown: number | null;
  calmar: number | null;
  /** Bias-corrected skew of monthly (summed) returns. */
  monthlySkew: number | null;
  /** Carver/pysystemtrade demeaned quantile tail ratios; 1 = Gaussian. */
  lowerTail: number | null;
  upperTail: number | null;
  /** Share of non-zero days with a gain. */
  hitRate: number | null;
  /** Traded value per year ÷ average absolute position value. */
  turnover: number | null;
  /** Costs per year as % of capital, and in Sharpe-ratio units. */
  annualCost: number | null;
  costSharpe: number | null;
  averageGross: number | null;
  /** Share of sessions on which the risk overlay scaled positions down. */
  overlayBinding: number | null;
  /** Daily OLS against the risk-parity benchmark; alpha × 256. */
  alpha: number | null;
  beta: number | null;
  correlation: number | null;
  /** Daily OLS against SPY. */
  alphaSpy: number | null;
  betaSpy: number | null;
}

export interface BacktestRun {
  id: RunId;
  kind: "variant" | "benchmark";
  stats: PerformanceStats;
  yearly: { year: number; return: number | null }[];
  /** Equity index (100 at the window start) aligned to the report's dates. */
  curve: number[];
}

export interface RuleDiagnostics {
  id: RuleId;
  family: RuleFamily;
  /** Scalar in force at the window end; null while a pooled scalar is still warming up. */
  scalar: number | null;
  scalarSource: "book" | "pooled";
  /** Realised mean |capped forecast|, pooled, zeros included. */
  meanAbsForecast: number | null;
  /**
   * Sign-gated rules (mr5, mr20) only: mean |f| on gate-open sessions, the
   * population their scalars are calibrated on; null for other rules. The
   * 7–13 scale check uses this when present, else meanAbsForecast.
   */
  gateOpenMeanAbsForecast: number | null;
  /** Pooled forecast turnover per year: 256 × mean|Δf| ÷ 10. */
  turnover: number | null;
  /** Share of eligible symbols where the rule passes the 0.15 SR speed limit. */
  costPassRate: number | null;
  /** Pooled rule account curve after SR-unit costs, signed (Carver) and long-only. */
  sharpe: number | null;
  longOnlySharpe: number | null;
  /** Pooled weekly correlation with the equal-weighted ewmac forecasts. */
  correlationToTrend: number | null;
  /** Configured weight in percent before redistribution. */
  weight: number;
}

export type FamilyAdmission = "adds" | "neutral" | "detracts" | "insufficient";

export interface BacktestTests {
  /** Paired 42-session block bootstrap and Jobson–Korkie/Memmel z on Sharpe differences. */
  sharpeDifferences: {
    a: RunId;
    b: RunId;
    difference: number | null;
    interval: [number, number] | null;
    z: number | null;
    p: number | null;
  }[];
  /** core minus core-without-family; admission follows the 95% interval. */
  families: {
    family: RuleFamily;
    difference: number | null;
    interval: [number, number] | null;
    status: FamilyAdmission;
  }[];
  /** Bailey & López de Prado deflated Sharpe ratio of `core` (not from AFTS). */
  deflatedSharpe: {
    probability: number | null;
    trials: number;
    effectiveTrials: number | null;
    benchmarkSharpe: number | null;
  };
  /** Probability of backtest overfitting via CSCV across variants (not from AFTS). */
  overfitting: { probability: number | null; splits: number; variants: number };
}

export type WarningCode =
  | "forecast_scale"
  | "cost_budget"
  | "short_window"
  | "data_failures"
  | "history_trimmed"
  | "price_jumps"
  | "family_detracts";

/**
 * Warning details are locale-neutral (symbols, dates, numbers, rule and
 * family ids) so the UI and emails can label them in either language:
 * forecast_scale "ewmac64 7.0, mr20 16.0"; cost_budget "0.12/1.42" (cost SR /
 * Sharpe); short_window "312" (sessions); data_failures and history_trimmed
 * symbol lists; price_jumps "META 2022-06-09 +1394.7%, … +64" (top 10 by size,
 * then how many more); family_detracts family ids.
 */
export interface BacktestWarning {
  code: WarningCode;
  detail: string;
}

export interface BacktestBookReport {
  book: string;
  name: Bilingual;
  riskTarget: number;
  capital: number;
  universe: {
    symbols: number;
    eligibleAtStart: number;
    classes: { id: string; name: string; symbols: number }[];
  };
  window: {
    dataStart: string;
    start: string;
    end: string;
    sessions: number;
  };
  /** Evaluation-window session dates; every run's curve aligns with these. */
  dates: string[];
  runs: BacktestRun[];
  tests: BacktestTests;
  rules: RuleDiagnostics[];
  classes: {
    id: string;
    name: string;
    contribution: number | null;
    averageWeight: number | null;
  }[];
  symbols: {
    symbol: string;
    class: string;
    contribution: number | null;
    averageWeight: number | null;
    trades: number;
  }[];
  idm: { last: number | null; average: number | null };
  fdm: { last: number | null; average: number | null };
  warnings: BacktestWarning[];
  dataQuality: {
    /** Symbols without usable bars (failed fetch or no history). */
    failures: { symbol: string; message: string }[];
    /** Symbols whose history before `date` was dropped as a different security. */
    trimmed: { symbol: string; date: string; return: number }[];
    jumps: { symbol: string; date: string; return: number }[];
    shortHistory: string[];
  };
}

export interface BacktestReport {
  version: typeof STRATEGY_ENGINE_VERSION;
  id: string;
  createdAt: string;
  completedAt: string;
  trigger: "schedule" | "manual";
  /** Latest completed session in the data. */
  asOf: string;
  configHash: string;
  books: BacktestBookReport[];
}

export interface BacktestReportSummary {
  id: string;
  createdAt: string;
  asOf: string;
  trigger: BacktestReport["trigger"];
  books: {
    book: string;
    sharpe: number | null;
    cagr: number | null;
    maxDrawdown: number | null;
  }[];
}

export type SignalAction = "entry" | "add" | "trim" | "exit";

export interface RuleContribution {
  rule: RuleId;
  /** Weight × capped forecast × FDM, i.e. this rule's share of the combined forecast. */
  contribution: number;
}

export interface Signal {
  /** `${book}:${asOf}:${symbol}` */
  id: string;
  book: string;
  symbol: string;
  class: string;
  /** Decision session: computed after this close, for the next session's open. */
  asOf: string;
  action: SignalAction;
  fromShares: number;
  toShares: number;
  /** Signed share change. */
  shares: number;
  /** Close of the decision session; the fill price is the next open. */
  price: number;
  notional: number;
  fromWeight: number;
  toWeight: number;
  forecast: number | null;
  /** The (at most) three non-zero rule contributions largest in size. */
  drivers: RuleContribution[];
  reason: "forecast" | "removed" | "ineligible";
  fill?: { date: string; price: number; cost: number } | { cancelled: string };
}

export interface SignalRecord extends Signal {
  emailed: boolean;
}

export type IneligibleReason =
  "no_bar" | "warmup" | "stale" | "illiquid" | "cost";

export interface SymbolRow {
  symbol: string;
  class: string;
  close: number | null;
  sigma: number | null;
  /** Combined, capped, signed forecast; the long-only system holds max(0, f). */
  forecast: number | null;
  /** Each family's weighted average capped forecast. */
  families: Record<RuleFamily, number | null>;
  rules: Partial<Record<RuleId, number | null>>;
  /** Rules dropped for this symbol by the speed limit. */
  costFiltered: RuleId[];
  fdm: number | null;
  instrumentWeight: number | null;
  /** Position weight at forecast 10 after IDM, risk target and overlay. */
  averageWeight: number | null;
  targetWeight: number | null;
  heldShares: number;
  heldWeight: number;
  eligible: boolean;
  reason?: IneligibleReason;
}

export type OverlayLimit =
  "gross" | "normal_risk" | "correlation_shock" | "jump_risk";

export interface PaperSummary {
  inception: string;
  lastSession: string;
  capital: number;
  equity: number;
  cash: number;
  dayReturn: number | null;
  totalReturn: number | null;
  /** SPY price return over the same sessions. */
  benchmarkReturn: number | null;
  positions: number;
  gross: number;
}

export interface BookSnapshot {
  book: string;
  name: Bilingual;
  /** Class ids used by rows and signals, with their display names. */
  classes: { id: string; name: string }[];
  asOf: string;
  configHash: string;
  idm: number | null;
  fdm: number | null;
  overlay: { multiplier: number; limit: OverlayLimit | null };
  gross: number;
  rows: SymbolRow[];
  /** Orders decided at `asOf`'s close for the next open. */
  signals: Signal[];
  paper: PaperSummary;
}

export interface LatestSnapshot {
  version: typeof STRATEGY_ENGINE_VERSION;
  createdAt: string;
  asOf: string;
  trigger: "schedule" | "manual";
  books: BookSnapshot[];
}

export interface PaperPosition {
  symbol: string;
  shares: number;
  averageCost: number;
  lastClose: number;
  lastDate: string;
}
export interface PaperFill {
  date: string;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  cost: number;
  signalId: string;
}
export interface PaperEvent {
  date: string;
  kind: "inception" | "split" | "cancel" | "config" | "removed";
  symbol?: string;
  detail: string;
}
export interface PaperOrder {
  signalId: string;
  symbol: string;
  /** Signed share change, filled at the next open. */
  shares: number;
  decidedAt: string;
  /** Decision-session close, to rescale the order if a split lands before the fill. */
  decisionClose?: number;
  /** Sessions this order has already waited for a bar (cancelled after one). */
  waited: number;
}
/** Forward paper trading; never recomputed from history. */
export interface PaperLedger {
  version: 1;
  book: string;
  inception: string;
  capital: number;
  configHash: string;
  cash: number;
  positions: Record<string, PaperPosition>;
  pending: PaperOrder[];
  lastSession: string;
  equity: { date: string; value: number; benchmark: number | null }[];
  fills: PaperFill[];
  events: PaperEvent[];
}

export interface RunRecord {
  at: string;
  trigger: "schedule" | "manual";
  status: "complete" | "skipped" | "failed";
  asOf?: string;
  message?: string;
  emailed?: boolean;
}

export interface StrategyJob {
  id: string;
  kind: "daily" | "backtest";
  trigger: "schedule" | "manual";
  startedAt: string;
  step: "fetch" | "compute" | "simulate" | "report" | "email";
  done: number;
  total: number;
}

export interface StrategyState {
  version: typeof STRATEGY_ENGINE_VERSION;
  books: {
    id: string;
    name: Bilingual;
    symbols: number;
    capital: number;
    riskTarget: number;
  }[];
  scheduler: {
    enabled: boolean;
    timezone: string;
    dailyAt: string;
    weeklyDay: number;
    weeklyAt: string;
    lastDaily: RunRecord | null;
    lastBacktest: RunRecord | null;
    nextDaily: string | null;
    nextBacktest: string | null;
  };
  /** Recipient addresses are never exposed. */
  email: {
    configured: boolean;
    transport: "ses" | "smtp" | "none";
    lastSent: { at: string; kind: OutboxEntry["kind"]; status: OutboxEntry["status"] } | null;
  };
  latest: { asOf: string; createdAt: string; signals: number } | null;
  latestReport: BacktestReportSummary | null;
  job: StrategyJob | null;
  lastFailure: { at: string; job: StrategyJob["kind"]; message: string } | null;
}

export interface OutboxEntry {
  id: string;
  createdAt: string;
  kind: "signals" | "report" | "failure" | "test";
  subject: string;
  status: "sent" | "failed" | "disabled";
  transport: StrategyState["email"]["transport"];
  error?: string;
}

/** Latest 252 sessions of one symbol's system state. */
export interface SymbolChart {
  book: string;
  symbol: string;
  asOf: string;
  dates: string[];
  close: (number | null)[];
  forecast: (number | null)[];
  families: Record<RuleFamily, (number | null)[]>;
  /** Target weight (%) after the long-only floor and overlay. */
  targetWeight: (number | null)[];
}
