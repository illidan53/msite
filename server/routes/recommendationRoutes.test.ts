import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { RecommendationCandidate } from "../../shared/types";
import { createApp } from "../app";
import { apiErrorHandler } from "../http/apiError";
import { createRecommendationRoutes, type RecommendationRouteService } from "./recommendationRoutes";

describe("recommendation routes", () => {
  it("calls the service with validated defaults", async () => {
    const candidates: RecommendationCandidate[] = [
      {
        symbol: "NVDA",
        name: "NVIDIA Corporation",
        score: 100,
        reasons: ["user pinned"],
        source: "pinned",
      },
    ];
    const service: RecommendationRouteService = {
      recommend: vi.fn(async () => candidates),
    };

    const response = await request(createRecommendationTestApp(service))
      .post("/api/watchlists/recommendations")
      .send({ theme: "semiconductors" });

    expect(response.status).toBe(200);
    expect(service.recommend).toHaveBeenCalledWith({
      theme: "semiconductors",
      pinnedSymbols: [],
      excludedSymbols: [],
      limit: 8,
    });
    expect(response.body).toEqual(candidates);
  });

  it("rejects invalid payloads with a structured validation error", async () => {
    const service: RecommendationRouteService = {
      recommend: vi.fn(async () => []),
    };

    const response = await request(createRecommendationTestApp(service))
      .post("/api/watchlists/recommendations")
      .send({
        theme: "",
        pinnedSymbols: ["NVDA", ""],
        excludedSymbols: "AMD",
        limit: 51,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.any(Array),
      message: "Invalid recommendation input",
      source: "recommendations",
    });
    expect(service.recommend).not.toHaveBeenCalled();
  });

  it("rejects too many pinned symbols with a structured validation error", async () => {
    const service: RecommendationRouteService = {
      recommend: vi.fn(async () => []),
    };

    const response = await request(createRecommendationTestApp(service))
      .post("/api/watchlists/recommendations")
      .send({
        theme: "semiconductors",
        pinnedSymbols: Array.from({ length: 26 }, (_, index) => `SYM${index}`),
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["pinnedSymbols"],
        }),
      ]),
      message: "Invalid recommendation input",
      source: "recommendations",
    });
    expect(service.recommend).not.toHaveBeenCalled();
  });

  it("rejects unsafe ticker symbols with a structured validation error", async () => {
    const service: RecommendationRouteService = {
      recommend: vi.fn(async () => []),
    };

    const response = await request(createRecommendationTestApp(service))
      .post("/api/watchlists/recommendations")
      .send({
        theme: "semiconductors",
        pinnedSymbols: ["AAPL/../../MSFT"],
        excludedSymbols: ["NVDA"],
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ["pinnedSymbols", 0],
        }),
      ]),
      message: "Invalid recommendation input",
      source: "recommendations",
    });
    expect(service.recommend).not.toHaveBeenCalled();
  });

  it("mounts recommendation validation under the shared api app", async () => {
    const response = await request(createApp())
      .post("/api/watchlists/recommendations")
      .send({ theme: "", limit: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Invalid recommendation input",
      source: "recommendations",
    });
  });
});

function createRecommendationTestApp(service: RecommendationRouteService) {
  const app = express();
  app.use(express.json());
  app.use("/api", createRecommendationRoutes(service));
  app.use(apiErrorHandler);
  return app;
}
