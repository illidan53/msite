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
          pinnedSymbols: ["nvda", " AMD "],
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
      pinnedSymbols: ["NVDA", "AMD"],
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
