import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { STRATEGY_ENGINE_VERSION } from "../../shared/strategy";
import type { PriceBar, PriceSeries, WatchlistsConfig } from "../../shared/types";
import { ApiError, apiErrorHandler } from "../http/apiError";
import { createStrategyRoutes } from "../routes/strategyRoutes";
import { configHash, loadStrategyConfig, resolveBooks } from "./config";
import type { Mailer } from "./mailer";
import { addDays, newYorkInstant } from "./scheduler";
import { StrategyService } from "./service";

afterEach(() => {
  vi.restoreAllMocks();
});

const SESSIONS = 620;
/** Weekday sessions from 2023-01-02; deterministic drifting sine-and-noise closes. */
function sessions(count: number) {
  const dates: string[] = [];
  const day = new Date("2023-01-02T00:00:00Z");
  while (dates.length < count) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}
const DATES = sessions(SESSIONS + 5);
function bars(seed: number, count: number): PriceBar[] {
  let state = seed * 7919 + 13;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  let close = 50 + seed * 3;
  return DATES.slice(0, count).map((date, i) => {
    const drift = 0.0006 * Math.sin(i / (40 + seed * 5) + seed);
    const open = close * (1 + random() * 0.01);
    close = Math.max(1, open * (1 + drift + random() * 0.025));
    return {
      timestamp: `${date}T05:00:00.000Z`,
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 2_000_000 + seed * 10_000,
    };
  });
}

const STOCKS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ"];
const SECTORS = ["S1", "S2", "S3", "S4"];
const watchlists: WatchlistsConfig = {
  watchlists: [
    {
      id: "alpha",
      name: "Alpha",
      pinnedSymbols: [],
      rows: [
        { id: "a1", name: "A1", expandedByDefault: true, symbols: STOCKS.slice(0, 3) },
        { id: "a2", name: "A2", expandedByDefault: true, symbols: STOCKS.slice(3, 5) },
      ],
    },
    {
      id: "beta",
      name: "Beta",
      pinnedSymbols: [],
      rows: [{ id: "b1", name: "B1", expandedByDefault: true, symbols: STOCKS.slice(5) }],
    },
  ],
};

type Sent = { subject: string; text: string; html: string };

async function setup(options: { count?: number; config?: (yaml: any) => void } = {}) {
  const root = await mkdtemp(join(tmpdir(), "strategy-"));
  const configDir = join(root, "config");
  const dataDir = join(root, "data");
  const base = YAML.parse(
    await readFile(join(process.cwd(), "config/strategy.yaml"), "utf8"),
  );
  base.books = [
    { ...base.books[0], classExcludeLists: [], classOverrides: {} },
    { ...base.books[1], symbols: SECTORS },
  ];
  options.config?.(base);
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "strategy.yaml"), YAML.stringify(base));
  let count = options.count ?? SESSIONS;
  const universe = ["SPY", ...STOCKS, ...SECTORS];
  /** Symbols whose fetch fails (503), and symbols with too little history. */
  const failing = new Set<string>();
  const short = new Set<string>();
  const market = {
    getHistory: vi.fn(async ({ symbol }: { symbol: string }): Promise<PriceSeries> => {
      if (failing.has(symbol)) throw new ApiError(503, "UPSTREAM_UNAVAILABLE", "down");
      return {
        symbol,
        range: "5y",
        bars: bars(universe.indexOf(symbol) + 1, short.has(symbol) ? 1 : count),
      };
    }),
  };
  let now = new Date(`${DATES[count]}T15:00:00Z`);
  const sent: Sent[] = [];
  /** Set to make the next sends throw (a crash in the email step). */
  const mail = { fail: false };
  const mailer: Mailer = {
    configured: false,
    transport: "none",
    send: async (message) => {
      if (mail.fail) throw new Error("mailer crashed");
      sent.push(message);
      return { status: "disabled" };
    },
  };
  const make = () =>
    new StrategyService({
      market,
      configDir,
      dataDir,
      readWatchlists: async () => watchlists,
      mailer,
      baseUrl: "https://example.test",
      now: () => now,
      retryDelayMs: 1,
    });
  const env = {
    service: make(),
    market,
    sent,
    mail,
    failing,
    short,
    configDir,
    dataDir,
    strategyFile: (name: string) => join(dataDir, "strategy", name),
    /** A new process on the same files (a deploy or restart). */
    restart() {
      env.service = make();
      return env.service;
    },
    advance(sessionsAhead = 1) {
      count += sessionsAhead;
      now = new Date(`${DATES[count]}T15:00:00Z`);
    },
    /** New York wall time on the current day (after the newest bar). */
    at(time: string) {
      now = newYorkInstant(DATES[count], time);
    },
    setNow(at: Date) {
      now = at;
    },
    today: () => DATES[count],
  };
  return env;
}

