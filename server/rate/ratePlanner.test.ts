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
      intervalSeconds: 10,
      endpointCount: 4,
      cacheHitRatio: 0.2,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 960,
      intervalSeconds: 10,
      message: expect.stringMatching(/Stocks Starter.*unlimited REST.*local load/i),
      plan: "paid",
      status: "warning",
    });
  });

  it("blocks the free plan when estimated calls exceed the 5 calls per minute budget", () => {
    const result = evaluateRatePlan({
      plan: "free",
      warningThreshold: 0.5,
      hardThreshold: 1,
      activeSymbolCount: 2,
      intervalSeconds: 30,
      endpointCount: 2,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [5, 10, 15, 30],
      estimatedCallsPerMinute: 8,
      intervalSeconds: 30,
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
      activeSymbolCount: 1,
      intervalSeconds: 30,
      endpointCount: 3,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [5, 10, 15],
      estimatedCallsPerMinute: 6,
      intervalSeconds: 30,
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
      activeSymbolCount: 20,
      intervalSeconds: 30,
      endpointCount: 2,
      cacheHitRatio: 0.25,
    });

    expect(result).toEqual({
      disabledIntervals: [5, 10, 15],
      estimatedCallsPerMinute: 60,
      intervalSeconds: 30,
      message: expect.stringContaining("60 calls/min"),
      plan: "custom",
      status: "warning",
    });
  });

  it("estimates zero calls when there are no active symbols", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 60,
      warningThreshold: 0.5,
      hardThreshold: 0.9,
      activeSymbolCount: 0,
      intervalSeconds: 5,
      endpointCount: 2,
      cacheHitRatio: 0,
    });

    expect(result).toEqual({
      disabledIntervals: [],
      estimatedCallsPerMinute: 0,
      intervalSeconds: 5,
      message: expect.stringContaining("0 calls/min"),
      plan: "custom",
      status: "ok",
    });
  });
});
