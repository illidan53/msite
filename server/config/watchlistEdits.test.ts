import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistsConfig } from "../../shared/types";
import { apiErrorHandler } from "../http/apiError";
import { createConfigRoutes, type SymbolLookup } from "../routes/configRoutes";
import { createBrowserIds } from "../browser/browserId";
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

describe("watchlist editing per browser", () => {
  let root: string;
  let configDir: string;
  let repository: ConfigRepository;
  let lookupSymbol: ReturnType<typeof vi.fn<SymbolLookup>>;
  const key = Buffer.alloc(32, 9);

  type Budget = { max: number; windowMs: number };
  /** The X-Test-Ip header stands in for the client IP from the proxy. */
  const app = (
    options: {
      editLimit?: Budget;
      ipEditLimit?: Budget;
      ipNewBrowserLimit?: Budget;
      siteEditLimit?: Budget;
      browserIds?: boolean;
    } = {},
  ) => {
    const server = express();
    server.use(express.json());
    server.use(
      "/api",
      createConfigRoutes({
        repository,
        lookupSymbol,
        editLimit: options.editLimit,
        ipEditLimit: options.ipEditLimit,
        ipNewBrowserLimit: options.ipNewBrowserLimit,
        siteEditLimit: options.siteEditLimit,
        clientIp: (request) => request.get("x-test-ip") ?? "203.0.113.1",
        ...(options.browserIds === false
          ? {}
          : { browserIds: createBrowserIds({ secure: false, key }) }),
      }),
    );
    server.use(apiErrorHandler);
    return server;
  };
  /** A supertest agent keeps its own cookies: one agent is one browser. */
  const browser = (server: express.Express) => request.agent(server);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "watchlist-edits-"));
    configDir = join(root, "config");
    await mkdir(configDir);
    await writeFile(join(configDir, "watchlists.yaml"), watchlistsYaml);
    await writeFile(join(configDir, "settings.yaml"), settingsYaml);
    repository = new ConfigRepository({ configDir, browserEdits: true });
    lookupSymbol = vi.fn<SymbolLookup>(async (symbol) =>
      symbol === "NOPE" ? null : { symbol, name: `${symbol} Inc.` },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("gives a browser its own copy on its first edit, in memory only", async () => {
    const server = app();
    const alice = browser(server);
    const response = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: " tsm ", rowId: "tools", description: " Foundry " })
      .expect(201);

    expect(lookupSymbol).toHaveBeenCalledWith("TSM");
    expect(response.body).toMatchObject({ symbol: "TSM", name: "TSM Inc." });
    expect(symbolsOf(response.body.watchlists, "chips").tools).toEqual(["ASML", "TSM"]);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/^msite_browser=[\w-]{22}\.[\w-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const mine = await alice.get("/api/watchlists").expect(200);
    expect(mine.headers["cache-control"]).toBe("private, no-store");
    expect(mine.headers.vary).toMatch(/Cookie/);
    expect(symbolsOf(mine.body, "chips").tools).toEqual(["ASML", "TSM"]);
    expect(mine.body.watchlists[0].symbolDescriptions?.TSM).toBe("Foundry");
    // A visitor without the cookie sees the YAML; reads never issue a cookie.
    const visitor = await request(server).get("/api/config").expect(200);
    expect(visitor.headers["set-cookie"]).toBeUndefined();
    expect(symbolsOf(visitor.body.watchlists, "chips").tools).toEqual(["ASML"]);
    // The YAML itself is never rewritten, and a restart forgets the edits.
    expect(await readFile(join(configDir, "watchlists.yaml"), "utf8")).toBe(watchlistsYaml);
    repository = new ConfigRepository({ configDir, browserEdits: true });
    expect(symbolsOf((await browser(app()).get("/api/watchlists")).body, "chips").tools).toEqual(["ASML"]);
  });

  it("removes a symbol and restores it to its own row when re-added", async () => {
    const alice = browser(app());
    const removed = await alice.delete("/api/watchlists/chips/symbols/nvda").expect(200);

    expect(removed.body.symbol).toBe("NVDA");
    expect(symbolsOf(removed.body.watchlists, "chips").compute).toEqual(["AMD"]);
    expect(removed.body.watchlists.watchlists[0].pinnedSymbols).toEqual([]);

    const restored = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "NVDA", rowId: "compute", description: "GPUs" })
      .expect(201);
    expect(symbolsOf(restored.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    expect((await alice.get("/api/watchlists")).body).toEqual(await repository.readBaseWatchlists());
  });

  it("moves a YAML symbol to another row after removing it", async () => {
    const alice = browser(app());
    await alice.delete("/api/watchlists/chips/symbols/AMD").expect(200);
    const moved = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "AMD", rowId: "tools" })
      .expect(201);

    expect(symbolsOf(moved.body.watchlists, "chips")).toEqual({
      compute: ["NVDA"],
      tools: ["ASML", "AMD"],
    });
  });

  it("removes a runtime addition entirely", async () => {
    const alice = browser(app());
    await alice.post("/api/watchlists/staples/symbols").send({ symbol: "WMT", rowId: "core" }).expect(201);
    const removed = await alice.delete("/api/watchlists/staples/symbols/WMT").expect(200);

    expect(symbolsOf(removed.body.watchlists, "staples").core).toEqual(["COST"]);
  });

  it("tags additions with subsectors and drops removed symbols from them", async () => {
    const alice = browser(app());
    const subsectorsOf = (config: WatchlistsConfig) =>
      Object.fromEntries(
        config.watchlists[0].subsectors!.map((subsector) => [subsector.id, subsector.symbols]),
      );
    const added = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "TSM", rowId: "tools", subsectors: ["litho", "litho"] })
      .expect(201);
    expect(subsectorsOf(added.body.watchlists)).toEqual({ ai: ["NVDA", "AMD"], litho: ["ASML", "TSM"] });

    const removed = await alice.delete("/api/watchlists/chips/symbols/NVDA").expect(200);
    expect(subsectorsOf(removed.body.watchlists).ai).toEqual(["AMD"]);

    // Undo sends the subsectors the symbol had: still a plain restore.
    const restored = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "NVDA", rowId: "compute", subsectors: ["ai"] })
      .expect(201);
    expect(symbolsOf(restored.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    expect(subsectorsOf(restored.body.watchlists).ai).toEqual(["NVDA", "AMD"]);

    // A new tag on a YAML symbol is recorded as an addition.
    await alice.delete("/api/watchlists/chips/symbols/AMD").expect(200);
    const tagged = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "AMD", rowId: "compute", subsectors: ["ai", "litho"] })
      .expect(201);
    expect(symbolsOf(tagged.body.watchlists, "chips").compute).toEqual(["NVDA", "AMD"]);
    expect(subsectorsOf(tagged.body.watchlists)).toEqual({
      ai: ["NVDA", "AMD"],
      litho: ["ASML", "TSM", "AMD"],
    });

    const unknown = await alice
      .post("/api/watchlists/chips/symbols")
      .send({ symbol: "MU", rowId: "tools", subsectors: ["nope"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("WATCHLIST_SUBSECTOR_NOT_FOUND");
  });

  it("rejects invalid, unknown, duplicate and last-symbol edits", async () => {
    const alice = browser(app());
    const post = (listId: string, body: object) =>
      alice.post(`/api/watchlists/${listId}/symbols`).send(body);
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
    expect(await code(alice.delete("/api/watchlists/chips/symbols/TSM"), 404)).toBe("WATCHLIST_SYMBOL_NOT_FOUND");
    expect(await code(alice.delete("/api/watchlists/staples/symbols/COST"), 409)).toBe("WATCHLIST_LAST_SYMBOL");

    lookupSymbol.mockRejectedValueOnce(new Error("provider down"));
    expect(await code(post("chips", { symbol: "TSM", rowId: "tools" }), 502)).toBe("SYMBOL_LOOKUP_FAILED");
    expect(symbolsOf((await alice.get("/api/watchlists")).body, "chips").tools).toEqual(["ASML"]);
  });

  it("only takes same-origin JSON writes", async () => {
    const server = app();
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("symbol=TSM&rowId=tools")
      .expect(415);
    const foreign = await request(server)
      .delete("/api/watchlists/chips/symbols/NVDA")
      .set("Origin", "https://evil.example");
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe("CROSS_SITE_REQUEST");
    expect(foreign.headers["set-cookie"]).toBeUndefined();
    // A sibling *.nphunter.net app is "same-site", not "same-origin".
    await request(server)
      .post("/api/watchlists/chips/symbols")
      .set("Sec-Fetch-Site", "same-site")
      .send({ symbol: "TSM", rowId: "tools" })
      .expect(403);
    expect(lookupSymbol).not.toHaveBeenCalled();
  });

  it("keeps each browser's edits to itself and ignores forged ids", async () => {
    const server = app();
    const alice = browser(server);
    const bob = browser(server);
    await alice.post("/api/watchlists/chips/symbols").send({ symbol: "TSM", rowId: "tools" }).expect(201);
    await bob.delete("/api/watchlists/chips/symbols/AMD").expect(200);

    expect(symbolsOf((await alice.get("/api/watchlists")).body, "chips")).toEqual({
      compute: ["NVDA", "AMD"],
      tools: ["ASML", "TSM"],
    });
    expect(symbolsOf((await bob.get("/api/config")).body.watchlists, "chips")).toEqual({
      compute: ["NVDA"],
      tools: ["ASML"],
    });
    for (const forged of ["msite_browser=AAAAAAAAAAAAAAAAAAAAAA.forged", "msite_browser=../../x", "msite_browser="])
      expect(
        symbolsOf((await request(server).get("/api/watchlists").set("Cookie", forged)).body, "chips"),
      ).toEqual({ compute: ["NVDA", "AMD"], tools: ["ASML"] });
  });

  it("resets one list back to the YAML without touching the others", async () => {
    const alice = browser(app());
    await alice.post("/api/watchlists/chips/symbols").send({ symbol: "TSM", rowId: "tools" }).expect(201);
    await alice.post("/api/watchlists/staples/symbols").send({ symbol: "WMT", rowId: "core" }).expect(201);

    const reset = await alice.delete("/api/watchlists/chips/edits").expect(200);
    expect(Object.keys(reset.body)).toEqual(["watchlists"]);
    expect(symbolsOf(reset.body.watchlists, "chips").tools).toEqual(["ASML"]);
    expect(symbolsOf(reset.body.watchlists, "staples").core).toEqual(["COST", "WMT"]);
  });

  it("limits each browser, each client IP, new browsers per IP and the whole site", async () => {
    const minute = 60_000;
    const server = app({
      editLimit: { max: 2, windowMs: minute },
      ipEditLimit: { max: 4, windowMs: minute },
      ipNewBrowserLimit: { max: 3, windowMs: minute },
      siteEditLimit: { max: 6, windowMs: minute },
    });
    const add = (client: ReturnType<typeof browser>, symbol: string, ip = "203.0.113.1") =>
      client.post("/api/watchlists/chips/symbols").set("X-Test-Ip", ip).send({ symbol, rowId: "tools" });
    const [alice, bob] = [browser(server), browser(server)];

    expect((await add(alice, "TSM")).status).toBe(201);
    expect((await add(alice, "MU")).status).toBe(201);
    const perBrowser = await add(alice, "INTC");
    expect(perBrowser.status).toBe(429);
    expect(perBrowser.body.code).toBe("EDIT_RATE_LIMIT");
    expect((await add(bob, "INTC")).status).toBe(201);
    expect((await add(browser(server), "QCOM")).status).toBe(201);
    // Dropping the cookie does not reset the IP's budgets (4 writes, 3 new ids).
    expect((await add(browser(server), "TXN")).status).toBe(429);
    // Another IP still has its own budget, until the whole site's runs out.
    expect((await add(browser(server), "TXN", "198.51.100.2")).status).toBe(201);
    expect((await add(browser(server), "ADI", "198.51.100.3")).status).toBe(201);
    expect((await add(browser(server), "MPWR", "198.51.100.4")).status).toBe(429);
  });

  it("spends no budget and issues no cookie for requests it rejects", async () => {
    const server = app({ siteEditLimit: { max: 1, windowMs: 60_000 } });
    for (const bad of [
      request(server).post("/api/watchlists/chips/symbols").send({}),
      request(server).post("/api/watchlists/nope/symbols").send({ symbol: "TSM", rowId: "tools" }),
      request(server).delete("/api/watchlists/chips/symbols/%24BAD"),
      request(server).delete("/api/watchlists/nope/edits"),
    ]) {
      const response = await bad;
      expect([400, 404]).toContain(response.status);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    // The single site-wide edit is still available.
    await browser(server).post("/api/watchlists/chips/symbols").send({ symbol: "TSM", rowId: "tools" }).expect(201);
  });

  it("bounds memory: additions per browser and least-recently-used browsers", async () => {
    repository = new ConfigRepository({
      configDir,
      browserEdits: true,
      limits: { maxBrowsers: 2, maxAddedPerBrowser: 2 },
    });
    const server = app();
    const [first, second, third] = [browser(server), browser(server), browser(server)];
    const add = (client: ReturnType<typeof browser>, symbol: string) =>
      client.post("/api/watchlists/chips/symbols").send({ symbol, rowId: "tools" });

    expect((await add(first, "TSM")).status).toBe(201);
    expect((await add(first, "MU")).status).toBe(201);
    const full = await add(first, "INTC");
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("BROWSER_ADD_LIMIT");
    expect((await add(second, "INTC")).status).toBe(201);
    // Reading keeps the first browser recent, so the second one is dropped.
    await first.get("/api/watchlists");
    expect((await add(third, "QCOM")).status).toBe(201);
    expect(symbolsOf((await first.get("/api/watchlists")).body, "chips").tools).toEqual(["ASML", "TSM", "MU"]);
    expect(symbolsOf((await second.get("/api/watchlists")).body, "chips").tools).toEqual(["ASML"]);
  });

  it("serialises concurrent additions so none is lost", async () => {
    const alice = browser(app());
    await alice.post("/api/watchlists/chips/symbols").send({ symbol: "TSM", rowId: "tools" }).expect(201);
    await Promise.all(
      ["MU", "INTC", "QCOM"].map((symbol) =>
        alice.post("/api/watchlists/chips/symbols").send({ symbol, rowId: "tools" }).expect(201),
      ),
    );

    expect(new Set(symbolsOf((await alice.get("/api/watchlists")).body, "chips").tools)).toEqual(
      new Set(["ASML", "TSM", "MU", "INTC", "QCOM"]),
    );
  });

  it("is read-only without browser ids", async () => {
    const response = await request(app({ browserIds: false })).delete("/api/watchlists/chips/symbols/NVDA");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("WATCHLIST_EDITS_UNAVAILABLE");
  });
});
