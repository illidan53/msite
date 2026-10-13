import { describe, expect, it } from "vitest";
import { parseSettingsConfig, parseWatchlistsConfig } from "./schemas";

describe("shared config schemas", () => {
  it("parses a sample watchlist with rows and pinned symbols", () => {
    const parsed = parseWatchlistsConfig({
      watchlists: [
        {
          id: "semiconductors",
          name: "Semiconductors",
          description: "Large semiconductor names and user focus list",
          theme: "semiconductors",
          navigationGroup: "primary",
          selectionNote: "Coverage before capitalization",
          pinnedSymbols: ["nvda", " AMD "],
          symbolDescriptions: {
            " amd ": "AI accelerator chips",
            nvda: "AI GPU platforms",
          },
          rows: [
            {
              id: "leaders",
              name: "Leaders",
              expandedByDefault: true,
              symbols: ["nvda", "AMD", " avgo "],
            },
            {
              id: "equipment",
              name: "Equipment",
              expandedByDefault: false,
              symbols: ["ASML", "AMAT", "LRCX"],
            },
          ],
        },
      ],
    });

    expect(parsed.watchlists[0]).toMatchObject({
      id: "semiconductors",
      navigationGroup: "primary",
      selectionNote: "Coverage before capitalization",
      pinnedSymbols: ["NVDA", "AMD"],
      symbolDescriptions: {
        AMD: "AI accelerator chips",
        NVDA: "AI GPU platforms",
      },
      rows: [
        {
          id: "leaders",
          expandedByDefault: true,
          symbols: ["NVDA", "AMD", "AVGO"],
        },
        {
          id: "equipment",
          expandedByDefault: false,
          symbols: ["ASML", "AMAT", "LRCX"],
        },
      ],
    });
  });

  it("rejects unsafe source links while preserving dated provenance", () => {
    const config = {
      watchlists: [
        {
          id: "cloud",
          name: "Cloud",
          rows: [{ id: "core", name: "Core", symbols: ["CRWV"] }],
          selectionSources: [
            {
              label: "Source",
              url: "https://x.com/example/status/123",
              kind: "discussion",
              publishedAt: "2026-03-13",
            },
          ],
        },
      ],
    };
    expect(
      parseWatchlistsConfig(config).watchlists[0].selectionSources?.[0]
        .publishedAt,
    ).toBe("2026-03-13");
    config.watchlists[0].selectionSources[0].url = "javascript:alert(1)";
    expect(() => parseWatchlistsConfig(config)).toThrow(/HTTPS/);
  });

  it("defaults Polygon to paid Stocks Starter", () => {
    const parsed = parseSettingsConfig({
      polygon: {},
    });

    expect(parsed.polygon).toEqual({
      plan: "paid",
      paidPlanName: "stocks-starter",
      warningThreshold: 0.75,
      hardThreshold: 0.95,
    });
  });

  it("parses overlapping subsectors and rejects ones outside the rows", () => {
    const config = (subsectors: unknown) => ({
      watchlists: [
        {
          id: "chips",
          name: "Chips",
          rows: [{ id: "core", name: "Core", symbols: ["NVDA", "AMD", "ALAB"] }],
          subsectors,
        },
      ],
    });

    expect(
      parseWatchlistsConfig(
        config([
          { id: "ai-chips", name: "AI chips", symbols: ["nvda", " amd "] },
          { id: "cpu", name: "CPUs", description: "Processors", symbols: ["AMD"] },
        ]),
      ).watchlists[0].subsectors,
    ).toEqual([
      { id: "ai-chips", name: "AI chips", symbols: ["NVDA", "AMD"] },
      { id: "cpu", name: "CPUs", description: "Processors", symbols: ["AMD"] },
    ]);
    expect(() =>
      parseWatchlistsConfig(
        config([{ id: "optical", name: "Optical", symbols: ["LITE"] }]),
      ),
    ).toThrow(/LITE, which is not in the watchlist rows/);
    expect(() =>
      parseWatchlistsConfig(
        config([
          { id: "cpu", name: "CPUs", symbols: ["AMD"] },
          { id: "cpu", name: "Again", symbols: ["NVDA"] },
        ]),
      ),
    ).toThrow(/Duplicate subsector id cpu/);
    expect(() =>
      parseWatchlistsConfig(config([{ id: "cpu", name: "CPUs", symbols: [] }])),
    ).toThrow(/symbols/i);
  });

  it("rejects an empty watchlist row symbols array", () => {
    expect(() =>
      parseWatchlistsConfig({
        watchlists: [
          {
            id: "bad",
            name: "Bad",
            rows: [{ id: "empty", name: "Empty", symbols: [] }],
          },
        ],
      }),
    ).toThrow(/symbols/i);
  });
});
