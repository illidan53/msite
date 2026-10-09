import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  STRATEGY_ENGINE_VERSION,
  ruleFamilies,
  type BacktestReport,
  type BacktestReportSummary,
  type BookSnapshot,
  type IneligibleReason,
  type LatestSnapshot,
  type OutboxEntry,
  type PaperLedger,
  type PaperSummary,
  type RuleFamily,
  type RunRecord,
  type SignalRecord,
  type StrategyJob,
  type StrategyState,
  type SymbolChart,
  type SymbolRow,
} from "../../shared/strategy";
import { newYorkDate } from "../../shared/marketDate";
import { ruleIds } from "../../shared/strategyRules";
import type { PriceBar, WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";
import {
  fetchClosedBars,
  fetchFailureCode,
  type HistorySource,
} from "../research/barFetch";
import { runBacktest } from "./backtest";
import { buildPanel } from "./calendar";
import {
  configHash,
  loadStrategyConfig,
  resolveBooks,
  type BookDefinition,
  type StrategyConfig,
} from "./config";
import {
  renderFailure,
  renderSignalDigest,
  renderTest,
  renderWeeklyReport,
} from "./emails";
import { familyForecasts, ruleContributions } from "./forecast";
import { Outbox, type Mailer } from "./mailer";
import { createLedger, replayPaper } from "./paper";
import { buildPortfolio } from "./portfolio";
import { StrategyScheduler } from "./scheduler";
import { SignalLog } from "./signals";
import { readJson, writeJsonAtomic } from "./store";
import { computeSystem } from "./system";
import type { Panel, PortfolioFrame } from "./types";

const CHART_SESSIONS = 252;
const REPORTS_KEPT = 26;
/** Legacy event studies count as trials for the deflated Sharpe ratio. */
const LEGACY_TRIALS = [
  "legacy:ema200",
  "legacy:sma50",
  "legacy:rsi2",
  "legacy:bollinger",
];
const reasons: (IneligibleReason | undefined)[] = [
  undefined,
  "no_bar",
  "warmup",
  "stale",
  "illiquid",
  "cost",
];
const r4 = (v: number) =>
  Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
const pct = (v: number) => r4(v * 100);

export interface StrategyServiceOptions {
  market: HistorySource;
  configDir: string;
  /** RESEARCH_DATA_DIR; strategy files live in its strategy/ folder. */
  dataDir: string;
  readWatchlists: () => Promise<WatchlistsConfig>;
  mailer: Mailer;
  baseUrl: string;
  now?: () => Date;
  concurrency?: number;
  retryDelayMs?: number;
}

interface Loaded {
  config: StrategyConfig;
  books: BookDefinition[];
  hash: string;
  panel: Panel;
  failures: { symbol: string; message: string }[];
}

/**
 * Daily signals, forward paper trading and backtest reports. One job runs at
 * a time; scheduled and manual runs share the same queue and files.
 */
export class StrategyService {
  readonly dir: string;
  private readonly outboxStore: Outbox;
  private readonly signalLog: SignalLog;
  private job: StrategyJob | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastFailure: StrategyState["lastFailure"] = null;
  private starts: number[] = [];
  private lastTestEmail = 0;
  private scheduler?: StrategyScheduler;
  private schedulerStarted = false;

  constructor(private readonly options: StrategyServiceOptions) {
    this.dir = join(options.dataDir, "strategy");
    this.outboxStore = new Outbox(this.dir);
    this.signalLog = new SignalLog(this.dir);
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }
  private file(name: string) {
    return join(this.dir, name);
  }
  private config() {
    return loadStrategyConfig(this.options.configDir);
  }

  /** Shared scheduler instance: always available for state, started only on demand. */
  async getScheduler() {
    if (!this.scheduler) {
      const config = await this.config();
      this.scheduler = new StrategyScheduler({
        schedule: config.schedule,
        file: this.file("scheduler.json"),
        now: () => this.now(),
        runDaily: (trigger) => this.runDaily(trigger),
        runBacktest: (trigger) => this.runBacktest(trigger),
        onDailyGiveUp: async (record) => {
          if (config.email.failureAlerts)
            await this.email(
              "failure",
              renderFailure(
                { job: "daily", message: record.message ?? "FAILED", nextRetry: null },
                { locale: config.email.locale, baseUrl: this.options.baseUrl },
              ),
            );
        },
      });
    }
    return this.scheduler;
  }
  async startScheduler() {
    const scheduler = await this.getScheduler();
    if (!this.schedulerStarted) {
      scheduler.start();
      this.schedulerStarted = true;
    }
  }
  stopScheduler() {
    this.scheduler?.stop();
    this.schedulerStarted = false;
  }

  /** Resolves when queued jobs settle (tests and shutdown). */
  settled() {
    return this.queue.then(() => undefined);
  }

  async state(): Promise<StrategyState> {
    const config = await this.config();
    const books = resolveBooks(config, await this.options.readWatchlists());
    const scheduler = await (await this.getScheduler()).state();
    const latest = await readJson<LatestSnapshot>(this.file("latest.json"));
    const reports = await this.reports();
    const outbox = await this.outboxStore.list();
    return {
      version: STRATEGY_ENGINE_VERSION,
      books: books.map((b) => ({
        id: b.id,
        name: b.name,
        symbols: b.symbols.length,
        capital: b.capital,
        // Percent, like BacktestBookReport.riskTarget.
        riskTarget: b.riskTarget * 100,
      })),
      scheduler: {
        enabled: this.schedulerStarted,
        timezone: config.schedule.timezone,
        dailyAt: config.schedule.dailyAt,
        weeklyDay: config.schedule.weeklyDay,
        weeklyAt: config.schedule.weeklyAt,
        ...scheduler,
      },
      email: {
        configured: this.options.mailer.configured,
        transport: this.options.mailer.transport,
        lastSent: outbox[0]
          ? { at: outbox[0].createdAt, kind: outbox[0].kind, status: outbox[0].status }
          : null,
      },
      latest:
        latest?.version === STRATEGY_ENGINE_VERSION
          ? {
              asOf: latest.asOf,
              createdAt: latest.createdAt,
              signals: latest.books.reduce((n, b) => n + b.signals.length, 0),
            }
          : null,
      latestReport: reports[0] ?? null,
      job: this.job && { ...this.job },
      lastFailure: this.lastFailure,
    };
  }

  async latest(): Promise<LatestSnapshot> {
    const latest = await readJson<LatestSnapshot>(this.file("latest.json"));
    if (latest?.version !== STRATEGY_ENGINE_VERSION)
      throw new ApiError(404, "STRATEGY_NOT_RUN", "The quant system has not run yet", {
        source: "strategy",
      });
    return latest;
  }
  async chart(book: string, symbol: string): Promise<SymbolChart> {
    const charts = await readJson<{ version: number; charts: Record<string, SymbolChart> }>(
      this.file(`charts-${book}.json`),
    );
    const chart =
      charts?.version === STRATEGY_ENGINE_VERSION ? charts.charts[symbol] : undefined;
    if (!chart)
      throw new ApiError(404, "STRATEGY_CHART_NOT_FOUND", "No chart for this symbol", {
        source: "strategy",
      });
    return chart;
  }
  /** Newest first; a book filter searches the whole log so a quiet book keeps its history. */
  async signals(limit: number, book?: string): Promise<SignalRecord[]> {
    if (!book) return this.signalLog.list(limit);
    return (await this.signalLog.list()).filter((s) => s.book === book).slice(0, limit);
  }
  async paper(book: string): Promise<PaperLedger> {
    const ledger = await readJson<PaperLedger>(this.file(`paper-${book}.json`));
    if (!ledger)
      throw new ApiError(404, "PAPER_NOT_FOUND", "No paper ledger for this book", {
        source: "strategy",
      });
    return { ...ledger, fills: ledger.fills.slice(-500) };
  }
  async reports(): Promise<BacktestReportSummary[]> {
    return (
      (await readJson<BacktestReportSummary[]>(this.file("reports/index.json"))) ?? []
    );
  }
  async report(id: string): Promise<BacktestReport> {
    const report = await readJson<BacktestReport>(this.file(`reports/${id}.json`));
    if (report?.version !== STRATEGY_ENGINE_VERSION)
      throw new ApiError(404, "REPORT_NOT_FOUND", "No such backtest report", {
        source: "strategy",
      });
    return report;
  }
  outbox(): Promise<OutboxEntry[]> {
    return this.outboxStore.list();
  }

  /** Manual run: rate-limited, refused while another job runs. */
  async start(kind: StrategyJob["kind"]): Promise<StrategyState> {
    if (this.job)
      throw new ApiError(409, "STRATEGY_BUSY", "A quant system job is already running", {
        source: "strategy",
      });
    const now = this.now().getTime();
    this.starts = this.starts.filter((t) => now - t < 86_400_000);
    if (
      this.starts.filter((t) => now - t < 3_600_000).length >= 6 ||
      this.starts.length >= 24
    )
      throw new ApiError(429, "STRATEGY_RUN_LIMIT", "Quant system run capacity reached", {
        source: "strategy",
      });
    this.starts.push(now);
    const scheduler = await this.getScheduler();
    const run = kind === "daily" ? this.runDaily("manual") : this.runBacktest("manual");
    void run.then((record) => scheduler.record(kind, record));
    // Let the job claim its slot before answering, so the response shows it.
    await new Promise((resolve) => setImmediate(resolve));
    return this.state();
  }

  async testEmail(): Promise<OutboxEntry> {
    const now = this.now().getTime();
    if (now - this.lastTestEmail < 600_000)
      throw new ApiError(429, "TEST_EMAIL_LIMIT", "One test email per 10 minutes", {
        source: "strategy",
      });
    this.lastTestEmail = now;
    const config = await this.config();
    return this.email(
      "test",
      renderTest({
        locale: config.email.locale,
        baseUrl: this.options.baseUrl,
        transport: this.options.mailer.transport,
      }),
    );
  }

  private async email(
    kind: OutboxEntry["kind"],
    message: { subject: string; text: string; html: string },
  ): Promise<OutboxEntry> {
    const result = await this.options.mailer.send(message);
    const entry: OutboxEntry = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      kind,
      subject: message.subject,
      status: result.status,
      transport: this.options.mailer.transport,
      ...(result.error && { error: result.error }),
    };
    await this.outboxStore.record(entry);
    return entry;
  }

  /** Serialises jobs so scheduled and manual runs never overlap. */
  private enqueue<T>(
    kind: StrategyJob["kind"],
    trigger: StrategyJob["trigger"],
    task: (job: StrategyJob) => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const job: StrategyJob = {
        id: randomUUID(),
        kind,
        trigger,
        startedAt: this.now().toISOString(),
        step: "fetch",
        done: 0,
        total: 0,
      };
      this.job = job;
      try {
        return await task(job);
      } finally {
        this.job = null;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(job: StrategyJob, benchmarkBars?: PriceBar[]): Promise<Loaded> {
    const config = await this.config();
    const books = resolveBooks(config, await this.options.readWatchlists());
    const hash = configHash(config, books);
    const symbols = [
      ...new Set([config.benchmark, ...books.flatMap((b) => b.symbols)]),
    ];
    job.step = "fetch";
    job.total = symbols.length;
    job.done = benchmarkBars ? 1 : 0;
    const bars: Record<string, PriceBar[]> = {};
    if (benchmarkBars) bars[config.benchmark] = benchmarkBars;
    const failures: Loaded["failures"] = [];
    const queue = symbols.filter((s) => !bars[s]);
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const symbol = queue[next++];
        try {
          bars[symbol] = await fetchClosedBars(this.options.market, symbol, {
            retryDelayMs: this.options.retryDelayMs,
            now: this.now(),
          });
        } catch (e) {
          failures.push({ symbol, message: fetchFailureCode(e) });
        }
        job.done++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.options.concurrency ?? 4, queue.length) }, worker),
    );
    if (!bars[config.benchmark])
      throw new ApiError(502, "BENCHMARK_UNAVAILABLE", "Benchmark history unavailable", {
        source: "strategy",
      });
    job.step = "compute";
    return { config, books, hash, panel: buildPanel(bars, config.benchmark), failures };
  }

  runDaily(trigger: StrategyJob["trigger"]): Promise<RunRecord> {
    return this.enqueue("daily", trigger, (job) => this.daily(job, trigger)).catch(
      (e: unknown) => this.failed("daily", trigger, e),
    );
  }
  runBacktest(trigger: StrategyJob["trigger"]): Promise<RunRecord> {
    return this.enqueue("backtest", trigger, (job) => this.backtest(job, trigger)).catch(
      (e: unknown) => this.failed("backtest", trigger, e),
    );
  }
  private failed(
    kind: StrategyJob["kind"],
    trigger: StrategyJob["trigger"],
    e: unknown,
  ): RunRecord {
    const message = e instanceof ApiError ? e.code : "STRATEGY_FAILED";
    if (!(e instanceof ApiError)) console.error(`Quant system ${kind} failed`, e);
    const at = this.now().toISOString();
    this.lastFailure = { at, job: kind, message };
    return { at, trigger, status: "failed", message };
  }

  private async daily(
    job: StrategyJob,
    trigger: StrategyJob["trigger"],
  ): Promise<RunRecord> {
    const config = await this.config();
    const benchmarkBars = await fetchClosedBars(this.options.market, config.benchmark, {
      retryDelayMs: this.options.retryDelayMs,
      now: this.now(),
    });
    const asOf = newYorkDate(benchmarkBars.at(-1)!.timestamp)!;
    const enabled = config.books.filter((b) => b.enabled);
    const ledgers = await Promise.all(
      enabled.map((b) => readJson<PaperLedger>(this.file(`paper-${b.id}.json`))),
    );
    if (ledgers.every((l) => l && l.lastSession >= asOf))
      return { at: this.now().toISOString(), trigger, status: "skipped", asOf };

    const { books, hash, panel, failures } = await this.load(job, benchmarkBars);
    const snapshots: BookSnapshot[] = [];
    const records: SignalRecord[] = [];
    const fillUpdates: Parameters<SignalLog["applyFills"]>[0] = [];
    const charts: Record<string, Record<string, SymbolChart>> = {};
    for (const book of books) {
      const system = computeSystem(panel, book, config);
      const frame = buildPortfolio(system, config);
      const t = system.dates.length - 1;
      const stored = await readJson<PaperLedger>(this.file(`paper-${book.id}.json`));
      const replay = replayPaper({
        ledger: stored ?? createLedger(book.id, book.capital, system.dates[t], hash),
        frame,
        config,
        configHash: hash,
        drivers: (i, at) => ruleContributions(system, i, at),
      });
      const ledger = replay.ledger;
      fillUpdates.push(...replay.fills);
      await writeJsonAtomic(this.file(`paper-${book.id}.json`), ledger);
      records.push(...replay.signals.map((s) => ({ ...s, emailed: false })));
      snapshots.push({
        book: book.id,
        name: book.name,
        asOf: system.dates[t],
        configHash: hash,
        idm: r4(frame.idm[t]),
        fdm: median(system.fdm.map((s) => s[t])),
        overlay: {
          multiplier: r4(frame.multiplier[t]) ?? 1,
          limit: overlayLimit(frame, t),
        },
        gross: pct(frame.gross[t]) ?? 0,
        rows: rows(frame, t, ledger),
        signals: replay.signals,
        paper: paperSummary(ledger),
      });
      charts[book.id] = symbolCharts(frame, book.id);
      await new Promise((resolve) => setImmediate(resolve));
    }
    job.step = "report";
    const snapshot: LatestSnapshot = {
      version: STRATEGY_ENGINE_VERSION,
      createdAt: this.now().toISOString(),
      asOf: panel.dates.at(-1)!,
      trigger,
      books: snapshots,
    };
    await this.signalLog.applyFills(fillUpdates);
    await this.signalLog.append(records);
    for (const [id, set] of Object.entries(charts))
      await writeJsonAtomic(this.file(`charts-${id}.json`), {
        version: STRATEGY_ENGINE_VERSION,
        charts: set,
      });
    await writeJsonAtomic(this.file("latest.json"), snapshot);

    job.step = "email";
    let emailed = false;
    if (records.length || config.email.sendWhenNoSignals) {
      const entry = await this.email(
        "signals",
        renderSignalDigest(snapshot, {
          locale: config.email.locale,
          baseUrl: this.options.baseUrl,
        }),
      );
      emailed = entry.status === "sent";
      if (emailed) await this.signalLog.markEmailed(records.map((r) => r.id));
    }
    this.lastFailure = null;
    return {
      at: this.now().toISOString(),
      trigger,
      status: "complete",
      asOf: snapshot.asOf,
      emailed,
      ...(failures.length && {
        message: `${failures.length} symbols unavailable`,
      }),
    };
  }

  private async backtest(
    job: StrategyJob,
    trigger: StrategyJob["trigger"],
  ): Promise<RunRecord> {
    const { config, books, hash, panel, failures } = await this.load(job);
    const trials =
      (await readJson<string[]>(this.file("trials.json"))) ?? [...LEGACY_TRIALS];
    job.step = "simulate";
    const createdAt = this.now().toISOString();
    const result = await runBacktest({
      panel,
      books,
      config,
      computeSystem,
      priorTrials: trials,
      failures,
      onProgress: (done, total) => {
        job.done = done;
        job.total = total;
      },
    });
    job.step = "report";
    const report: BacktestReport = {
      version: STRATEGY_ENGINE_VERSION,
      id: randomUUID(),
      createdAt,
      completedAt: this.now().toISOString(),
      trigger,
      asOf: panel.dates.at(-1)!,
      configHash: hash,
      books: result.books,
    };
    await writeJsonAtomic(this.file(`reports/${report.id}.json`), report);
    const summary: BacktestReportSummary = {
      id: report.id,
      createdAt: report.createdAt,
      asOf: report.asOf,
      trigger,
      books: report.books.map((b) => {
        const core = b.runs.find((r) => r.id === "core")?.stats;
        return {
          book: b.book,
          sharpe: core?.sharpe ?? null,
          cagr: core?.cagr ?? null,
          maxDrawdown: core?.maxDrawdown ?? null,
        };
      }),
    };
    const index = [summary, ...(await this.reports())];
    await writeJsonAtomic(this.file("reports/index.json"), index.slice(0, REPORTS_KEPT));
    await this.pruneReports(new Set(index.slice(0, REPORTS_KEPT).map((r) => r.id)));
    await writeJsonAtomic(this.file("trials.json"), [
      ...new Set([...trials, ...result.trialKeys]),
    ]);

    job.step = "email";
    let emailed = false;
    if (trigger === "schedule" && config.email.weeklyReport) {
      const entry = await this.email(
        "report",
        renderWeeklyReport(report, {
          locale: config.email.locale,
          baseUrl: this.options.baseUrl,
        }),
      );
      emailed = entry.status === "sent";
    }
    this.lastFailure = null;
    return {
      at: this.now().toISOString(),
      trigger,
      status: "complete",
      asOf: report.asOf,
      emailed,
    };
  }

  private async pruneReports(keep: Set<string>) {
    const files = await readdir(this.file("reports")).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json") && f !== "index.json")
        .filter((f) => !keep.has(f.slice(0, -5)))
        .map((f) => unlink(this.file(`reports/${f}`)).catch(() => undefined)),
    );
  }
}

