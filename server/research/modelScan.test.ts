import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import type { PriceBar, WatchlistsConfig } from "../../shared/types";
import { etfs } from "../../shared/etfs";
import { quantModelIds } from "../../shared/research";
import { apiErrorHandler, ApiError } from "../http/apiError";
import { createModelRoutes } from "../routes/modelRoutes";
import { calculateEma200Study } from "./ema200";
import { calculateQuantModels } from "./pullback";
import {
  ModelScanService,
  fitScore,
  fitTier,
  scanSymbol,
  scanUniverse,
  type ScanUniverse,
} from "./modelScan";

function wave(n = 700, phase = 0): PriceBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.03 + 7 * Math.sin((i + phase) / 15);
    return {
      timestamp: new Date(
        Date.UTC(2020, 0, 1, 21) + i * 86400000,
      ).toISOString(),
      open: close,
      close,
      high: close + 1,
      low: close - 1,
      volume: 100,
    };
  });
}
const config: WatchlistsConfig = {
  watchlists: [
    {
      id: "chips",
      name: "Semiconductors",
      theme: "semiconductors",
      pinnedSymbols: [],
      rows: [
        {
          id: "a",
          name: "A",
          expandedByDefault: true,
          symbols: ["nvda", "AMD"],
        },
        { id: "b", name: "B", expandedByDefault: true, symbols: ["NVDA"] },
      ],
    },
    {
      id: "tech",
      name: "Mega-Cap Tech",
      theme: "tech",
      pinnedSymbols: [],
      rows: [
        {
          id: "c",
          name: "C",
          expandedByDefault: true,
          symbols: ["NVDA", "SPY"],
        },
      ],
    },
  ],
};

describe("scan universe", () => {
  it("deduplicates watchlist symbols and appends the ETF catalog", () => {
    const universe = scanUniverse(config);
    expect(universe.lists.map((l) => l.id)).toEqual(["chips", "tech", "etf"]);
    expect(universe.symbols.slice(0, 3)).toEqual([
      { symbol: "NVDA", lists: ["chips", "tech"] },
      { symbol: "AMD", lists: ["chips"] },
      { symbol: "SPY", lists: ["tech", "etf"] },
    ]);
    expect(universe.symbols).toHaveLength(2 + etfs.length);
    expect(new Set(universe.symbols.map((s) => s.symbol)).size).toBe(
      universe.symbols.length,
    );
  });
});

describe("fit ranking", () => {
  it("measures the advantage in bootstrap standard errors", () => {
    expect(fitScore(2, [0.04, 3.96])).toBeCloseTo(2);
    expect(fitScore(null, [0, 1])).toBeNull();
    expect(fitScore(1, null)).toBeNull();
    expect(fitScore(1, [1, 1])).toBeNull();
  });
  it("keeps tiers consistent with the model's own evidence status", () => {
    expect(fitTier("positive", 2.5, 1)).toBe("high");
    expect(fitTier("negative", -2.5, -1)).toBe("contrary");
    expect(fitTier("insufficient", null, 1)).toBe("insufficient");
    expect(fitTier("inconclusive", 1.4, 0.5)).toBe("moderate");
    // A relative advantage that still lost money is not a moderate fit.
    expect(fitTier("inconclusive", 1.4, -0.5)).toBe("low");
    expect(fitTier("inconclusive", 0.6, 0.5)).toBe("low");
  });
  it("demotes a significant touch model with too many unreclaimed breakdowns", () => {
    expect(fitTier("positive", 2.5, 1, { mature: 12, failed: 3 })).toBe("high");
    expect(fitTier("positive", 2.5, 1, { mature: 12, failed: 4 })).toBe(
      "moderate",
    );
    expect(fitTier("positive", 2.5, 1, null)).toBe("high");
    expect(fitTier("negative", -2.5, -1, { mature: 12, failed: 0 })).toBe(
      "contrary",
    );
  });
});