describe("StrategyService daily run", () => {
  it("creates paper ledgers, a snapshot, signals and a digest, then skips the same session", async () => {
    const { service, sent } = await setup();
    const first = await service.runDaily("manual");
    expect(first).toMatchObject({ status: "complete", asOf: DATES[SESSIONS - 1] });
    const latest = await service.latest();
    expect(latest.books.map((b) => b.book)).toEqual(["stocks", "sectors"]);
    const stocks = latest.books[0];
    expect(stocks.rows).toHaveLength(STOCKS.length);
    expect(stocks.paper).toMatchObject({ inception: DATES[SESSIONS - 1], capital: 100_000 });
    const signals = latest.books.flatMap((b) => b.signals);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.action === "entry" && s.toShares > 0)).toBe(true);
    expect(await service.signals(100)).toHaveLength(signals.length);
    expect(sent).toHaveLength(1);
    const outbox = await service.outbox();
    expect(outbox[0]).toMatchObject({ kind: "signals", status: "disabled" });

    const again = await service.runDaily("schedule");
    expect(again.status).toBe("skipped");
    expect(sent).toHaveLength(1);
  });

  it("fills yesterday's orders at the next open on the following run", async () => {
    const env = await setup();
    await env.service.runDaily("manual");
    const before = await env.service.latest();
    env.advance();
    const next = await env.service.runDaily("schedule");
    expect(next).toMatchObject({ status: "complete", asOf: DATES[SESSIONS] });
    const ledger = await env.service.paper("stocks");
    const entries = before.books[0].signals;
    expect(ledger.fills.length).toBe(entries.length);
    for (const fill of ledger.fills) {
      expect(fill.date).toBe(DATES[SESSIONS]);
      expect(fill.cost).toBeGreaterThan(0);
    }
    const history = await env.service.signals(1000);
    const filled = history.filter((s) => s.fill && "price" in s.fill);
    expect(filled.length).toBe(entries.length + before.books[1].signals.length);
  });

  it("serves symbol charts for the latest 252 sessions", async () => {
    const { service } = await setup();
    await service.runDaily("manual");
    const chart = await service.chart("stocks", "AAA");
    expect(chart.dates).toHaveLength(252);
    expect(chart.close).toHaveLength(252);
    expect(Object.keys(chart.families).sort()).toEqual(
      ["mean_reversion", "relative_momentum", "sector_trend", "trend"],
    );
    await expect(service.chart("stocks", "ZZZ")).rejects.toMatchObject({ status: 404 });
  });

  it("gives signals at most three non-zero drivers and books their class names", async () => {
    const { service } = await setup();
    await service.runDaily("manual");
    const latest = await service.latest();
    const signals = latest.books.flatMap((b) => b.signals);
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.drivers.length).toBeGreaterThan(0);
      expect(signal.drivers.length).toBeLessThanOrEqual(3);
      const sizes = signal.drivers.map((d) => Math.abs(d.contribution));
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      for (const d of signal.drivers) {
        expect(d.contribution).not.toBe(0);
        expect(Math.round(d.contribution * 1e4) / 1e4).toBe(d.contribution);
      }
    }
    expect(latest.books.map((b) => b.classes)).toEqual([
      [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "Beta" },
      ],
      [{ id: "sectors", name: "SPDR sectors" }],
    ]);
  });

  it("serves charts and the snapshot from memory, replacing them when a run writes", async () => {
    const env = await setup();
    await env.service.runDaily("manual");
    const service = env.restart();
    expect((await service.chart("stocks", "AAA")).symbol).toBe("AAA");
    const asOf = (await service.latest()).asOf;
    // Requests after the first parse never read the files again.
    await writeFile(env.strategyFile("charts-stocks.json"), "not json");
    await writeFile(env.strategyFile("latest.json"), "not json");
    expect((await service.chart("stocks", "BBB")).symbol).toBe("BBB");
    await expect(service.chart("stocks", "ZZZ")).rejects.toMatchObject({ status: 404 });
    expect((await service.latest()).asOf).toBe(asOf);
    expect((await service.state()).latest?.asOf).toBe(asOf);

    env.advance();
    await service.runDaily("schedule");
    expect((await service.chart("stocks", "AAA")).asOf).toBe(DATES[SESSIONS]);
    expect((await service.latest()).asOf).toBe(DATES[SESSIONS]);
  });
});

