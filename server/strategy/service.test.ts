import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import type { PriceBar, PriceSeries, WatchlistsConfig } from "../../shared/types";
import { apiErrorHandler } from "../http/apiError";
import { createStrategyRoutes } from "../routes/strategyRoutes";
import type { Mailer } from "./mailer";
import { StrategyService } from "./service";

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

async function setup(options: { mailer?: Mailer; count?: number } = {}) {
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
  await import("node:fs/promises").then((fs) => fs.mkdir(configDir, { recursive: true }));
  await writeFile(join(configDir, "strategy.yaml"), YAML.stringify(base));
  let count = options.count ?? SESSIONS;
  const universe = ["SPY", ...STOCKS, ...SECTORS];
  const market = {
    getHistory: vi.fn(async ({ symbol }: { symbol: string }): Promise<PriceSeries> => ({
      symbol,
      range: "5y",
      bars: bars(universe.indexOf(symbol) + 1, count),
    })),
  };
  let now = new Date(`${DATES[count]}T15:00:00Z`);
  const sent: unknown[] = [];
  const mailer: Mailer = options.mailer ?? {
    configured: false,
    transport: "none",
    send: async (message) => {
      sent.push(message);
      return { status: "disabled" };
    },
  };
  const service = new StrategyService({
    market,
    configDir,
    dataDir,
    readWatchlists: async () => watchlists,
    mailer,
    baseUrl: "https://example.test",
    now: () => now,
    retryDelayMs: 1,
  });
  return {
    service,
    market,
    sent,
    dataDir,
    advance(sessionsAhead = 1) {
      count += sessionsAhead;
      now = new Date(`${DATES[count]}T15:00:00Z`);
    },
  };
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
});
