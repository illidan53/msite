import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, PriceSeries } from "../../shared/types";
import { createApp } from "../app";
import { apiErrorHandler } from "../http/apiError";
import { createMarketRoutes, type MarketRouteProvider } from "./marketRoutes";

describe("market routes", () => {
  it("returns a structured missing-key error for snapshots without exposing secrets", async () => {
    const response = await request(createApp({ polygonApiKey: "" }))
      .post("/api/market/snapshots")
      .send({ symbols: ["AAPL"] });

    const bodyText = JSON.stringify(response.body);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "POLYGON_API_KEY_MISSING",
      source: "polygon",
    });
    expect(bodyText).not.toContain("apiKey");
    expect(bodyText).not.toContain("super-secret-polygon-key");
  });

  it("rejects empty snapshot symbol arrays with a structured validation error", async () => {
    const provider = createFakeProvider();

    const response = await request(createMarketTestApp(provider)).post("/api/market/snapshots").send({ symbols: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Invalid market input",
      source: "market",
    });
    expect(provider.getSnapshots).not.toHaveBeenCalled();
  });

  it("rejects path-breaking snapshot symbols with a structured validation error", async () => {
    const provider = createFakeProvider();

    const response = await request(createMarketTestApp(provider))
      .post("/api/market/snapshots")
      .send({ symbols: ["AAPL/../../MSFT?x#y"] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["symbols", 0],
        }),
      ]),
      message: "Invalid market input",
      source: "market",
    });
    expect(provider.getSnapshots).not.toHaveBeenCalled();
  });

  it("rejects invalid history ranges with a structured validation error", async () => {
    const provider = createFakeProvider();

    const response = await request(createMarketTestApp(provider)).get("/api/market/history").query({
      symbol: "AAPL",
      range: "MAX",
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["range"],
        }),
      ]),
      message: "Invalid market input",
      source: "market",
    });
    expect(provider.getHistory).not.toHaveBeenCalled();
  });

  it("returns snapshots from the provider for validated symbols", async () => {
    const snapshots: MarketSnapshot[] = [
      {
        symbol: "NVDA",
        name: "NVIDIA Corporation",
        price: 950,
        change: 12.34,
        changePercent: 2.5,
        sessionChange: 12.34,
        sessionChangePercent: 2.5,
        volume: 123_456,
        updatedAt: "2024-05-22T17:46:40.000Z",
        timeframe: "DELAYED",
      },
    ];
    const provider = createFakeProvider({ snapshots });

    const response = await request(createMarketTestApp(provider))
      .post("/api/market/snapshots")
      .send({ symbols: [" nvda ", "BRK.B-A"] });

    expect(response.status).toBe(200);
    expect(provider.getSnapshots).toHaveBeenCalledWith(["NVDA", "BRK.B-A"]);
    expect(response.body).toEqual(snapshots);
  });

  it("returns history from the provider for a validated query", async () => {
    const series: PriceSeries = {
      symbol: "AAPL",
      range: "30d",
      bars: [
        {
          timestamp: "2024-05-22T17:46:40.000Z",
          open: 190,
          high: 195,
          low: 188,
          close: 194,
          volume: 1_000,
        },
      ],
    };
    const provider = createFakeProvider({ series });

    const response = await request(createMarketTestApp(provider)).get("/api/market/history").query({
      symbol: " aapl ",
      range: "30d",
    });

    expect(response.status).toBe(200);
    expect(provider.getHistory).toHaveBeenCalledWith({ symbol: "AAPL", range: "30d" });
    expect(response.body).toEqual(series);
  });

  it("accepts only dashboard history ranges for validated symbols", async () => {
    const provider = createFakeProvider();

    const response = await request(createMarketTestApp(provider)).get("/api/market/history").query({
      symbol: "nvda",
      range: "3month",
    });
    const removedRangeResponse = await request(createMarketTestApp(provider)).get("/api/market/history").query({
      symbol: "nvda",
      range: "2month",
    });

    expect(response.status).toBe(200);
    expect(provider.getHistory).toHaveBeenCalledWith({ symbol: "NVDA", range: "3month" });
    expect(removedRangeResponse.status).toBe(400);
  });
});

function createMarketTestApp(provider: MarketRouteProvider) {
  const app = express();
  app.use(express.json());
  app.use("/api", createMarketRoutes(provider));
  app.use(apiErrorHandler);
  return app;
}

function createFakeProvider(output: { series?: PriceSeries; snapshots?: MarketSnapshot[] } = {}): MarketRouteProvider {
  const defaultSeries: PriceSeries = { symbol: "AAPL", range: "1d", bars: [] };

  return {
    getHistory: vi.fn(async () => output.series ?? defaultSeries),
    getSnapshots: vi.fn(async () => output.snapshots ?? []),
  };
}