describe("StrategyService daily commit and recovery", () => {
  it("replays a run that failed before its ledgers were saved instead of skipping it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await setup();
    await env.service.runDaily("manual");
    env.advance(2); // the fixture's next session with stock signals
    const asOf = DATES[SESSIONS + 1];
    env.mail.fail = true;
    expect((await env.service.runDaily("schedule")).status).toBe("failed");
    // Signals, charts and latest.json were written; the ledgers were not.
    expect((await env.service.latest()).asOf).toBe(asOf);
    expect((await env.service.paper("stocks")).lastSession).toBe(DATES[SESSIONS - 1]);

    env.mail.fail = false;
    const retry = await env.service.runDaily("schedule");
    expect(retry).toMatchObject({ status: "complete", asOf });
    expect(env.sent).toHaveLength(2);
    expect((await env.service.paper("stocks")).lastSession).toBe(asOf);
    const history = await env.service.signals(1000);
    expect(new Set(history.map((s) => s.id)).size).toBe(history.length);
    const first = history.filter((s) => s.asOf === DATES[SESSIONS - 1]);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((s) => s.fill && "price" in s.fill)).toBe(true);
    const latest = await env.service.latest();
    const decided = history.filter((s) => s.asOf === asOf);
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.map((s) => s.id).sort()).toEqual(
      latest.books.flatMap((b) => b.signals.map((s) => s.id)).sort(),
    );
  });

  it("keeps the signals of a book already committed and leaves it out of the digest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await setup({ config: (yaml) => (yaml.email.sendWhenNoSignals = true) });
    await env.service.runDaily("manual");
    env.advance(2); // the fixture's next session with stock signals
    const asOf = DATES[SESSIONS + 1];
    // The sectors ledger cannot be written: the run dies between the two ledgers.
    await mkdir(env.strategyFile("paper-sectors.json.tmp/blocked"), { recursive: true });
    expect((await env.service.runDaily("schedule")).status).toBe("failed");
    expect((await env.service.paper("stocks")).lastSession).toBe(asOf);
    expect((await env.service.paper("sectors")).lastSession).toBe(DATES[SESSIONS - 1]);
    const decided = (await env.service.latest()).books[0].signals;
    expect(decided.length).toBeGreaterThan(0);

    await rm(env.strategyFile("paper-sectors.json.tmp"), { recursive: true });
    const retry = await env.service.runDaily("schedule");
    expect(retry).toMatchObject({ status: "complete", asOf });
    const latest = await env.service.latest();
    expect(latest.books[0].signals).toEqual(decided);
    expect((await env.service.paper("sectors")).lastSession).toBe(asOf);
    // The retry's digest covers only the book that had not been committed.
    expect(env.sent).toHaveLength(3);
    expect(env.sent[2].subject).toContain(`板块 ETF 组合 ${latest.books[1].signals.length}`);
    expect(env.sent[2].subject).not.toContain("个股组合");
    expect(env.sent[1].subject).toContain("个股组合");
    const history = await env.service.signals(1000);
    expect(new Set(history.map((s) => s.id)).size).toBe(history.length);
  });

  it("rebuilds outputs left on another engine version without trading or emailing", async () => {
    const env = await setup();
    await env.service.runDaily("manual");
    const before = await env.service.latest();
    const ledger = await env.service.paper("stocks");
    // A version bump leaves these files behind, and the deploy restarts the service.
    for (const name of ["latest.json", "charts-stocks.json", "charts-sectors.json"]) {
      const file = JSON.parse(await readFile(env.strategyFile(name), "utf8"));
      await writeFile(
        env.strategyFile(name),
        JSON.stringify({ ...file, version: STRATEGY_ENGINE_VERSION - 1 }),
      );
    }
    const service = env.restart();
    await expect(service.latest()).rejects.toMatchObject({ status: 404 });
    const rebuilt = await service.runDaily("manual");
    expect(rebuilt).toMatchObject({ status: "complete", asOf: DATES[SESSIONS - 1], emailed: false });
    expect(env.sent).toHaveLength(1);
    const latest = await service.latest();
    expect(latest.books.map((b) => b.signals)).toEqual(before.books.map((b) => b.signals));
    expect((await service.chart("sectors", "S1")).symbol).toBe("S1");
    expect(await service.paper("stocks")).toEqual(ledger);
    expect((await service.runDaily("schedule")).status).toBe("skipped");
  });

  it("retries a scheduled run while symbols are unavailable, then proceeds on the last attempt", async () => {
    const env = await setup();
    env.failing.add("CCC");
    env.at("11:00");
    const early = await env.service.runDaily("schedule");
    expect(early).toMatchObject({ status: "failed", message: "SYMBOLS_UNAVAILABLE: CCC" });
    await expect(env.service.latest()).rejects.toMatchObject({ status: 404 });
    expect((await env.service.state()).lastFailure).toMatchObject({
      job: "daily",
      message: "SYMBOLS_UNAVAILABLE: CCC",
    });
    // A manual run proceeds and names what was missing.
    const manual = await env.service.runDaily("manual");
    expect(manual).toMatchObject({ status: "complete", message: "1 symbols unavailable: CCC" });

    env.advance();
    env.at("11:45"); // the next retry would be 12:15, after the 12:00 give-up
    const last = await env.service.runDaily("schedule");
    expect(last).toMatchObject({ status: "complete", message: "1 symbols unavailable: CCC" });

    // A symbol without history will not recover by retrying.
    env.failing.clear();
    env.short.add("DDD");
    env.advance();
    env.at("07:00");
    expect(await env.service.runDaily("schedule")).toMatchObject({
      status: "complete",
      message: "1 symbols unavailable: DDD",
    });
  });

  it("tracks failures per job kind and clears them on any later run of that kind", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await setup();
    await env.service.runDaily("manual");
    env.failing.add("SPY");
    expect((await env.service.runDaily("schedule")).status).toBe("failed");
    expect((await env.service.state()).lastFailure).toMatchObject({
      job: "daily",
      message: "UPSTREAM_UNAVAILABLE",
    });
    env.failing.clear();
    expect((await env.service.runDaily("schedule")).status).toBe("skipped");
    expect((await env.service.state()).lastFailure).toBeNull();

    env.failing.add("SPY");
    expect((await env.service.runBacktest("schedule")).status).toBe("failed");
    env.failing.clear();
    env.advance();
    expect((await env.service.runDaily("schedule")).status).toBe("complete");
    expect((await env.service.state()).lastFailure).toMatchObject({
      job: "backtest",
      message: "BENCHMARK_UNAVAILABLE",
    });
  });
});

