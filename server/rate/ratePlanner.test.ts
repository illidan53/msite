import { describe, expect, it } from "vitest";
import { evaluateRatePlan } from "./ratePlanner";

describe("evaluateRatePlan", () => {
  it("warns for aggressive local load on Stocks Starter without disabling intervals", () => {
    const result = evaluateRatePlan({
      plan: "paid",
      paidPlanName: "Stocks Starter",
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 50,
      intervalSeconds: 3_600,
      endpointCount: 4,
      cacheHitRatio: 0.2,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 3,
      intervalSeconds: 3_600,
      message: expect.stringMatching(/Stocks Starter.*unlimited REST/i),
      plan: "paid",
      status: "ok",
    });
  });

  it("blocks the free plan when estimated calls exceed the 5 calls per minute budget", () => {
    const result = evaluateRatePlan({
      plan: "free",
      warningThreshold: 0.5,
      hardThreshold: 1,
      activeSymbolCount: 1_000,
      intervalSeconds: 3_600,
      endpointCount: 1,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [3_600, 10_800],
      estimatedCallsPerMinute: 17,
      intervalSeconds: 3_600,
      message: expect.stringContaining("5 calls/min"),
      plan: "free",
      status: "blocked",
    });
  });

  it("warns custom plans when estimated calls reach the configured warning threshold", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 12,
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 400,
      intervalSeconds: 3_600,
      endpointCount: 1,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 7,
      intervalSeconds: 3_600,
      message: expect.stringContaining("12 calls/min"),
      plan: "custom",
      status: "warning",
    });
  });

  it("includes active symbol count in the original custom budget example", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 60,
      warningThreshold: 0.75,
      hardThreshold: 1.1,
      activeSymbolCount: 1_500,
      intervalSeconds: 3_600,
      endpointCount: 2,
      cacheHitRatio: 0.25,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 38,
      intervalSeconds: 3_600,
      message: expect.stringContaining("60 calls/min"),
      plan: "custom",
      status: "ok",
    });
  });

  it("estimates zero calls when there are no active symbols", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 60,
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 0,
      intervalSeconds: 3_600,
      endpointCount: 2,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 0,
      intervalSeconds: 3_600,
      message: expect.stringContaining("0 calls/min"),
      plan: "custom",
      status: "ok",
    });
  });
});
