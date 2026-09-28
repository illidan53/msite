import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PriceBar, WatchlistsConfig } from "../../shared/types";
import {
  MAX_BREAKDOWN_RATE,
  MODEL_SCAN_VERSION,
  QUANT_MODELS_VERSION,
  type BreakdownSummary,
  type Ema200HorizonV2,
  type ModelChartSet,
  type ModelFit,
  type ModelFitTier,
  type ModelScan,
  type ModelScanJob,
  type ModelScanRow,
  type ModelScanState,
  type PullbackModelId,
  type PullbackStudy,
  type QuantModelId,
} from "../../shared/research";
import { etfs } from "../../shared/etfs";
import { newYorkDate } from "../../shared/marketDate";
import { ApiError } from "../http/apiError";
import type { MarketDataProvider } from "../market/marketDataProvider";
import { calculateEma200Study } from "./ema200";
import { calculateQuantModels } from "./pullback";
import { closedBars } from "./quant";

export interface ScanUniverse {
  lists: { id: string; name: string }[];
  symbols: { symbol: string; lists: string[] }[];
}
export const ETF_LIST = { id: "etf", name: "Sectors & ETFs" };

/** Every watchlist symbol plus the Sectors & ETFs catalog, deduplicated in display order. */
export function scanUniverse(config: WatchlistsConfig): ScanUniverse {
  const bySymbol = new Map<string, string[]>();
  const add = (symbol: string, list: string) => {
    const key = symbol.trim().toUpperCase();
    if (!key) return;
    const lists = bySymbol.get(key) ?? [];
    if (!lists.includes(list)) lists.push(list);
    bySymbol.set(key, lists);
  };
  for (const watchlist of config.watchlists)
    for (const row of watchlist.rows)
      for (const symbol of row.symbols) add(symbol, watchlist.id);
  for (const etf of etfs) add(etf.symbol, ETF_LIST.id);
  return {
    lists: [
      ...config.watchlists.map(({ id, name }) => ({ id, name })),
      ETF_LIST,
    ],
    symbols: [...bySymbol].map(([symbol, lists]) => ({ symbol, lists })),
  };
}

const r4 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? null
    : Math.round(v * 1e4) / 1e4;
/** Advantage in bootstrap standard errors; the 95% interval spans ±1.96 of them. */
export function fitScore(
  lift: number | null,
  interval: [number, number] | null,
) {
  if (lift === null || !interval) return null;
  const se = (interval[1] - interval[0]) / 3.92;
  return se > 0 ? lift / se : null;
}
export function fitTier(
  status: PullbackStudy["status"],
  score: number | null,
  meanReturn: number | null,
  breakdowns: BreakdownSummary | null = null,
): ModelFitTier {
  if (status === "insufficient") return "insufficient";
  if (status === "negative") return "contrary";
  // Touch models: a significant edge with frequent unreclaimed breakdowns is not a high fit.
  if (status === "positive")
    return breakdowns?.mature &&
      (breakdowns.failed / breakdowns.mature) * 100 > MAX_BREAKDOWN_RATE
      ? "moderate"
      : "high";
  return score !== null && score >= 1 && meanReturn !== null && meanReturn > 0
    ? "moderate"
    : "low";
}
function toFit(
  status: PullbackStudy["status"],
  interval: [number, number] | null,
  primary: Ema200HorizonV2,
  current: Pick<
    ModelFit,
    "signal" | "lastEvent" | "sessionsSince" | "regime" | "reading"
  >,
  breakdowns: BreakdownSummary | null = null,
): ModelFit {
  const score = fitScore(primary.lift, interval);
  return {
    status,
    tier: fitTier(status, score, primary.meanReturn, breakdowns),
    score: r4(score),
    primaryHorizon: primary.sessions,
    events: primary.events,
    controls: primary.controls,
    lift: r4(primary.lift),
    interval: interval && [r4(interval[0])!, r4(interval[1])!],
    correlation: r4(primary.correlation),
    meanReturn: r4(primary.meanReturn),
    positiveRate: r4(primary.positiveRate),
    hitRate: r4(primary.hitRate),
    breakdowns,
    ...current,
    reading: r4(current.reading),
  };
}
const readingKey: Record<PullbackModelId, string> = {
  sma50: "distance",
  rsi2: "rsi2",
  bollinger: "percentB",
};