describe("StrategyService alerts", () => {
  it("emails daily and backtest give-ups with the config hash and the next slot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await setup();
    const config = await loadStrategyConfig(env.configDir);
    const hash = configHash(config, resolveBooks(config, watchlists));
    // The Saturday after the data: the daily run failed at 07:00, the backtest is due.
    let saturday = env.today();
    while (new Date(`${saturday}T12:00:00Z`).getUTCDay() !== 6) saturday = addDays(saturday, 1);
    await mkdir(join(env.dataDir, "strategy"), { recursive: true });
    await writeFile(
      env.strategyFile("scheduler.json"),
      JSON.stringify({
        version: 1,
        lastDaily: null,
        lastBacktest: null,
        daily: {
          date: saturday,
          attempts: 1,
          lastAttemptAt: newYorkInstant(saturday, "07:00").toISOString(),
          done: false,
          gaveUp: false,
        },
        backtest: { completedAt: null, slot: null, attempts: 0, lastAttemptAt: null },
      }),
    );
    env.failing.add("SPY");
    const scheduler = await env.service.getScheduler();
    for (const time of ["12:05", "12:06", "12:37", "13:08"]) {
      env.setNow(newYorkInstant(saturday, time));
      await scheduler.tick();
    }
    expect(env.sent).toHaveLength(2);
    expect(env.sent[0].subject).toContain("每日信号");
    expect(env.sent[1].subject).toContain("每周回测");
    for (const message of env.sent) expect(message.text).toContain(hash);
    expect(env.sent[1].text).toContain("BENCHMARK_UNAVAILABLE");
    expect(env.sent[1].text).toContain(`${addDays(saturday, 7)} 09:00`);
    expect((await env.service.outbox()).map((e) => e.kind)).toEqual(["failure", "failure"]);
  });

  it("puts the config hash in test emails", async () => {
    const env = await setup();
    const config = await loadStrategyConfig(env.configDir);
    await env.service.testEmail();
    expect(env.sent[0].text).toContain(configHash(config, resolveBooks(config, watchlists)));
  });
});

