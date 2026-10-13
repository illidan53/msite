import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistsConfig } from "../../shared/types";
import { apiErrorHandler } from "../http/apiError";
import { createConfigRoutes, type SymbolLookup } from "../routes/configRoutes";
import { ConfigRepository } from "./configRepository";
import { applyWatchlistEdits, type WatchlistEdits } from "./watchlistEdits";

const watchlistsYaml = `watchlists:
  - id: chips
    name: Chips
    pinnedSymbols: [NVDA]
    symbolDescriptions:
      NVDA: GPUs
    rows:
      - id: compute
        name: Compute
        symbols: [NVDA, AMD]
      - id: tools
        name: Tools
        symbols: [ASML]
  - id: staples
    name: Staples
    rows:
      - id: core
        name: Core
        symbols: [COST]
`;
const settingsYaml = "polygon:\n  plan: paid\n";

const symbolsOf = (config: WatchlistsConfig, listId: string) =>
  Object.fromEntries(
    config.watchlists
      .find((list) => list.id === listId)!
      .rows.map((row) => [row.id, row.symbols]),
  );

describe("applyWatchlistEdits", () => {
  const base: WatchlistsConfig = {
    watchlists: [
      {
        id: "chips",
        name: "Chips",
        pinnedSymbols: ["NVDA"],
        symbolDescriptions: { NVDA: "GPUs" },
        rows: [
          { id: "compute", name: "Compute", expandedByDefault: true, symbols: ["NVDA", "AMD"] },
          { id: "tools", name: "Tools", expandedByDefault: true, symbols: ["ASML"] },
        ],
      },
    ],
  };
  const edits = (lists: WatchlistEdits["lists"]): WatchlistEdits => ({
    version: 1,
    updatedAt: null,
    lists,
  });

  it("removes, appends and moves symbols without touching the base", () => {
    const merged = applyWatchlistEdits(
      base,
      edits({
        chips: {
          removed: ["NVDA", "ASML"],
          added: [
            { symbol: "TSM", rowId: "tools", description: "Foundry" },
            { symbol: "NVDA", rowId: "tools" },
            { symbol: "AMD", rowId: "tools" },
          ],
        },
        unknown: { removed: ["X"], added: [] },
      }),
    );

    expect(symbolsOf(merged, "chips")).toEqual({
      compute: ["AMD"],
      tools: ["TSM", "NVDA"],
    });
    const chips = merged.watchlists[0];
    expect(chips.pinnedSymbols).toEqual([]);
    expect(chips.symbolDescriptions).toEqual({ NVDA: "GPUs", TSM: "Foundry" });
    expect(base.watchlists[0].rows[0].symbols).toEqual(["NVDA", "AMD"]);
  });

  it("places an addition whose row left the YAML in the last row", () => {
    const merged = applyWatchlistEdits(
      base,
      edits({ chips: { removed: [], added: [{ symbol: "MU", rowId: "gone" }] } }),
    );

    expect(symbolsOf(merged, "chips").tools).toEqual(["ASML", "MU"]);
  });
});