/** Runs every My Quant model on one symbol's completed daily bars. */
export function scanSymbol(bars: PriceBar[]) {
  const ema = calculateEma200Study(bars);
  const set = calculateQuantModels(bars);
  const last = bars.length - 1;
  const lastEvent = ema.events.at(-1)?.date ?? null;
  let eventIndex = -1;
  if (lastEvent)
    for (let i = last; i >= 0 && eventIndex < 0; i--)
      if (newYorkDate(bars[i].timestamp) === lastEvent) eventIndex = i;
  const fits = {
    ema200: toFit(
      ema.status,
      ema.confidenceInterval,
      ema.horizons.find((h) => h.sessions === 20)!,
      {
        signal: lastEvent !== null && lastEvent === ema.asOf,
        lastEvent,
        sessionsSince: eventIndex < 0 ? null : last - eventIndex,
        regime:
          ema.ema === null || ema.close === null ? null : ema.close > ema.ema,
        reading: ema.distance,
      },
      ema.failure,
    ),
  } as Record<QuantModelId, ModelFit>;
  const charts = {} as ModelChartSet["models"];
  // EMA200 keeps its own chart rows; both slices end on the same latest 252 sessions.
  const emaLine = ema.chart.map((p) => r4(p.ema));
  const failedDates = new Set(
    ema.events.flatMap((e) => (e.failed ? [e.date] : [])),
  );
  charts.ema200 = {
    lines: { ema200: emaLine },
    band: {
      upper: emaLine.map((v) => (v === null ? null : r4(v * 1.03))),
      lower: emaLine.map((v) => (v === null ? null : r4(v * 0.97))),
    },
    events: ema.chart.flatMap((p, i) => (p.touch ? [i] : [])),
    failed: ema.chart.flatMap((p, i) => (failedDates.has(p.date) ? [i] : [])),
  };
  for (const study of set.models) {
    fits[study.id] = toFit(
      study.status,
      study.confidenceInterval,
      study.horizons.find((h) => h.sessions === study.primaryHorizon)!,
      {
        signal: study.current.signal,
        lastEvent: study.current.lastEvent,
        sessionsSince: study.current.sessionsSince,
        regime: study.current.regime,
        reading: study.current.readings[readingKey[study.id]] ?? null,
      },
      study.failure ?? null,
    );
    charts[study.id] = study.chart;
  }
  return {
    asOf: set.asOf,
    dataStart: set.dataStart,
    fits,
    chart: {
      asOf: set.asOf,
      dates: set.chart.dates,
      close: set.chart.close,
      models: charts,
    },
  };
}

/** The most common latest session; ties go to the later date. */
function commonDate(dates: string[]) {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d, (counts.get(d) ?? 0) + 1);
  const ranked = [...counts].sort(
    (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
  );
  return ranked[0]?.[0] ?? "";
}
const failureCode = (e: unknown) =>
  e instanceof ApiError
    ? e.code === "NO_HISTORY"
      ? "NO_HISTORY"
      : `PROVIDER_${e.status}`
    : "FETCH_FAILED";

interface Stored {
  scan: ModelScan;
  charts: Record<string, ModelChartSet>;
}
const FILE = "model-scan.json";
const current = (stored: Partial<Stored> | null): stored is Stored =>
  stored?.scan?.version === MODEL_SCAN_VERSION &&
  stored.scan.modelsVersion === QUANT_MODELS_VERSION &&
  !!stored.charts;

/**
 * One background scan at a time across the whole site universe. The last
 * finished scan keeps serving while a new one runs and after a failed one.
 */