describe("scanSymbol", () => {
  it("summarizes every model from the same studies as My Quant", () => {
    const bars = wave();
    const result = scanSymbol(bars);
    const ema = calculateEma200Study(bars);
    const set = calculateQuantModels(bars);
    expect(Object.keys(result.fits)).toEqual(quantModelIds);
    const emaMain = ema.horizons.find((h) => h.sessions === 20)!;
    expect(result.fits.ema200).toMatchObject({
      status: ema.status,
      primaryHorizon: 20,
      events: emaMain.events,
      controls: emaMain.controls,
      lastEvent: ema.events.at(-1)?.date ?? null,
    });
    expect(result.fits.ema200.lift).toBeCloseTo(emaMain.lift!, 4);
    expect(result.fits.ema200.reading).toBeCloseTo(ema.distance!, 4);
    for (const study of set.models) {
      const fit = result.fits[study.id];
      const primary = study.horizons.find(
        (h) => h.sessions === study.primaryHorizon,
      )!;
      expect(fit.status).toBe(study.status);
      expect(fit.primaryHorizon).toBe(study.primaryHorizon);
      expect(fit.events).toBe(primary.events);
      expect(fit.signal).toBe(study.current.signal);
      expect(fit.sessionsSince).toBe(study.current.sessionsSince);
    }
    expect(result.fits.ema200.breakdowns).toEqual(ema.failure);
    expect(result.fits.sma50.breakdowns).toEqual(
      set.models.find((m) => m.id === "sma50")!.failure,
    );
    expect(result.fits.rsi2.breakdowns).toBeNull();
    expect(result.fits.bollinger.breakdowns).toBeNull();
    expect(result.fits.rsi2.reading).toBeCloseTo(
      set.models.find((m) => m.id === "rsi2")!.current.readings.rsi2!,
      4,
    );
  });
  it("aligns every chart series with the shared 252-session axis", () => {
    const bars = wave();
    const { chart, fits } = scanSymbol(bars);
    expect(chart.dates).toHaveLength(252);
    expect(chart.close).toHaveLength(252);
    expect(chart.dates.at(-1)).toBe(chart.asOf);
    for (const id of quantModelIds) {
      const model = chart.models[id];
      for (const line of Object.values(model.lines))
        expect(line).toHaveLength(252);
      if (model.band) {
        expect(model.band.upper).toHaveLength(252);
        expect(model.band.lower).toHaveLength(252);
      }
      expect(model.events.every((i) => i >= 0 && i < 252)).toBe(true);
    }
    const ema = calculateEma200Study(bars);
    expect(chart.models.ema200.lines.ema200.at(-1)).toBeCloseTo(ema.ema!, 3);
    expect(chart.models.ema200.events).toEqual(
      ema.chart.flatMap((p, i) => (p.touch ? [i] : [])),
    );
    expect(chart.models.ema200.failed).toEqual(
      ema.chart.flatMap((p, i) =>
        ema.events.some((e) => e.date === p.date && e.failed) ? [i] : [],
      ),
    );
    expect(chart.models.ema200.band!.upper.at(-1)).toBeCloseTo(
      ema.ema! * 1.03,
      3,
    );
    // The latest touch, when inside the chart, is where sessionsSince counts from.
    const lastTouch = chart.models.ema200.events.at(-1);
    if (lastTouch !== undefined && fits.ema200.sessionsSince !== null)
      expect(fits.ema200.sessionsSince).toBe(251 - lastTouch);
  });
  it("marks short histories insufficient instead of failing", () => {
    const { fits, chart } = scanSymbol(wave(120));
    for (const id of quantModelIds) {
      expect(fits[id].tier).toBe("insufficient");
      expect(fits[id].score).toBeNull();
    }
    expect(fits.ema200.reading).toBeNull();
    expect(chart.dates).toHaveLength(120);
  });
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function setup(
  history: (symbol: string, range: "5y" | "1y") => PriceBar[] = () => wave(),
  universe: ScanUniverse = {
    lists: [
      { id: "chips", name: "Semiconductors" },
      { id: "etf", name: "Sectors & ETFs" },
    ],
    symbols: [
      { symbol: "NVDA", lists: ["chips"] },
      { symbol: "AMD", lists: ["chips"] },
      { symbol: "SPY", lists: ["etf"] },
    ],
  },
) {
  const dir = await mkdtemp(join(tmpdir(), "model-scan-"));
  dirs.push(dir);
  const market = {
    getHistory: vi.fn(
      async ({ symbol, range }: { symbol: string; range: "5y" | "1y" }) => ({
        symbol,
        range,
        bars: history(symbol, range),
      }),
    ),
  };
  const create = () =>
    new ModelScanService(market, async () => universe, dir, {
      retryDelayMs: 1,
    });
  return { dir, market, create, service: create() };
}

describe("ModelScanService", () => {
  it("scans the universe in the background, persists and reloads it", async () => {
    const { service, market, create } = await setup((symbol) => {
      if (symbol === "AMD") throw new ApiError(404, "X", "missing");
      return wave(700, symbol === "SPY" ? 40 : 0);
    });
    expect(await service.state()).toEqual({
      scan: null,
      job: null,
      lastFailure: null,
    });
    const started = await service.start();
    expect(started.job).toMatchObject({ done: 0 });
    // A second start while running joins the same job.
    expect((await service.start()).job?.id).toBe(started.job!.id);
    await service.settled();
    const { scan, job, lastFailure } = await service.state();
    expect(job).toBeNull();
    expect(lastFailure).toBeNull();
    expect(scan).toMatchObject({
      id: started.job!.id,
      status: "partial",
      failures: [{ symbol: "AMD", message: "PROVIDER_404" }],
    });
    expect(scan!.rows.map((r) => r.symbol)).toEqual(["NVDA", "SPY"]);
    expect(scan!.rows[0].lists).toEqual(["chips"]);
    expect(scan!.asOf).toBe(scan!.rows[0].asOf);
    expect(market.getHistory).toHaveBeenCalledTimes(3);
    const chart = await service.chart("SPY");
    expect(chart.symbol).toBe("SPY");
    expect(chart.dates).toHaveLength(252);
    await expect(service.chart("AMD")).rejects.toMatchObject({ status: 404 });

    const reloaded = create();
    expect((await reloaded.state()).scan).toEqual(scan);
    expect((await reloaded.chart("NVDA")).close).toEqual(
      (await service.chart("NVDA")).close,
    );
  });

  it("falls back to one year when five years are denied and retries throttling once", async () => {
    let throttled = 0;
    const { service, market } = await setup((symbol, range) => {
      if (symbol === "NVDA" && throttled++ === 0)
        throw new ApiError(429, "SLOW", "slow down");
      if (range === "5y" && symbol === "SPY")
        throw new ApiError(403, "DENIED", "plan");
      return wave(range === "1y" ? 250 : 700);
    });
    await service.start();
    await service.settled();
    const { scan } = await service.state();
    expect(scan?.status).toBe("complete");
    expect(scan?.rows.find((r) => r.symbol === "SPY")?.sessions).toBe(250);
    expect(
      market.getHistory.mock.calls.filter(([c]) => c.symbol === "NVDA"),
    ).toHaveLength(2);
  });

  it("keeps the previous scan when a rescan fails completely", async () => {
    let fail = false;
    const { service } = await setup(() => {
      if (fail) throw new ApiError(503, "POLYGON_API_KEY_MISSING", "no key");
      return wave();
    });
    await service.start();
    await service.settled();
    const first = (await service.state()).scan;
    fail = true;
    await service.start();
    await service.settled();
    const state = await service.state();
    expect(state.scan).toEqual(first);
    expect(state.lastFailure?.message).toBe("PROVIDER_503");
  });

  it("ignores saved scans from older model definitions or corrupt files", async () => {
    const { dir, service } = await setup();
    await service.start();
    await service.settled();
    const file = join(dir, "model-scan.json");
    const fresh = () =>
      new ModelScanService(
        { getHistory: vi.fn() },
        async () => ({ lists: [], symbols: [] }),
        dir,
      );
    expect((await fresh().state()).scan).not.toBeNull();
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.scan.modelsVersion = -1;
    await writeFile(file, JSON.stringify(stored));
    expect((await fresh().state()).scan).toBeNull();
    await writeFile(file, "{broken");
    expect((await fresh().state()).scan).toBeNull();
  });

  it("limits how often scans can start", async () => {
    const { service } = await setup();
    for (let i = 0; i < 4; i++) {
      await service.start();
      await service.settled();
    }
    await expect(service.start()).rejects.toMatchObject({ status: 429 });
  });
});

describe("model routes", () => {
  it("serves results publicly and restricts scans to allowed IPs", async () => {
    const { service } = await setup();
    const app = (allowed: string[]) =>
      express()
        .use(
          "/api",
          createModelRoutes(service, {
            allowedIps: allowed,
            trustedProxyIps: [],
          }),
        )
        .use(apiErrorHandler);
    const visitor = app(["203.0.113.9"]);
    const owner = app(["127.0.0.1", "::1"]);
    expect((await request(visitor).get("/api/models/scan")).body).toEqual({
      scan: null,
      job: null,
      lastFailure: null,
    });
    const denied = await request(visitor).post("/api/models/scan");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("RESEARCH_IP_FORBIDDEN");
    const accepted = await request(owner).post("/api/models/scan");
    expect(accepted.status).toBe(202);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.body.job.id).toBeTruthy();
    await service.settled();
    const chart = await request(visitor).get("/api/models/charts/nvda");
    expect(chart.status).toBe(200);
    expect(chart.body.symbol).toBe("NVDA");
    expect(
      (await request(visitor).get("/api/models/charts/%24BAD")).status,
    ).toBe(400);
    expect((await request(visitor).get("/api/models/charts/TSLA")).status).toBe(
      404,
    );
  });
});
