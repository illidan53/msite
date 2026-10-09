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
  type RuleContribution,
  type RuleFamily,
  type RunRecord,
  type Signal,
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
import {
  addDays,
  newYorkClock,
  newYorkInstant,
  StrategyScheduler,
} from "./scheduler";
import { SignalLog } from "./signals";
import { readJson, writeJsonAtomic } from "./store";
import { computeSystem } from "./system";
import type { Panel, PortfolioFrame } from "./types";

const CHART_SESSIONS = 252;
const REPORTS_KEPT = 26;
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
/** Unavailable symbols named in a run message; the rest are counted. */
const NAMED_FAILURES = 10;

interface ChartsFile {
  version: number;
  charts: Record<string, SymbolChart>;
}
type Failure = NonNullable<StrategyState["lastFailure"]>;

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
  /** Unresolved failure per job kind; a later run of that kind that does not fail clears it. */
  private failures: Partial<Record<StrategyJob["kind"], Failure>> = {};
  /**
   * Parsed latest.json and charts-<book>.json. Public reads would otherwise
   * parse megabytes per request; daily() replaces the entries as it writes.
   */
  private latestCache: Promise<LatestSnapshot | null> | null = null;
  private chartCache = new Map<string, Promise<ChartsFile | null>>();
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
        onDailyGiveUp: (record) => this.failureAlert("daily", record),
        onBacktestGiveUp: (record) => this.failureAlert("backtest", record),
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

  /** Sent when a scheduled job exhausts its retries and failure alerts are on. */
  private async failureAlert(job: StrategyJob["kind"], record: RunRecord) {
    const config = await this.config();
    if (!config.email.failureAlerts) return;
    await this.email(
      "failure",
      renderFailure(
        {
          job,
          message: record.message ?? "FAILED",
          // A daily give-up waits for tomorrow; a backtest for its next weekly slot.
          nextRetry: job === "backtest" ? nextWeeklySlot(this.now(), config.schedule) : null,
        },
        {
          locale: config.email.locale,
          baseUrl: this.options.baseUrl,
          configHash: await this.currentHash(config),
        },
      ),
    );
  }
  /** Hash of the config as it stands, for emails that carry none of their own. */
  private async currentHash(config: StrategyConfig) {
    try {
      return configHash(config, resolveBooks(config, await this.options.readWatchlists()));
    } catch {
      return undefined;
    }
  }

  /** Keeps a parsed file; a missing one (cheap to re-check) or an I/O error is forgotten. */
  private remember<T>(read: Promise<T | null>, forget: () => void) {
    read.then(
      (value) => value === null && forget(),
      () => forget(),
    );
    return read;
  }
  private storedLatest(): Promise<LatestSnapshot | null> {
    if (!this.latestCache) {
      const read = readJson<LatestSnapshot>(this.file("latest.json"));
      this.latestCache = this.remember(read, () => {
        if (this.latestCache === read) this.latestCache = null;
      });
    }
    return this.latestCache;
  }
  private storedCharts(book: string): Promise<ChartsFile | null> {
    let entry = this.chartCache.get(book);
    if (!entry) {
      const read = readJson<ChartsFile>(this.file(`charts-${book}.json`));
      entry = this.remember(read, () => {
        if (this.chartCache.get(book) === read) this.chartCache.delete(book);
      });
      this.chartCache.set(book, entry);
    }
    return entry;
  }

  /** Resolves when queued jobs settle (tests and shutdown). */
  settled() {
    return this.queue.then(() => undefined);
  }

  async state(): Promise<StrategyState> {
    const config = await this.config();
    const books = resolveBooks(config, await this.options.readWatchlists());
    const scheduler = await (await this.getScheduler()).state();
    const latest = await this.storedLatest();
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
      lastFailure:
        Object.values(this.failures).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null,
    };
  }

  async latest(): Promise<LatestSnapshot> {
    const latest = await this.storedLatest();
    if (latest?.version !== STRATEGY_ENGINE_VERSION)
      throw new ApiError(404, "STRATEGY_NOT_RUN", "The quant system has not run yet", {
        source: "strategy",
      });
    return latest;
  }
  async chart(book: string, symbol: string): Promise<SymbolChart> {
    const charts = await this.storedCharts(book);
    const chart =
      charts?.version === STRATEGY_ENGINE_VERSION && Object.hasOwn(charts.charts, symbol)
        ? charts.charts[symbol]
        : undefined;
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
    // An unwritable state file must not become an unhandled rejection (process exit).
    void run
      .then((record) => scheduler.record(kind, record))
      .catch((e: unknown) => console.error("Quant system run state not saved", e));
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
        configHash: await this.currentHash(config),
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
    return this.settle(
      "daily",
      trigger,
      this.enqueue("daily", trigger, (job) => this.daily(job, trigger)),
    );
  }
  runBacktest(trigger: StrategyJob["trigger"]): Promise<RunRecord> {
    return this.settle(
      "backtest",
      trigger,
      this.enqueue("backtest", trigger, (job) => this.backtest(job, trigger)),
    );
  }
  /** Tracks failures per job kind: a skipped or complete run resolves its own kind only. */
  private async settle(
    kind: StrategyJob["kind"],
    trigger: StrategyJob["trigger"],
    run: Promise<RunRecord>,
  ): Promise<RunRecord> {
    let record: RunRecord;
    try {
      record = await run;
    } catch (e) {
      const message = e instanceof ApiError ? e.code : "STRATEGY_FAILED";
      if (!(e instanceof ApiError)) console.error(`Quant system ${kind} failed`, e);
      record = { at: this.now().toISOString(), trigger, status: "failed", message };
    }
    if (record.status === "failed")
      this.failures[kind] = {
        at: record.at,
        job: kind,
        message: record.message ?? "STRATEGY_FAILED",
      };
    else delete this.failures[kind];
    return record;
  }

  /** latest.json and every book's charts are current-version files covering `asOf`. */
  private async published(asOf: string, books: string[]) {
    const latest = await this.storedLatest();
    if (latest?.version !== STRATEGY_ENGINE_VERSION || latest.asOf < asOf) return false;
    if (!books.every((id) => latest.books.some((b) => b.book === id))) return false;
    const charts = await Promise.all(books.map((id) => this.storedCharts(id)));
    return charts.every((c) => c?.version === STRATEGY_ENGINE_VERSION);
  }
  /** Whether the scheduler's next daily retry still comes before today's give-up time. */
  /** Whether the first weekday after `asOf` has already reached its 09:30 New York open. */
  private nextOpenPassed(asOf: string) {
    let next = addDays(asOf, 1);
    while ([0, 6].includes(new Date(`${next}T12:00:00Z`).getUTCDay())) next = addDays(next, 1);
    return this.now().getTime() >= newYorkInstant(next, "09:30").getTime();
  }

  private retryLeft(schedule: StrategyConfig["schedule"]) {
    const now = this.now();
    const giveUp = newYorkInstant(newYorkClock(now).date, schedule.dailyGiveUpAt);
    return now.getTime() + schedule.dailyRetryMinutes * 60_000 < giveUp.getTime();
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
    // Ledgers are committed last, so current ledgers alone do not prove the
    // run finished: latest.json and the charts must also be current (a
    // version bump or a lost file is rebuilt the same day, without trading).
    if (
      ledgers.every((l) => l && l.lastSession >= asOf) &&
      (await this.published(asOf, enabled.map((b) => b.id)))
    )
      return { at: this.now().toISOString(), trigger, status: "skipped", asOf };

    // A new paper ledger must start from orders published before the open they
    // fill at. A catch-up run after the next session has opened (e.g. the
    // first deploy in the evening) waits for the next pre-open run instead.
    if (ledgers.some((l) => !l) && this.nextOpenPassed(asOf))
      return {
        at: this.now().toISOString(),
        trigger,
        status: "skipped",
        asOf,
        message: "INCEPTION_WAITS_FOR_PRE_OPEN",
      };

    const { books, hash, panel, failures } = await this.load(job, benchmarkBars);
    // Dropping symbols reweights their classmates, so a scheduled run retries
    // while a retry is left; a symbol without history will not recover.
    if (
      trigger === "schedule" &&
      failures.some((f) => f.message !== "NO_HISTORY") &&
      this.retryLeft(config.schedule)
    )
      return {
        at: this.now().toISOString(),
        trigger,
        status: "failed",
        message: `SYMBOLS_UNAVAILABLE: ${unavailable(failures)}`,
      };

    const snapshots: BookSnapshot[] = [];
    /** Books that replayed a new session: only these add records, fills and digest sections. */
    const fresh = new Set<string>();
    const records: Signal[] = [];
    const fillUpdates: Parameters<SignalLog["applyFills"]>[0] = [];
    const charts: Record<string, ChartsFile> = {};
    const ledgerWrites: PaperLedger[] = [];
    let logged: Signal[] | null = null;
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
        drivers: (i, at) => topDrivers(ruleContributions(system, i, at)),
      });
      const ledger = replay.ledger;
      let signals = replay.signals;
      if (stored && stored.lastSession >= system.dates[t]) {
        // Already committed for this session (a book enabled after today's
        // run, or a retry after part of the commit): replay found nothing, so
        // keep its logged signals and leave it out of records and the digest.
        logged ??= (await this.signalLog.list()).map(({ emailed: _emailed, ...s }) => s);
        signals = logged.filter((s) => s.book === book.id && s.asOf === ledger.lastSession);
        if (ledger.configHash !== stored.configHash) ledgerWrites.push(ledger);
      } else {
        fresh.add(book.id);
        records.push(...replay.signals);
        fillUpdates.push(...replay.fills);
        ledgerWrites.push(ledger);
      }
      snapshots.push({
        book: book.id,
        name: book.name,
        classes: book.classes.map((c) => ({ id: c.id, name: c.name })),
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
        signals,
        paper: paperSummary(ledger),
      });
      charts[book.id] = {
        version: STRATEGY_ENGINE_VERSION,
        charts: symbolCharts(frame, book.id),
      };
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
    // Commit order: signals, charts, latest, email, then the ledgers. A run
    // that dies before the ledgers replays the same sessions on retry, and the
    // log dedupes the same signal ids (worst case a repeated digest).
    await this.signalLog.applyFills(fillUpdates);
    await this.signalLog.append(records);
    for (const [id, file] of Object.entries(charts)) {
      await writeJsonAtomic(this.file(`charts-${id}.json`), file);
      this.chartCache.set(id, Promise.resolve(file));
    }
    await writeJsonAtomic(this.file("latest.json"), snapshot);
    this.latestCache = Promise.resolve(snapshot);

    job.step = "email";
    let emailed = false;
    const digest = snapshots.filter((b) => fresh.has(b.book));
    if (digest.length && (records.length || config.email.sendWhenNoSignals)) {
      const entry = await this.email(
        "signals",
        renderSignalDigest(
          { ...snapshot, books: digest },
          { locale: config.email.locale, baseUrl: this.options.baseUrl },
        ),
      );
      emailed = entry.status === "sent";
      if (emailed) await this.signalLog.markEmailed(records.map((r) => r.id));
    }
    for (const ledger of ledgerWrites)
      await writeJsonAtomic(this.file(`paper-${ledger.book}.json`), ledger);
    return {
      at: this.now().toISOString(),
      trigger,
      status: "complete",
      asOf: snapshot.asOf,
      emailed,
      ...(failures.length && {
        message: `${failures.length} symbols unavailable: ${unavailable(failures)}`,
      }),
    };
  }

  private async backtest(
    job: StrategyJob,
    trigger: StrategyJob["trigger"],
  ): Promise<RunRecord> {
    const { config, books, hash, panel, failures } = await this.load(job);
    // runBacktest adds the four legacy event studies to this persistent log.
    const trials = (await readJson<string[]>(this.file("trials.json"))) ?? [];
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

/** "NVDA, ARM, XLK", naming at most NAMED_FAILURES and counting the rest. */
function unavailable(failures: Loaded["failures"]) {
  const more = failures.length - NAMED_FAILURES;
  return (
    failures
      .slice(0, NAMED_FAILURES)
      .map((f) => f.symbol)
      .join(", ") + (more > 0 ? ` +${more}` : "")
  );
}

/** Signal drivers: the three largest non-zero contributions at 4 dp (spec §7.4). */
function topDrivers(contributions: RuleContribution[]): RuleContribution[] {
  return contributions
    .map((d) => ({ rule: d.rule, contribution: r4(d.contribution) }))
    .filter((d): d is RuleContribution => d.contribution !== null && d.contribution !== 0)
    .slice(0, 3);
}

/** The weekly backtest slot after the current one, where retries resume after a give-up. */
function nextWeeklySlot(now: Date, schedule: StrategyConfig["schedule"]) {
  const clock = newYorkClock(now);
  let back = (clock.weekday - schedule.weeklyDay + 7) % 7;
  if (back === 0 && clock.time < schedule.weeklyAt) back = 7;
  return newYorkInstant(addDays(clock.date, 7 - back), schedule.weeklyAt).toISOString();
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
