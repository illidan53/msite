import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("rate plan routes", () => {
  it("evaluates rate plans under the api route with the shared response shape", async () => {
    const response = await request(createApp())
      .post("/api/rate-plan/evaluate")
      .send({
        plan: "custom",
        customCallsPerMinute: 20,
        warningThreshold: 0.4,
        hardThreshold: 0.9,
        activeSymbolCount: 700,
        intervalSeconds: 3_600,
        endpointCount: 1,
        cacheHitRatio: 0.25,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      disabledIntervals: [10, 60, 300, 1_800],
      estimatedCallsPerMinute: 9,
      intervalSeconds: 3_600,
      message: expect.stringContaining("20 calls/min"),
      plan: "custom",
      status: "warning",
    });
  });

  it("rejects missing rate plan fields with a structured validation error", async () => {
    const response = await request(createApp()).post("/api/rate-plan/evaluate").send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.any(Array),
      message: "Invalid rate plan input",
      source: "rate",
    });
  });

  it("rejects negative custom call budgets with a structured validation error", async () => {
    const response = await request(createApp())
      .post("/api/rate-plan/evaluate")
      .send({
        plan: "custom",
        customCallsPerMinute: -1,
        warningThreshold: 0.5,
        hardThreshold: 0.9,
        activeSymbolCount: 1,
        intervalSeconds: 15,
        endpointCount: 3,
        cacheHitRatio: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.any(Array),
      message: "Invalid rate plan input",
      source: "rate",
    });
  });

  it("rejects thresholds below the canonical settings range", async () => {
    const response = await request(createApp())
      .post("/api/rate-plan/evaluate")
      .send({
        plan: "custom",
        customCallsPerMinute: 60,
        warningThreshold: -1,
        hardThreshold: 0,
        activeSymbolCount: 1,
        intervalSeconds: 15,
        endpointCount: 3,
        cacheHitRatio: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.any(Array),
      message: "Invalid rate plan input",
      source: "rate",
    });
  });

  it("rejects thresholds above the canonical settings range", async () => {
    const response = await request(createApp())
      .post("/api/rate-plan/evaluate")
      .send({
        plan: "custom",
        customCallsPerMinute: 60,
        warningThreshold: 0.75,
        hardThreshold: 1.1,
        activeSymbolCount: 1,
        intervalSeconds: 15,
        endpointCount: 3,
        cacheHitRatio: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.any(Array),
      message: "Invalid rate plan input",
      source: "rate",
    });
  });
});
