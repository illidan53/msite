export type ResearchModule = "all" | "quant" | "fundamentals" | "news" | "ai";
export type ResearchPhase =
  "pending" | "running" | "complete" | "unavailable" | "failed";
export interface ResearchMetric {
  id: string;
  en: string;
  zh: string;
  value: number | null;
  unit: "percent" | "number" | "usd" | "days";
  group: "performance" | "risk" | "trend" | "liquidity" | "fundamentals";
  note: string;
}
export interface ResearchNews {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  description: string;
}
export interface ResearchSection {
  status: ResearchPhase;
  fetchedAt?: string;
  asOf?: string;
  message?: string;
}
export interface ResearchMetricHistory {
  dates: string[];
  values: Record<string, (number | null)[]>;
  dataStart: string;
  asOf: string;
  fetchedAt: string;
  basis: "snapshot" | "reconstructed";
}
export interface ResearchReport {
  id: string;
  baseId?: string;
  symbol: string;
  benchmark: string;
  locale: "en" | "zh";
  module: ResearchModule;
  createdAt: string;
  completedAt?: string;
  status: "running" | "complete" | "partial" | "failed";
  kind: "stock" | "etf" | "unknown";
  name?: string;
  description?: string;
  homepage?: string;
  sections: Record<Exclude<ResearchModule, "all">, ResearchSection>;
  metrics: ResearchMetric[];
  prices: { date: string; close: number; drawdown: number }[];
  news: ResearchNews[];
  metricHistory?: ResearchMetricHistory;
  ema200Study?: Ema200Study;
  quantModels?: QuantModelSet;
  narrative?: string;
  model?: string;
  financialPeriod?: string;
  filingDate?: string;
}

export interface Ema200Event {
  date: string;
  referenceEma: number;
  entryDate: string | null;
  entryPrice: number | null;
  returns: Record<string, number | null>;
}
export interface Ema200Horizon {
  sessions: number;
  events: number;
  controls: number;
  meanReturn: number | null;
  medianReturn: number | null;
  positiveRate: number | null;
  controlMean: number | null;
  lift: number | null;
  correlation: number | null;
}
export interface Ema200StudyV1 {
  version: 1;
  asOf: string;
  dataStart: string;
  fetchedAt: string;
  basis: "snapshot" | "reconstructed";
  ema: number | null;
  close: number | null;
  distance: number | null;
  status: "insufficient" | "positive" | "negative" | "inconclusive";
  confidenceInterval: [number, number] | null;
  bootstrapSamples: number;
  horizons: Ema200Horizon[];
  events: Ema200Event[];
  chart: { date: string; close: number; ema: number | null; touch: boolean }[];
}

export interface Ema200Path {
  endReturn: number;
  averageReturn: number;
  maxGain: number;
  maxLoss: number;
  hitDay: number | null;
}
export interface Ema200EventV2 extends Ema200Event {
  lowDistance: number;
  outcome: "pending" | "near" | "reclaimed" | "weak" | "mixed";
  paths: Record<string, Ema200Path | null>;
  confirmation: {
    date: string;
    lowDate: string;
    low: number;
    entryDate: string | null;
    entryPrice: number | null;
    paths: Record<string, Ema200Path | null>;
  } | null;
}
export interface Ema200PathSummary {
  count: number;
  averageReturn: number | null;
  maxGain: number | null;
  maxLoss: number | null;
  hitRate: number | null;
  medianHitDay: number | null;
}
export interface Ema200HorizonV2 extends Ema200Horizon, Ema200PathSummary {}
export interface Ema200StudyV2 extends Omit<
  Ema200StudyV1,
  "version" | "events" | "horizons"
> {
  version: 2;
  bandPercent: 3;
  targetPercent: 5;
  events: Ema200EventV2[];
  horizons: Ema200HorizonV2[];
  sensitivity: { bandPercent: number; horizon: Ema200HorizonV2 }[];
  confirmed: {
    sessions: number;
    detected: number;
    meanReturn: number | null;
    positiveRate: number | null;
    path: Ema200PathSummary;
  }[];
}
export type Ema200Study = Ema200StudyV1 | Ema200StudyV2;

