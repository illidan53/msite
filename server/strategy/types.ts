import type { OverlayLimit, RuleId } from "../../shared/strategy";
import type { BookDefinition } from "./config";

/**
 * Per-session series aligned to Panel.dates. NaN means "no value" (no bar,
 * warm-up, unavailable); never use null or undefined inside a Series.
 */
export type Series = Float64Array;

/** Completed daily bars of every symbol on the benchmark's session calendar. */
export interface Panel {
  /** Benchmark (SPY) completed sessions, ascending. */
  dates: string[];
  /** Benchmark first, then every other symbol that has at least one bar. */
  symbols: string[];
  index: Record<string, number>;
  open: Series[];
  high: Series[];
  low: Series[];
  close: Series[];
  volume: Series[];
  benchmark: string;
}

/** Engine knobs that variants change; everything else comes from config. */
export interface EngineOptions {
  /** Percent weights overriding the catalog; 0 removes a rule (its weight is redistributed). */
  ruleWeights?: Partial<Record<RuleId, number>>;
  /** AFTS Strategy 13 regime multiplier on trend-like raw forecasts (default off). */
  volAttenuation?: boolean;
}

/**
 * Output of computeSystem: everything decided from data up to and including
 * each session's close. Index i addresses `symbols`, index t addresses dates.
 */
export interface SystemFrame {
  book: BookDefinition;
  dates: string[];
  /** Book symbols present in the panel, in book order. */
  symbols: string[];
  classOf: string[];
  /** symbols[i] → Panel row. */
  panelIndex: number[];
  /** Book symbols without any bar (reported as data failures). */
  missing: string[];
  /** Blended annualised vol as a fraction (0.32 = 32%). */
  sigma: Series[];
  /** Trailing 60-session median close × volume, used for cost tiers. */
  dollarVolume: Series[];
  /** One-way cost in bps for a trade decided at t (tier only, no SEC fee). */
  costBps: Series[];
  /** 1 when the symbol may hold a position after t's close. */
  eligible: Uint8Array[];
  /** Ineligibility codes per session: 0 eligible, 1 no_bar, 2 warmup, 3 stale, 4 illiquid, 5 cost. */
  reason: Uint8Array[];
  /** Base percent weights after EngineOptions, before availability redistribution. */
  baseWeights: Record<RuleId, number>;
  /** Scaled, capped forecasts (NaN while the rule is warming up or undefined). */
  forecasts: Record<RuleId, Series[]>;
  /** 1 when the rule passes the per-symbol speed limit at t (re-evaluated monthly). */
  costPass: Record<RuleId, Uint8Array[]>;
  /** Scalar in force at t (book constant, or pooled expanding estimate; NaN while warming up). */
  scalars: Record<RuleId, Series>;
  /** Pooled expanding forecast turnover per year at t. */
  turnover: Record<RuleId, Series>;
  /** Smoothed forecast diversification multiplier per symbol. */
  fdm: Series[];
  /** Combined forecast: clip(FDM × Σ w f, ±cap), signed; NaN when ineligible. */
  combined: Series[];
  /** AFTS Strategy 5 filter: 10 when EWMA64(close) ≥ EWMA256(close), else 0. */
  trendFilter: Series[];
  /** Cumulated median vol-normalised return per class (AFTS Strategy 18 index). */
  classIndex: Record<string, Series>;
}

export interface PortfolioOptions {
  longShort?: boolean;
  /** Replace the combined forecast with SystemFrame.trendFilter (AFTS Strategy 5). */
  trendFilter?: boolean;
  /** Hold every eligible symbol at this forecast (risk-parity benchmark uses 10). */
  constantForecast?: number;
}

export const overlayLimitCodes: (OverlayLimit | null)[] = [
  null,
  "gross",
  "normal_risk",
  "correlation_shock",
  "jump_risk",
];

/** Position weights decided at each close (fractions of equity). */
export interface PortfolioFrame {
  system: SystemFrame;
  /** Instrument diversification multiplier per session. */
  idm: Series;
  /** Top-down handcrafted weight over eligible symbols (sums to 1 when any is eligible). */
  instrumentWeight: Series[];
  /** Forecast actually sized: max(0, F) long-only, F long/short, or the variant's forecast. */
  forecast: Series[];
  /** Weight at forecast 10: IDM × w × τ ÷ σ, times the overlay multiplier. */
  averageWeight: Series[];
  /** Final target weight after the per-name cap and overlay (signed when long/short). */
  targetWeight: Series[];
  /** Overlay multiplier m ≤ 1 and the binding limit code (overlayLimitCodes index). */
  multiplier: Series;
  limit: Uint8Array;
  gross: Series;
}
