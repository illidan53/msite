import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistsConfig } from "../../shared/types";
import { apiErrorHandler } from "../http/apiError";
import { createConfigRoutes, type SymbolLookup } from "../routes/configRoutes";
import { ConfigRepository, type EditingAccount } from "./configRepository";
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
    subsectors:
      - id: ai
        name: AI
        symbols: [NVDA, AMD]
      - id: litho
        name: Litho
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

const ALICE: EditingAccount = {
  id: "alice-account-0000000000",
  provider: "google",
  email: "alice@example.com",
};
const BOB: EditingAccount = { id: "bob-account-00000000000", provider: "microsoft" };

describe("watchlist editing", () => {
  let root: string;
  let configDir: string;
  let dataDir: string;
  let repository: ConfigRepository;
  let lookupSymbol: ReturnType<typeof vi.fn<SymbolLookup>>;
  const aliceFile = () => join(dataDir, "accounts", ALICE.id, "watchlist-edits.json");

  /** The X-Account test header picks the signed-in account; "none" is a visitor. */
  /** Accounts whose session has ended (sign-out or Delete my data). */
  const ended = new Set<string>();
  const app = (editLimit?: { max: number; windowMs: number }) => {
    const server = express();
    server.use(express.json());
    server.use(
      "/api",
      createConfigRoutes({
        repository,
        lookupSymbol,
        editLimit,
        resolveAccount: (request) => {
          const account =
            ({ alice: ALICE, bob: BOB })[request.get("x-account") ?? "alice"] ?? null;
          return account && !ended.has(account.id) ? account : null;
        },
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
    ended.clear();
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
    const config = await reloaded.readConfig(ALICE);
    expect(symbolsOf(config.watchlists, "chips").tools).toEqual(["ASML", "TSM"]);
    expect(config.watchlists.watchlists[0].symbolDescriptions?.TSM).toBe("Foundry");
    const listed = await request(app()).get("/api/watchlists").expect(200);
    expect(listed.headers["cache-control"]).toBe("private, no-store");
    expect(listed.headers.vary).toMatch(/Cookie/);
    expect(symbolsOf(listed.body, "chips").tools).toEqual(["ASML", "TSM"]);
    expect(JSON.parse(await readFile(aliceFile(), "utf8")).account).toEqual({
      provider: "google",
      email: "alice@example.com",
    });
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
    expect(JSON.parse(await readFile(aliceFile(), "utf8")).lists).toEqual({});
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

  it("tags additions with subsectors and drops removed symbols from them", async () => {
    const subsectorsOf = (config: WatchlistsConfig) =>
      Object.fromEntries(
        config.watchlists[0].subsectors!.map((subsector) => [subsector.id, subsector.symbols]),
      );
    const added = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools", subsectors: ["litho", "litho"] })
      .expect(201);
    expect(subsectorsOf(added.body.watchlists)).toEqual({ ai: ["NVDA", "AMD"], litho: ["ASML", "TSM"] });

    const removed = await request(app()).delete("/api/watchlists/chips/symbols/NVDA").expect(200);
    expect(subsectorsOf(removed.body.watchlists).ai).toEqual(["AMD"]);

    // Undo sends the subsectors the symbol had: still a plain restore.
    const restored = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "NVDA", rowId: "compute", subsectors: ["ai"] })
      .expect(201);
    expect(symbolsOf(restored.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    expect(subsectorsOf(restored.body.watchlists).ai).toEqual(["NVDA", "AMD"]);

    // A new tag on a YAML symbol is recorded as an addition.
    await request(app()).delete("/api/watchlists/chips/symbols/AMD").expect(200);
    const tagged = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "AMD", rowId: "compute", subsectors: ["ai", "litho"] })
      .expect(201);
    expect(symbolsOf(tagged.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    expect(subsectorsOf(tagged.body.watchlists)).toEqual({
      ai: ["NVDA", "AMD"],
      litho: ["ASML", "TSM", "AMD"],
    });

    const unknown = await request(app())
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "MU", rowId: "tools", subsectors: ["nope"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("WATCHLIST_SUBSECTOR_NOT_FOUND");
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
    expect(symbolsOf(await repository.readWatchlists(ALICE), "chips").tools).toEqual(["ASML"]);
  });

  it("requires a signed-in account and same-site JSON requests", async () => {
    const server = app();
    const visitor = await request(server)
      .post("/api/watchlists/chips/symbols")
      .set("X-Account", "none")
      .send({ symbol: "TSM", rowId: "tools" });
    expect(visitor.status).toBe(401);
    expect(visitor.body.code).toBe("AUTH_REQUIRED");
    await request(server)
      .delete("/api/watchlists/chips/symbols/NVDA")
      .set("X-Account", "none")
      .expect(401);
    await request(server)
      .delete("/api/watchlists/chips/edits")
      .set("X-Account", "none")
      .expect(401);

    const allowed = server;
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
    expect(await repository.readWatchlists(ALICE)).toEqual(await repository.readBaseWatchlists());
  });

  it("keeps each account's edits to itself", async () => {
    const server = app();
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools" })
      .expect(201);
    await request(server)
      .delete("/api/watchlists/chips/symbols/AMD")
      .set("X-Account", "bob")
      .expect(200);

    const tools = async (account: string) =>
      symbolsOf((await request(server).get("/api/watchlists").set("X-Account", account)).body, "chips");
    expect(await tools("alice")).toEqual({ compute: ["NVDA", "AMD"], tools: ["ASML", "TSM"] });
    expect(await tools("bob")).toEqual({ compute: ["NVDA"], tools: ["ASML"] });
    expect(await tools("none")).toEqual({ compute: ["NVDA", "AMD"], tools: ["ASML"] });
    const config = await request(server).get("/api/config").set("X-Account", "bob");
    expect(symbolsOf(config.body.watchlists, "chips").compute).toEqual(["NVDA"]);
  });

  it("resets one list back to the YAML without touching the others", async () => {
    const server = app();
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools" })
      .expect(201);
    await request(server)
      .post("/api/watchlists/staples/symbols")
      .send({ symbol: "WMT", rowId: "core" })
      .expect(201);

    const reset = await request(server).delete("/api/watchlists/chips/edits").expect(200);
    expect(Object.keys(reset.body)).toEqual(["watchlists"]);
    expect(symbolsOf(reset.body.watchlists, "chips").tools).toEqual(["ASML"]);
    expect(symbolsOf(reset.body.watchlists, "staples").core).toEqual(["COST", "WMT"]);
    // Resetting with nothing saved never creates a file for a new account.
    await request(server).delete("/api/watchlists/chips/edits").set("X-Account", "bob").expect(200);
    await expect(readFile(join(dataDir, "accounts", BOB.id, "watchlist-edits.json"))).rejects.toThrow();
  });

  it("deletes one account's edits for Delete my data", async () => {
    const server = app();
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools" })
      .expect(201);
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .set("X-Account", "bob")
      .send({ symbol: "MU", rowId: "tools" })
      .expect(201);

    await repository.deleteAccountEdits(ALICE);

    await expect(readFile(aliceFile())).rejects.toThrow();
    expect(symbolsOf(await repository.readWatchlists(ALICE), "chips").tools).toEqual(["ASML"]);
    expect(symbolsOf(await repository.readWatchlists(BOB), "chips").tools).toEqual(["ASML", "MU"]);
  });

  it("caps new accounts and each account's edit rate", async () => {
    repository = new ConfigRepository({ configDir, dataDir, limits: { maxAccounts: 1 } });
    const server = app({ max: 2, windowMs: 60_000 });
    const add = (account: string, symbol: string) =>
      request(server)
        .post("/api/watchlists/chips/symbols")
        .set("X-Account", account)
        .send({ symbol, rowId: "tools" });

    expect((await add("alice", "TSM")).status).toBe(201);
    const full = await add("bob", "MU");
    expect(full.status).toBe(503);
    expect(full.body.code).toBe("ACCOUNT_LIMIT");
    // Existing accounts keep working; reads never need capacity.
    expect((await add("alice", "MU")).status).toBe(201);
    await request(server).get("/api/watchlists").set("X-Account", "bob").expect(200);

    const limited = await add("alice", "INTC");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("EDIT_RATE_LIMIT");
  });

  it("keeps the disk from filling: new accounts need 1 GB free, every write 256 MB", async () => {
    let free = 900 * 1024 ** 2;
    repository = new ConfigRepository({
      configDir,
      dataDir,
      limits: { freeBytes: async () => free },
    });
    const server = app();
    const add = (account: string, symbol: string) =>
      request(server)
        .post("/api/watchlists/chips/symbols")
        .set("X-Account", account)
        .send({ symbol, rowId: "tools" });

    const tooSmall = await add("alice", "TSM");
    expect(tooSmall.status).toBe(503);
    expect(tooSmall.body.code).toBe("ACCOUNT_LIMIT");
    free = 2 * 1024 ** 3;
    expect((await add("alice", "TSM")).status).toBe(201);
    // An existing account keeps saving below the new-account threshold...
    free = 900 * 1024 ** 2;
    expect((await add("alice", "MU")).status).toBe(201);
    // ...until the volume itself is nearly full.
    free = 100 * 1024 ** 2;
    const low = await add("alice", "INTC");
    expect(low.status).toBe(503);
    expect(low.body.code).toBe("STORAGE_LOW");
    expect(symbolsOf(await repository.readWatchlists(ALICE), "chips").tools).toEqual(["ASML", "TSM", "MU"]);
  });

  it("never recreates a deleted account's file from an edit already in flight", async () => {
    const server = app();
    await request(server)
      .post("/api/watchlists/staples/symbols")
      .send({ symbol: "WMT", rowId: "core" })
      .expect(201);
    let releaseLookup: (() => void) | undefined;
    lookupSymbol.mockImplementationOnce(
      (symbol) =>
        new Promise((resolve) => {
          releaseLookup = () => resolve({ symbol, name: "Slow" });
        }),
    );
    const pending = request(server)
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools" })
      .then((response) => response);
    await vi.waitFor(() => expect(releaseLookup).toBeTypeOf("function"));

    // Delete my data: sessions end first, then the files go.
    ended.add(ALICE.id);
    await repository.deleteAccountEdits(ALICE);
    releaseLookup!();

    const late = await pending;
    expect(late.status).toBe(401);
    expect(late.body.code).toBe("AUTH_REQUIRED");
    await expect(readFile(aliceFile())).rejects.toThrow();
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

    expect(new Set(symbolsOf(await repository.readWatchlists(ALICE), "chips").tools)).toEqual(
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