function median(values: number[]) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const mid = (finite.length - 1) / 2;
  return r4((finite[Math.floor(mid)] + finite[Math.ceil(mid)]) / 2);
}

function overlayLimit(frame: PortfolioFrame, t: number) {
  const codes = [null, "gross", "normal_risk", "correlation_shock", "jump_risk"] as const;
  return codes[frame.limit[t]] ?? null;
}

function rows(frame: PortfolioFrame, t: number, ledger: PaperLedger): SymbolRow[] {
  const system = frame.system;
  const equity = ledger.equity.at(-1)?.value ?? ledger.capital;
  return system.symbols.map((symbol, i) => {
    const close = system.panel.close[system.panelIndex[i]][t];
    const held = ledger.positions[symbol];
    const families = familyForecasts(system, i, t);
    return {
      symbol,
      class: system.classOf[i],
      close: r4(close),
      sigma: pct(system.sigma[i][t]),
      forecast: r4(system.combined[i][t]),
      families: Object.fromEntries(
        ruleFamilies.map((f) => [f, families[f] === null ? null : r4(families[f]!)]),
      ) as Record<RuleFamily, number | null>,
      rules: Object.fromEntries(
        ruleIds.map((id) => [id, r4(system.forecasts[id][i][t])]),
      ),
      costFiltered: ruleIds.filter((id) => system.costPass[id][i][t] === 0),
      fdm: r4(system.fdm[i][t]),
      instrumentWeight: pct(frame.instrumentWeight[i][t]),
      averageWeight: pct(frame.averageWeight[i][t]),
      targetWeight: pct(frame.targetWeight[i][t]),
      heldShares: held?.shares ?? 0,
      heldWeight:
        held && equity > 0 ? (pct((held.shares * held.lastClose) / equity) ?? 0) : 0,
      eligible: system.eligible[i][t] === 1,
      ...(system.eligible[i][t] !== 1 && { reason: reasons[system.reason[i][t]] }),
    };
  });
}