export class ModelScanService {
  private stored: Stored | null = null;
  private loaded?: Promise<void>;
  private job: ModelScanJob | null = null;
  private running: Promise<void> = Promise.resolve();
  private lastFailure: ModelScanState["lastFailure"] = null;
  private starts: number[] = [];
  constructor(
    private market: Pick<MarketDataProvider, "getHistory">,
    private universe: () => Promise<ScanUniverse>,
    private dir: string,
    private options: { concurrency?: number; retryDelayMs?: number } = {},
  ) {}
  private load() {
    this.loaded ??= readFile(join(this.dir, FILE), "utf8")
      .then((text) => {
        const parsed = JSON.parse(text) as Partial<Stored>;
        // Outdated shapes or model definitions are recalculated, never served.
        if (current(parsed)) this.stored = parsed;
      })
      .catch((e: NodeJS.ErrnoException) => {
        // A missing or corrupt file only means there is no saved scan yet.
        if (e.code === "ENOENT" || e instanceof SyntaxError) return;
        this.loaded = undefined;
        throw e;
      });
    return this.loaded;
  }
  async state(): Promise<ModelScanState> {
    await this.load();
    return {
      scan: this.stored?.scan ?? null,
      job: this.job && { ...this.job },
      lastFailure: this.lastFailure,
    };
  }
  async chart(symbol: string): Promise<ModelChartSet> {
    await this.load();
    const chart = this.stored?.charts[symbol];
    if (!chart)
      throw new ApiError(
        404,
        "MODEL_CHART_NOT_FOUND",
        "No scanned chart for this symbol",
      );
    return chart;
  }
  /** Resolves when the current background scan settles (for tests and shutdown). */
  settled() {
    return this.running;
  }
  async start(): Promise<ModelScanState> {
    await this.load();
    if (!this.job) {
      const now = Date.now();
      this.starts = this.starts.filter((time) => now - time < 86400_000);
      if (
        this.starts.filter((time) => now - time < 3600_000).length >= 4 ||
        this.starts.length >= 12
      )
        throw new ApiError(
          429,
          "MODEL_SCAN_LIMIT",
          "Model scan capacity reached",
        );
      this.starts.push(now);
      const job: ModelScanJob = {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        total: 0,
        done: 0,
      };
      this.job = job;
      this.running = this.run(job).finally(() => {
        if (this.job === job) this.job = null;
      });
    }
    return this.state();
  }
  private async bars(symbol: string) {
    const get = async (range: "5y" | "1y") => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.market.getHistory({ symbol, range });
        } catch (e) {
          // One polite retry when the provider throttles.
          if (!(e instanceof ApiError) || e.status !== 429 || attempt >= 1)
            throw e;
          await new Promise((r) =>
            setTimeout(r, this.options.retryDelayMs ?? 2000),
          );
        }
      }
    };
    let series;
    try {
      series = await get("5y");
    } catch (e) {
      if (!(e instanceof ApiError) || ![400, 403].includes(e.status)) throw e;
      series = await get("1y");
    }
    const bars = closedBars(series.bars);
    if (bars.length < 2)
      throw new ApiError(422, "NO_HISTORY", "Insufficient completed bars");
    return bars;
  }
  private async run(job: ModelScanJob) {
    try {
      const universe = await this.universe();
      job.total = universe.symbols.length;
      const rows: ModelScanRow[] = [];
      const charts: Record<string, ModelChartSet> = {};
      const failures: ModelScan["failures"] = [];
      let next = 0;
      const worker = async () => {
        while (next < universe.symbols.length) {
          const { symbol, lists } = universe.symbols[next++];
          try {
            const bars = await this.bars(symbol);
            const result = scanSymbol(bars);
            rows.push({
              symbol,
              lists,
              asOf: result.asOf,
              dataStart: result.dataStart,
              sessions: bars.length,
              fits: result.fits,
            });
            charts[symbol] = { symbol, ...result.chart };
          } catch (e) {
            failures.push({ symbol, message: failureCode(e) });
          }
          job.done++;
          // Model math is synchronous; yield so other API requests stay responsive.
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(this.options.concurrency ?? 4, job.total) },
          worker,
        ),
      );
      if (!rows.length)
        throw new ApiError(
          502,
          failures[0]?.message ?? "NO_SYMBOLS",
          "No symbol could be scanned",
        );
      const order = new Map(universe.symbols.map((s, i) => [s.symbol, i]));
      const byUniverse = (a: { symbol: string }, b: { symbol: string }) =>
        order.get(a.symbol)! - order.get(b.symbol)!;
      const scan: ModelScan = {
        version: MODEL_SCAN_VERSION,
        modelsVersion: QUANT_MODELS_VERSION,
        id: job.id,
        status: failures.length ? "partial" : "complete",
        startedAt: job.startedAt,
        completedAt: new Date().toISOString(),
        asOf: commonDate(rows.map((r) => r.asOf)),
        lists: universe.lists,
        rows: rows.sort(byUniverse),
        failures: failures.sort(byUniverse),
      };
      await this.save({ scan, charts });
      this.stored = { scan, charts };
      this.lastFailure = null;
    } catch (e) {
      this.lastFailure = {
        at: new Date().toISOString(),
        message: e instanceof ApiError ? e.code : "SCAN_FAILED",
      };
    }
  }
  private async save(stored: Stored) {
    await mkdir(this.dir, { recursive: true });
    const temp = join(this.dir, "model-scan.tmp");
    await writeFile(temp, JSON.stringify(stored), { mode: 0o600 });
    await rename(temp, join(this.dir, FILE));
  }
}
