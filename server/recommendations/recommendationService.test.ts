import { describe, expect, it, vi } from "vitest";
import { RecommendationService } from "./recommendationService";

describe("RecommendationService", () => {
  it("keeps pinned symbols first and limits system candidates", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return {
          symbol,
          name: `${symbol} Inc.`,
          marketCap:
            {
              AMD: 300_000_000_000,
              AVGO: 200_000_000_000,
              NVDA: 1_000_000,
              TSM: 100_000_000_000,
            }[symbol] ?? 0,
        };
      },
      async getRelatedTickers(seed) {
        expect(seed).toBe("NVDA");
        return ["amd", "AVGO", "TSM"];
      },
      async searchTickers(query) {
        expect(query).toBe("semiconductors");
        return ["TSM", "AVGO", "AMD"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: ["nvda"],
      excludedSymbols: [],
      limit: 3,
    });

    expect(result.map((item) => item.symbol)).toEqual(["NVDA", "AMD", "AVGO"]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ source: "pinned", symbol: "NVDA" });
    expect(result[0].reasons).toContain("user pinned");
  });

  it("omits excluded symbols case-insensitively", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return { symbol, name: symbol, marketCap: marketCaps[symbol] ?? 0 };
      },
      async getRelatedTickers() {
        return [];
      },
      async searchTickers() {
        return ["nvda", "AMD"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: [],
      excludedSymbols: ["nVdA"],
      limit: 5,
    });

    expect(result.map((item) => item.symbol)).toEqual(["AMD"]);
  });

  it("discovers theme candidates without a pinned seed", async () => {
    const getRelatedTickers = vi.fn(async () => ["NVDA"]);
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return { symbol, name: `${symbol} Semiconductor`, marketCap: marketCaps[symbol] ?? 0 };
      },
      getRelatedTickers,
      async searchTickers(query) {
        expect(query).toBe("semiconductors");
        return ["AMAT", "ASML", "TSM"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: [],
      excludedSymbols: [],
      limit: 2,
    });

    expect(getRelatedTickers).not.toHaveBeenCalled();
    expect(result.map((item) => item.symbol)).toEqual(["TSM", "ASML"]);
    expect(result[0]).toMatchObject({ source: "reference" });
    expect(result[0].reasons).toContain("matches semiconductors");
  });

  it("dedupes duplicate symbols case-insensitively", async () => {
    const getTickerDetails = vi.fn(async (symbol: string) => ({
      symbol,
      name: `${symbol} Inc.`,
      marketCap: marketCaps[symbol] ?? 0,
    }));
    const service = new RecommendationService({
      getTickerDetails,
      async getRelatedTickers() {
        return ["amd", "NvDa"];
      },
      async searchTickers() {
        return ["AMD", "avgo", "AVGO"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: ["nvda"],
      excludedSymbols: [],
      limit: 10,
    });

    expect(result.map((item) => item.symbol)).toEqual(["NVDA", "AMD", "AVGO"]);
    expect(getTickerDetails.mock.calls.map(([symbol]) => symbol)).toEqual(["NVDA", "AMD", "AVGO"]);
    expect(result.find((item) => item.symbol === "AMD")).toMatchObject({ source: "related" });
    expect(result.find((item) => item.symbol === "AVGO")).toMatchObject({ source: "reference" });
  });

  it("bounds output to the requested limit and available candidates", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return { symbol, name: symbol, marketCap: marketCaps[symbol] ?? 0 };
      },
      async getRelatedTickers() {
        return [];
      },
      async searchTickers() {
        return ["NVDA", "AMD", "AVGO"];
      },
    });

    await expect(
      service.recommend({
        theme: "semiconductors",
        pinnedSymbols: [],
        excludedSymbols: [],
        limit: 1,
      }),
    ).resolves.toHaveLength(1);

    await expect(
      service.recommend({
        theme: "semiconductors",
        pinnedSymbols: [],
        excludedSymbols: [],
        limit: 50,
      }),
    ).resolves.toHaveLength(3);
  });
});

const marketCaps: Record<string, number> = {
  AMAT: 150_000_000_000,
  AMD: 250_000_000_000,
  ASML: 350_000_000_000,
  AVGO: 200_000_000_000,
  NVDA: 3_000_000_000_000,
  TSM: 700_000_000_000,
};