/** Bump when any pullback model definition or output shape changes. */
export const QUANT_MODELS_VERSION = 1;
export type PullbackModelId = "sma50" | "rsi2" | "bollinger";
export interface PullbackExit {
  date: string;
  sessions: number;
  return: number;
  reason: "reverted" | "time";
}
export interface PullbackEvent {
  date: string;
  /** Model reading at the signal: low distance %, RSI(2), or close vs lower band %. */
  trigger: number;
  entryDate: string | null;
  entryPrice: number | null;
  returns: Record<string, number | null>;
  paths: Record<string, Ema200Path | null>;
  /** Null until the full 20-session window has matured. */
  exit: PullbackExit | null;
}
export interface PullbackExitSummary {
  count: number;
  revertedRate: number | null;
  meanReturn: number | null;
  winRate: number | null;
  medianSessions: number | null;
  worstReturn: number | null;
}
export interface PullbackStudy {
  id: PullbackModelId;
  parameter: number;
  primaryHorizon: number;
  cooldown: number;
  targetPercent: number;
  status: "insufficient" | "positive" | "negative" | "inconclusive";
  confidenceInterval: [number, number] | null;
  bootstrapSamples: number;
  horizons: Ema200HorizonV2[];
  sensitivity: { parameter: number; horizon: Ema200HorizonV2 }[];
  exit: PullbackExitSummary;
  events: PullbackEvent[];
  current: {
    signal: boolean;
    regime: boolean | null;
    readings: Record<string, number | null>;
    lastEvent: string | null;
    sessionsSince: number | null;
  };
  /** Series aligned with QuantModelSet.chart.dates. */
  chart: {
    lines: Record<string, (number | null)[]>;
    band?: { upper: (number | null)[]; lower: (number | null)[] };
    oscillator?: { values: (number | null)[]; threshold: number };
    events: number[];
  };
}
export interface QuantModelSet {
  version: typeof QUANT_MODELS_VERSION;
  asOf: string;
  dataStart: string;
  fetchedAt: string;
  basis: "snapshot" | "reconstructed";
  chart: { dates: string[]; close: number[] };
  models: PullbackStudy[];
}

export type QuantModelId = "ema200" | PullbackModelId;
export const quantModelIds: QuantModelId[] = [
  "ema200",
  "sma50",
  "rsi2",
  "bollinger",
];

/** Bump when the scan universe, fit definition or stored shape changes. */
export const MODEL_SCAN_VERSION = 1;
/**
 * high: the model's own positive status; moderate: inconclusive but advantage,
 * event mean and score (≥ 1) all point the same way; contrary: negative status.
 */
export type ModelFitTier =
  "high" | "moderate" | "low" | "contrary" | "insufficient";
export interface ModelFit {
  status: PullbackStudy["status"];
  tier: ModelFitTier;
  /** Advantage ÷ bootstrap standard error (interval width ÷ 3.92). */
  score: number | null;
  primaryHorizon: number;
  events: number;
  controls: number;
  lift: number | null;
  interval: [number, number] | null;
  correlation: number | null;
  meanReturn: number | null;
  positiveRate: number | null;
  hitRate: number | null;
  signal: boolean;
  lastEvent: string | null;
  sessionsSince: number | null;
  regime: boolean | null;
  /** EMA200/SMA50 distance %, RSI(2), or Bollinger %B at the latest close. */
  reading: number | null;
}
export interface ModelScanRow {
  symbol: string;
  lists: string[];
  asOf: string;
  dataStart: string;
  sessions: number;
  fits: Record<QuantModelId, ModelFit>;
}
export interface ModelScan {
  version: typeof MODEL_SCAN_VERSION;
  modelsVersion: typeof QUANT_MODELS_VERSION;
  id: string;
  status: "complete" | "partial";
  startedAt: string;
  completedAt: string;
  /** Most common latest completed session across scanned symbols. */
  asOf: string;
  lists: { id: string; name: string }[];
  rows: ModelScanRow[];
  failures: { symbol: string; message: string }[];
}
export interface ModelScanJob {
  id: string;
  startedAt: string;
  total: number;
  done: number;
}
export interface ModelScanState {
  scan: ModelScan | null;
  job: ModelScanJob | null;
  lastFailure: { at: string; message: string } | null;
}
/** Latest 252 sessions of every model's chart for one symbol. */
export interface ModelChartSet {
  symbol: string;
  asOf: string;
  dates: string[];
  close: number[];
  models: Record<QuantModelId, PullbackStudy["chart"]>;
}
