import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { ResearchService, safeUrl } from "./service";
import { createResearchRoutes } from "../routes/researchRoutes";
import { apiErrorHandler, ApiError } from "../http/apiError";
import type { ResearchReport } from "../../shared/research";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function setup(kind = "CS", denied = false) {
  const dir = await mkdtemp(join(tmpdir(), "research-"));
  dirs.push(dir);
  const market = {
    getHistory: vi.fn(
      async ({ symbol, range }: { symbol: string; range: "5y" | "1y" }) => ({
        symbol,
        range,
        bars: Array.from({ length: 300 }, (_, i) => ({
          timestamp: new Date(Date.UTC(2020, 0, i + 1, 21)).toISOString(),
          close: 100 + i,
          open: 100 + i,
          high: 101 + i,
          low: 99 + i,
          volume: 100,
        })),
      }),
    ),
  };
  const getJson = vi.fn(async (path: string) => {
    if (path.includes("/tickers/"))
      return {
        results: {
          name: "Example",
          type: kind,
          market_cap: 10000,
          homepage_url: "javascript:alert(1)",
        },
      };
    if (path.includes("/news"))
      return {
        results: [
          {
            title: "News",
            article_url: "https://example.com/news",
            published_utc: "2020-10-01T00:00:00Z",
            publisher: { name: "Example" },
          },
          { title: "Unsafe", article_url: "javascript:alert(1)" },
        ],
      };
    if (denied) throw new ApiError(403, "DENIED", "secret must not leak");
    if (path.includes("/ratios"))
      return {
        results: [
          {
            date: "2020-10-01",
            price_to_earnings: -10,
            free_cash_flow: 100,
            market_cap: 10000,
          },
        ],
      };
    return {
      results: [
        {
          period_end: "2020-09-30",
          filing_date: "2020-10-20",
          fiscal_year: 2020,
          fiscal_quarter: 3,
          revenue: 120,
          gross_profit: 60,
          operating_income: 24,
          diluted_earnings_per_share: 2,
        },
        {
          period_end: "2019-09-30",
          fiscal_year: 2019,
          fiscal_quarter: 3,
          revenue: 100,
          diluted_earnings_per_share: 1,
        },
      ],
    };
  });
  const client = {
    getJson:
      getJson as unknown as import("../market/polygonClient").PolygonClient["getJson"],
  };
  const service = new ResearchService(market, client, dir);
  const app = express();
  app.use(express.json());
  app.use("/api", createResearchRoutes(service));
  app.use(apiErrorHandler);
  return { service, market, client, getJson, dir, app };
}
async function done(service: ResearchService, id: string) {
  await vi.waitFor(async () =>
    expect((await service.get(id)).status).not.toBe("running"),
  );
  return service.get(id);
}
const input = {
  symbol: "AAPL",
  benchmark: "SPY",
  locale: "en" as const,
  module: "all" as const,
};
describe("research job lifecycle", () => {
  it("runs, persists and refreshes news without rerunning quantitative data", async () => {
    const { service, market, client, dir } = await setup();
    const initial = await service.start(input);
    const report = await done(service, initial.id);
    expect(report.status).toBe("partial");
    expect(report.sections.ai.message).toBe("AI_NOT_CONFIGURED");
    expect(report.news).toHaveLength(1);
    expect(report.homepage).toBeUndefined();
    expect(
      report.metrics.find((m) => m.id === "revenueGrowth")?.value,
    ).toBeCloseTo(20);
    expect(
      report.metrics.find((m) => m.id === "price_to_earnings")?.value,
    ).toBeNull();
    const reopened = new ResearchService(market, client, dir);
    expect((await reopened.get(report.id)).prices).toEqual(report.prices);
    const next = await service.start({
      ...input,
      module: "news",
      baseId: report.id,
    });
    const refreshed = await done(service, next.id);
    expect(market.getHistory).toHaveBeenCalledTimes(2);
    expect(refreshed.sections.quant).toEqual(report.sections.quant);
    expect(refreshed.metrics).toEqual(report.metrics);
    expect((await service.get(report.id)).sections.news).toEqual(
      report.sections.news,
    );
  });
  it("isolates denied financials and applies a distinct ETF template", async () => {
    const a = await setup("CS", true);
    const report = await done(a.service, (await a.service.start(input)).id);
    expect(report.sections.quant.status).toBe("complete");
    expect(report.sections.fundamentals.message).toBe("FINANCIALS_ENTITLEMENT");
    expect(JSON.stringify(report)).not.toContain("secret");
    const b = await setup("ETF");
    const etf = await done(
      b.service,
      (await b.service.start({ ...input, symbol: "SPY" })).id,
    );
    expect(etf.kind).toBe("etf");
    expect(etf.sections.fundamentals.message).toBe("ETF_FEED_REQUIRED");
    expect(b.getJson.mock.calls.some(([p]) => p.includes("financials"))).toBe(
      false,
    );
    expect(etf.metrics.some((m) => m.id === "price_to_earnings")).toBe(false);
  });
  it("deduplicates concurrent requests and rejects malformed inputs", async () => {
    const { service, app } = await setup();
    const [a, b] = await Promise.all([
      service.start(input),
      service.start(input),
    ]);
    expect(a.id).toBe(b.id);
    await done(service, a.id);
    expect((await service.list()).length).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/research")
          .send({ ...input, symbol: "../../etc" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/research")
          .send({ ...input, module: "news" })
      ).status,
    ).toBe(400);
    expect((await request(app).get("/api/research/not-a-uuid")).status).toBe(
      400,
    );
  });
  it("marks interrupted tasks as failed after restart", async () => {
    const { service, market, client, dir } = await setup();
    const report = await done(service, (await service.start(input)).id);
    report.status = "running";
    report.sections.news = { status: "running" };
    await writeFile(join(dir, "reports.json"), JSON.stringify([report]));
    const restarted = new ResearchService(market, client, dir);
    expect((await restarted.get(report.id)).sections.news.message).toBe(
      "INTERRUPTED",
    );
  });
  it("enforces the persisted hourly budget", async () => {
    const { service, market, client, dir } = await setup();
    const report = await done(service, (await service.start(input)).id);
    await writeFile(
      join(dir, "reports.json"),
      JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({
          ...report,
          id: `saved-${i}`,
          symbol: `X${i}`,
        })),
      ),
    );
    const restarted = new ResearchService(market, client, dir);
    await expect(restarted.start(input)).rejects.toMatchObject({ status: 429 });
  });
  it("fails quantitative data independently when history is unavailable", async () => {
    const { service, market } = await setup();
    market.getHistory.mockRejectedValue(
      new ApiError(503, "MISSING", "private key"),
    );
    const report = await done(service, (await service.start(input)).id);
    expect(report.sections.quant).toMatchObject({
      status: "failed",
      message: "PROVIDER_503",
    });
    expect(report.sections.news.status).toBe("complete");
    expect(report.metrics.every((m) => m.group === "fundamentals")).toBe(true);
  });
  it("parses model output server-side without persisting credentials", async () => {
    const { market, client, dir } = await setup();
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                content: [
                  { type: "output_text", text: "Evidence-based summary [1]." },
                ],
              },
            ],
          }),
        ),
    );
    const service = new ResearchService(
      market,
      client,
      dir,
      "private-api-key",
      "configured-model",
      fetcher,
    );
    const report = await done(service, (await service.start(input)).id);
    expect(report.narrative).toBe("Evidence-based summary [1].");
    expect(report.status).toBe("complete");
    expect(JSON.stringify(report)).not.toContain("private-api-key");
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).store).toBe(
      false,
    );
  });
  it("allows only safe public links", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://user:pass@example.com")).toBeUndefined();
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
  });
});