function paperSummary(ledger: PaperLedger): PaperSummary {
  const last = ledger.equity.at(-1);
  const prev = ledger.equity.at(-2);
  const first = ledger.equity[0];
  const value = last?.value ?? ledger.capital;
  const gross = Object.values(ledger.positions).reduce(
    (sum, p) => sum + Math.abs(p.shares * p.lastClose),
    0,
  );
  return {
    inception: ledger.inception,
    lastSession: ledger.lastSession,
    capital: ledger.capital,
    equity: r4(value) ?? ledger.capital,
    cash: r4(ledger.cash) ?? 0,
    dayReturn: last && prev ? pct(last.value / prev.value - 1) : null,
    totalReturn: pct(value / ledger.capital - 1),
    benchmarkReturn:
      last?.benchmark && first?.benchmark ? pct(last.benchmark / first.benchmark - 1) : null,
    positions: Object.keys(ledger.positions).length,
    gross: value > 0 ? (pct(gross / value) ?? 0) : 0,
  };
}

function symbolCharts(frame: PortfolioFrame, book: string) {
  const system = frame.system;
  const from = Math.max(0, system.dates.length - CHART_SESSIONS);
  const dates = system.dates.slice(from);
  const charts: Record<string, SymbolChart> = {};
  system.symbols.forEach((symbol, i) => {
    const close = system.panel.close[system.panelIndex[i]];
    const families = Object.fromEntries(
      ruleFamilies.map((f) => [f, [] as (number | null)[]]),
    ) as Record<RuleFamily, (number | null)[]>;
    for (let t = from; t < system.dates.length; t++) {
      const values = familyForecasts(system, i, t);
      for (const f of ruleFamilies)
        families[f].push(values[f] === null ? null : r4(values[f]!));
    }
    charts[symbol] = {
      book,
      symbol,
      asOf: system.dates.at(-1)!,
      dates,
      close: Array.from(close.slice(from), (v) => r4(v)),
      forecast: Array.from(system.combined[i].slice(from), (v) => r4(v)),
      families,
      targetWeight: Array.from(frame.targetWeight[i].slice(from), (v) => pct(v)),
    };
  });
  return charts;
}