describe("StrategyService backtest", () => {
  it("saves a report with every run, an index and the trial log", async () => {
    const { service, sent } = await setup();
    const record = await service.runBacktest("manual");
    expect(record.status).toBe("complete");
    const [summary] = await service.reports();
    const report = await service.report(summary.id);
    expect(report.books.map((b) => b.book)).toEqual(["stocks", "sectors"]);
    for (const book of report.books) {
      expect(book.runs.map((r) => r.id).sort()).toEqual(
        [
          "core",
          "long_short",
          "trend_filter",
          "vol_attenuation",
          "whole_shares",
          "without_trend",
          "without_sector_trend",
          "without_relative_momentum",
          "without_mean_reversion",
          "spy_buy_hold",
          "equal_weight_buy_hold",
          "risk_parity_buy_hold",
        ].sort(),
      );
      for (const run of book.runs) expect(run.curve).toHaveLength(book.dates.length);
    }
    // Manual backtests do not email; scheduled ones do.
    expect(sent).toHaveLength(0);
    await service.runBacktest("schedule");
    expect(sent).toHaveLength(1);
    expect((await service.reports()).length).toBe(2);
  });
});

describe("StrategyService state and limits", () => {
  it("reports state without recipient details and refuses concurrent manual runs", async () => {
    const { service } = await setup();
    const state = await service.state();
    expect(state.books.map((b) => b.id)).toEqual(["stocks", "sectors"]);
    expect(state.email).toEqual({ configured: false, transport: "none", lastSent: null });
    expect(state.latest).toBeNull();
    const started = await service.start("daily");
    expect(started.job?.kind).toBe("daily");
    await expect(service.start("backtest")).rejects.toMatchObject({ status: 409 });
    await service.settled();
    expect((await service.state()).scheduler.lastDaily?.status).toBe("complete");
  });

  it("limits test emails", async () => {
    const { service } = await setup();
    expect((await service.testEmail()).kind).toBe("test");
    await expect(service.testEmail()).rejects.toMatchObject({ status: 429 });
  });

  it("survives a manual run whose scheduler state cannot be saved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await setup();
    // A rename onto a non-empty directory fails, like a full or read-only disk.
    await mkdir(env.strategyFile("scheduler.json/blocked"), { recursive: true });
    await env.service.start("daily");
    await env.service.settled();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith("Quant system run state not saved", expect.anything()),
    );
    expect((await env.service.latest()).asOf).toBe(DATES[SESSIONS - 1]);
  });
});

describe("strategy routes", () => {
  const app = (service: StrategyService, allowed: string[]) => {
    const server = express();
    server.use(express.json());
    server.use(
      "/api",
      createStrategyRoutes(service, { allowedIps: allowed, trustedProxyIps: [] }),
    );
    server.use(apiErrorHandler);
    return server;
  };
  it("serves public reads and gates runs by IP", async () => {
    const { service } = await setup();
    const denied = app(service, []);
    await request(denied).get("/api/strategy/latest").expect(404);
    const state = await request(denied).get("/api/strategy/state").expect(200);
    expect(state.headers["cache-control"]).toBe("no-store");
    await request(denied).post("/api/strategy/run").send({ job: "daily" }).expect(403);
    await request(denied).post("/api/strategy/test-email").expect(403);
    await request(denied).get("/api/strategy/charts/stocks/%24BAD").expect(400);
    await request(denied).get("/api/strategy/reports/not-a-uuid").expect(400);

    const allowed = app(service, ["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
    await request(allowed).post("/api/strategy/run").send({ job: "nope" }).expect(400);
    const accepted = await request(allowed)
      .post("/api/strategy/run")
      .send({ job: "daily" })
      .expect(202);
    expect(accepted.body.job.kind).toBe("daily");
    await service.settled();
    const latest = await request(allowed).get("/api/strategy/latest").expect(200);
    expect(latest.body.books).toHaveLength(2);
    await request(allowed).get("/api/strategy/paper/stocks").expect(200);
    await request(allowed).get("/api/strategy/signals?limit=5").expect(200);
  });

  it("refuses cross-site and non-JSON posts from an allowed IP", async () => {
    const { service, sent } = await setup();
    const allowed = app(service, ["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
    const post = (path: string) => request(allowed).post(`/api/strategy/${path}`);
    // A cross-site form post or no-cors fetch needs no preflight.
    const form = await post("test-email")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("");
    expect(form.status).toBe(415);
    expect(form.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    await post("test-email").expect(415);
    await post("run").set("Content-Type", "text/plain").send('{"job":"daily"}').expect(415);
    const foreign = await post("test-email").set("Origin", "https://evil.example").send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe("CROSS_SITE_REQUEST");
    await post("test-email").set("Origin", "null").send({}).expect(403);
    await post("run").set("Sec-Fetch-Site", "cross-site").send({ job: "daily" }).expect(403);
    expect(sent).toHaveLength(0);

    await post("test-email")
      .set("Host", "finance.example")
      .set("Origin", "https://finance.example")
      .set("Sec-Fetch-Site", "same-origin")
      .send({})
      .expect(202);
    expect(sent).toHaveLength(1);
  });
});