describe("watchlist editing", () => {
  let root: string;
  let configDir: string;
  let dataDir: string;
  let repository: ConfigRepository;
  let lookupSymbol: ReturnType<typeof vi.fn<SymbolLookup>>;

  const app = (allowedIps: string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) => {
    const server = express();
    server.use(express.json());
    server.use(
      "/api",
      createConfigRoutes({
        repository,
        lookupSymbol,
        access: { allowedIps, trustedProxyIps: [] },
      }),
    );
    server.use(apiErrorHandler);
    return server;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "watchlist-edits-"));
    configDir = join(root, "config");
    dataDir = join(root, "data");
    await mkdir(configDir);
    await writeFile(join(configDir, "watchlists.yaml"), watchlistsYaml);
    await writeFile(join(configDir, "settings.yaml"), settingsYaml);
    repository = new ConfigRepository({ configDir, dataDir });
    lookupSymbol = vi.fn<SymbolLookup>(async (symbol) =>
      symbol === "NOPE" ? null : { symbol, name: `${symbol} Inc.` },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("adds a verified symbol to a row and persists it across instances", async () => {
    const response = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: " tsm ", rowId: "tools", description: " Foundry " })
      .expect(201);

    expect(lookupSymbol).toHaveBeenCalledWith("TSM");
    expect(response.body).toMatchObject({ symbol: "TSM", name: "TSM Inc." });
    expect(symbolsOf(response.body.watchlists, "chips").tools).toEqual(["ASML", "TSM"]);

    const reloaded = new ConfigRepository({ configDir, dataDir });
    const config = await reloaded.readConfig();
    expect(symbolsOf(config.watchlists, "chips").tools).toEqual(["ASML", "TSM"]);
    expect(config.watchlists.watchlists[0].symbolDescriptions?.TSM).toBe("Foundry");
    const listed = await request(app()).get("/api/watchlists").expect(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(symbolsOf(listed.body, "chips").tools).toEqual(["ASML", "TSM"]);
    // The YAML itself is never rewritten.
    expect(await readFile(join(configDir, "watchlists.yaml"), "utf8")).toBe(watchlistsYaml);
  });

  it("removes a symbol and restores it to its own row when re-added", async () => {
    const removed = await request(app())
      .delete("/api/watchlists/chips/symbols/nvda")
      .expect(200);

    expect(removed.body.symbol).toBe("NVDA");
    expect(symbolsOf(removed.body.watchlists, "chips").compute).toEqual(["AMD"]);
    expect(removed.body.watchlists.watchlists[0].pinnedSymbols).toEqual([]);

    const restored = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "NVDA", rowId: "compute", description: "GPUs" })
      .expect(201);
    expect(symbolsOf(restored.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    // An undone removal leaves no edits behind.
    expect(JSON.parse(await readFile(join(dataDir, "watchlist-edits.json"), "utf8")).lists).toEqual({});
  });

  it("moves a YAML symbol to another row after removing it", async () => {
    await request(app()).delete("/api/watchlists/chips/symbols/AMD").expect(200);
    const moved = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "AMD", rowId: "tools" })
      .expect(201);

    expect(symbolsOf(moved.body.watchlists, "chips")).toEqual({
      compute: ["NVDA"],
      tools: ["ASML", "AMD"],
    });
  });

  it("removes a runtime addition entirely", async () => {
    await request(app())
      .post("/api/watchlists/staples/symbols")
      .send({ symbol: "WMT", rowId: "core" })
      .expect(201);
    const removed = await request(app())
      .delete("/api/watchlists/staples/symbols/WMT")
      .expect(200);

    expect(symbolsOf(removed.body.watchlists, "staples").core).toEqual(["COST"]);
  });

  it("rejects invalid, unknown, duplicate and last-symbol edits", async () => {
    const server = app();
    const post = (listId: string, body: object) =>
      request(server).post(`/api/watchlists/${listId}/symbols`).send(body);
    const code = async (response: Promise<request.Response>, status: number) => {
      const result = await response;
      expect(result.status).toBe(status);
      return result.body.code as string;
    };

    expect(await code(post("chips", { symbol: "$$", rowId: "tools" }), 400)).toBe("INVALID_WATCHLIST_EDIT");
    expect(await code(post("chips", { symbol: "TSM", rowId: "tools", extra: 1 }), 400)).toBe("INVALID_WATCHLIST_EDIT");
    expect(await code(post("chips", { symbol: "NOPE", rowId: "tools" }), 404)).toBe("UNKNOWN_SYMBOL");
    expect(await code(post("nope", { symbol: "TSM", rowId: "tools" }), 404)).toBe("WATCHLIST_NOT_FOUND");
    expect(await code(post("chips", { symbol: "TSM", rowId: "nope" }), 400)).toBe("WATCHLIST_ROW_NOT_FOUND");
    expect(await code(post("chips", { symbol: "AMD", rowId: "tools" }), 409)).toBe("WATCHLIST_SYMBOL_EXISTS");
    expect(await code(request(server).delete("/api/watchlists/chips/symbols/TSM"), 404)).toBe("WATCHLIST_SYMBOL_NOT_FOUND");
    expect(await code(request(server).delete("/api/watchlists/staples/symbols/COST"), 409)).toBe("WATCHLIST_LAST_SYMBOL");

    lookupSymbol.mockRejectedValueOnce(new Error("provider down"));
    expect(await code(post("chips", { symbol: "TSM", rowId: "tools" }), 502)).toBe("SYMBOL_LOOKUP_FAILED");
    expect(symbolsOf(await repository.readWatchlists(), "chips").tools).toEqual(["ASML"]);
  });

  it("keeps edits to the IP allowlist and same-site JSON requests", async () => {
    const denied = app([]);
    const forbidden = await request(denied)
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("RESEARCH_IP_FORBIDDEN");
    await request(denied).delete("/api/watchlists/chips/symbols/NVDA").expect(403);

    const allowed = app();
    await request(allowed)
      .post("/api/watchlists/chips/symbols")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("symbol=TSM&rowId=tools")
      .expect(415);
    const foreign = await request(allowed)
      .delete("/api/watchlists/chips/symbols/NVDA")
      .set("Origin", "https://evil.example");
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe("CROSS_SITE_REQUEST");
    await request(allowed)
      .post("/api/watchlists/chips/symbols")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ symbol: "TSM", rowId: "tools" })
      .expect(403);
    expect(lookupSymbol).not.toHaveBeenCalled();
    expect(await repository.readWatchlists()).toEqual(await repository.readBaseWatchlists());
  });

  it("serialises concurrent additions so none is lost", async () => {
    const server = app();
    await Promise.all(
      ["TSM", "MU", "INTC"].map((symbol) =>
        request(server)
          .post("/api/watchlists/chips/symbols")
          .send({ symbol, rowId: "tools" })
          .expect(201),
      ),
    );

    expect(new Set(symbolsOf(await repository.readWatchlists(), "chips").tools)).toEqual(
      new Set(["ASML", "TSM", "MU", "INTC"]),
    );
  });

  it("is read-only without a data directory", async () => {
    repository = new ConfigRepository({ configDir });
    const response = await request(app())
      .delete("/api/watchlists/chips/symbols/NVDA");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("WATCHLIST_EDITS_UNAVAILABLE");
  });
});
