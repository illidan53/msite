import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { evaluateRatePlan } from "./ratePlanner";

describe("evaluateRatePlan", () => {
  it("warns for aggressive local load on Stocks Starter without disabling intervals", () => {
    const result = evaluateRatePlan({
      plan: "paid",
      paidPlanName: "Stocks Starter",
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 50,
      intervalSeconds: 10,
      endpointCount: 4,
      cacheHitRatio: 0.2,
    });

    expect(result).toMatchObject({
      budgetCallsPerMinute: null,
      disabledIntervals: [],
      estimatedCallsPerMinute: 20,
      ratio: 0,
      status: "warning",
    });
    expect(result.message).toContain("Stocks Starter");
    expect(result.message).toMatch(/unlimited REST/i);
    expect(result.message).toMatch(/local load/i);
  });

  it("blocks the free plan when estimated calls exceed the 5 calls per minute budget", () => {
    const result = evaluateRatePlan({
      plan: "free",
      warningThreshold: 0.5,
      hardThreshold: 1,
      activeSymbolCount: 1,
      intervalSeconds: 10,
      endpointCount: 1,
      cacheHitRatio: 0,
    });

    expect(result).toMatchObject({
      budgetCallsPerMinute: 5,
      estimatedCallsPerMinute: 6,
      ratio: 1.2,
      status: "blocked",
    });
    expect(result.disabledIntervals).toEqual([5, 10]);
    expect(result.message).toContain("5 calls/min");
  });

  it("warns custom plans when estimated calls reach the configured warning threshold", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 12,
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 1,
      intervalSeconds: 30,
      endpointCount: 3,
      cacheHitRatio: 0,
    });

    expect(result).toMatchObject({
      budgetCallsPerMinute: 12,
      disabledIntervals: [5, 10, 15],
      estimatedCallsPerMinute: 6,
      ratio: 0.5,
      status: "warning",
    });
    expect(result.message).toContain("12 calls/min");
  });
});

describe("rate plan routes", () => {
  it("evaluates rate plans under the api route", async () => {
    const response = await request(createApp())
      .post("/api/rate-plan/evaluate")
      .send({
        plan: "custom",
        customCallsPerMinute: 20,
        warningThreshold: 0.4,
        hardThreshold: 0.9,
        activeSymbolCount: 1,
        intervalSeconds: 15,
        endpointCount: 3,
        cacheHitRatio: 0.25,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      budgetCallsPerMinute: 20,
      estimatedCallsPerMinute: 9,
      status: "warning",
    });
  });
});
