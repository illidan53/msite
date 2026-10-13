import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Watchlist } from "../../shared/types";
import { loadStrategyConfig, resolveBooks } from "./config";

const list = (id: string, symbols: string[]): Watchlist => ({
  id,
  name: id,
  pinnedSymbols: [],
  rows: [{ id: "core", name: "Core", expandedByDefault: true, symbols }],
});

describe("resolveBooks", () => {
  it("leaves a symbol that is only on an excluded list out of the stock book", async () => {
    const config = await loadStrategyConfig(join(process.cwd(), "config"));
    const [stocks] = resolveBooks(config, {
      watchlists: [
        list("industrials-defense", ["GE"]),
        list("energy", ["XOM"]),
        list("close-watch", ["XOM", "ETN", "ZZZZ"]),
      ],
    });

    expect(stocks.id).toBe("stocks");
    expect(stocks.symbols).toEqual(["GE", "ETN", "XOM"]);
    expect(stocks.classOf).toMatchObject({ GE: "industrials-defense", ETN: "industrials-defense", XOM: "energy" });
    expect(stocks.classOf.ZZZZ).toBeUndefined();
  });
});
