import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistsConfig } from "../../shared/types";
import { createBrowserIds } from "../browser/browserId";
import { apiErrorHandler } from "../http/apiError";
import { createConfigRoutes, type SymbolLookup } from "../routes/configRoutes";
import { ConfigRepository } from "./configRepository";
import { MAX_OWNER_FOCUS_SYMBOLS, OwnerFocusStore } from "./ownerFocus";

const watchlistsYaml = `watchlists:
  - id: chips
    name: Chips
    pinnedSymbols: [NVDA]
    rows:
      - id: compute
        name: Compute
        symbols: [NVDA, AMD]
`;
const OWNER_IP = "198.51.100.7";

const focusOf = (config: WatchlistsConfig) =>
  config.watchlists.find((list) => list.id === "owner-focus");

describe("Owner Focus", () => {
  let root: string;
  let configDir: string;
  let file: string;
  let repository: ConfigRepository;
  let lookupSymbol: ReturnType<typeof vi.fn<SymbolLookup>>;

  /** The X-Test-Ip header stands in for the client IP from the proxy. */
  const app = (options: { ownerEditLimit?: { max: number; windowMs: number } } = {}) => {
    const server = express();
    server.use(express.json());
    server.use(
      "/api",
      createConfigRoutes({
        repository,
        lookupSymbol,
        browserIds: createBrowserIds({ secure: false, key: Buffer.alloc(32, 3) }),
        clientIp: (req) => req.get("x-test-ip") ?? "203.0.113.1",
        ownerAccess: (req) => {
          const clientIp = String(req.headers["x-test-ip"] ?? "203.0.113.1");
          return { canRun: clientIp === OWNER_IP, clientIp };
        },
        ownerEditLimit: options.ownerEditLimit,
      }),
    );
    server.use(apiErrorHandler);
    return server;
  };
  const owner = (server: express.Express) => ({
    add: (body: object) =>
      request(server).post("/api/watchlists/owner-focus/symbols").set("X-Test-Ip", OWNER_IP).send(body),
    remove: (symbol: string) =>
      request(server).delete(`/api/watchlists/owner-focus/symbols/${symbol}`).set("X-Test-Ip", OWNER_IP),
    lists: () => request(server).get("/api/watchlists").set("X-Test-Ip", OWNER_IP),
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "owner-focus-"));
    configDir = join(root, "config");
    file = join(root, "research", "owner-focus.json");
    await mkdir(configDir);
    await writeFile(join(configDir, "watchlists.yaml"), watchlistsYaml);
    await writeFile(join(configDir, "settings.yaml"), "polygon:\n  plan: paid\n");
    repository = new ConfigRepository({ configDir, browserEdits: true, ownerFocusFile: file });
    lookupSymbol = vi.fn<SymbolLookup>(async (symbol) =>
      symbol === "NOPE" ? null : { symbol, name: `${symbol} Inc.` },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is listed first for everyone, starts empty, and only the owner may edit it", async () => {
    const server = app();
    const visitor = await request(server).get("/api/config").expect(200);
    expect(visitor.body.watchlists.watchlists.map((list: { id: string }) => list.id)).toEqual([
      "owner-focus",
      "chips",
    ]);
    expect(focusOf(visitor.body.watchlists)).toMatchObject({
      name: "Owner Focus",
      navigationGroup: "primary",
      rows: [{ id: "focus", symbols: [] }],
      ownerManaged: { canEdit: false },
    });
    expect(focusOf((await owner(server).lists()).body)?.ownerManaged).toEqual({ canEdit: true });
    // Quant System and Models read the YAML only.
    expect((await repository.readBaseWatchlists()).watchlists.map((list) => list.id)).toEqual(["chips"]);
  });

  it("saves the owner's additions and removals to disk for every visitor", async () => {
    const server = app();
    const added = await owner(server)
      .add({ symbol: " pltr ", rowId: "focus", description: " Data platforms " })
      .expect(201);
    expect(lookupSymbol).toHaveBeenCalledWith("PLTR");
    expect(added.body).toMatchObject({ symbol: "PLTR", name: "PLTR Inc." });
    expect(focusOf(added.body.watchlists)?.symbolDescriptions).toEqual({ PLTR: "Data platforms" });
    // The owner is known by IP: no browser cookie.
    expect(added.headers["set-cookie"]).toBeUndefined();
    await owner(server).add({ symbol: "CLS", rowId: "focus" }).expect(201);
    await owner(server).add({ symbol: "NVDA", rowId: "focus" }).expect(201);
    const removed = await owner(server).remove("cls").expect(200);
    expect(removed.body.symbol).toBe("CLS");
    expect(focusOf(removed.body.watchlists)?.rows[0].symbols).toEqual(["PLTR", "NVDA"]);

    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.symbols.map((entry: { symbol: string }) => entry.symbol)).toEqual(["PLTR", "NVDA"]);
    // A restart keeps the list, and other visitors see it read-only.
    repository = new ConfigRepository({ configDir, browserEdits: true, ownerFocusFile: file });
    const visitor = await request(app()).get("/api/watchlists").expect(200);
    expect(focusOf(visitor.body)?.rows[0].symbols).toEqual(["PLTR", "NVDA"]);
    expect(focusOf(visitor.body)?.ownerManaged).toEqual({ canEdit: false });
    // The owner can empty it.
    await owner(app()).remove("PLTR").expect(200);
    const last = await owner(app()).remove("NVDA").expect(200);
    expect(focusOf(last.body.watchlists)?.rows[0].symbols).toEqual([]);
  });

  it("refuses everyone but the owner before validating or looking anything up", async () => {
    const server = app();
    const add = await request(server).post("/api/watchlists/owner-focus/symbols").send({});
    expect(add.status).toBe(403);
    expect(add.body.code).toBe("RESEARCH_IP_FORBIDDEN");
    expect(add.headers["set-cookie"]).toBeUndefined();
    const remove = await request(server).delete("/api/watchlists/owner-focus/symbols/NVDA");
    expect(remove.status).toBe(403);
    expect(lookupSymbol).not.toHaveBeenCalled();
    // Even the owner's IP cannot be used from another site.
    const crossSite = await owner(server)
      .add({ symbol: "PLTR", rowId: "focus" })
      .set("Origin", "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.code).toBe("CROSS_SITE_REQUEST");
    await request(server)
      .post("/api/watchlists/owner-focus/symbols")
      .set("X-Test-Ip", OWNER_IP)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("symbol=PLTR&rowId=focus")
      .expect(415);
    expect(lookupSymbol).not.toHaveBeenCalled();
    // There is no default to reset to.
    const reset = await request(server)
      .delete("/api/watchlists/owner-focus/edits")
      .set("X-Test-Ip", OWNER_IP);
    expect(reset.status).toBe(404);
    expect(reset.body.code).toBe("WATCHLIST_NOT_FOUND");
  });

  it("rejects invalid, unknown and duplicate edits", async () => {
    const server = app();
    const code = async (response: Promise<request.Response>, status: number) => {
      const result = await response;
      expect(result.status).toBe(status);
      return result.body.code as string;
    };

    expect(await code(owner(server).add({ symbol: "$$", rowId: "focus" }), 400)).toBe("INVALID_WATCHLIST_EDIT");
    expect(await code(owner(server).add({ symbol: "NOPE", rowId: "focus" }), 404)).toBe("UNKNOWN_SYMBOL");
    expect(await code(owner(server).add({ symbol: "AMD", rowId: "core" }), 400)).toBe("WATCHLIST_ROW_NOT_FOUND");
    expect(await code(owner(server).add({ symbol: "AMD", rowId: "focus", subsectors: ["ai"] }), 400)).toBe(
      "WATCHLIST_SUBSECTOR_NOT_FOUND",
    );
    await owner(server).add({ symbol: "AMD", rowId: "focus" }).expect(201);
    expect(await code(owner(server).add({ symbol: "AMD", rowId: "focus" }), 409)).toBe("WATCHLIST_SYMBOL_EXISTS");
    expect(await code(owner(server).remove("TSM"), 404)).toBe("WATCHLIST_SYMBOL_NOT_FOUND");
    lookupSymbol.mockRejectedValueOnce(new Error("provider down"));
    expect(await code(owner(server).add({ symbol: "TSM", rowId: "focus" }), 502)).toBe("SYMBOL_LOOKUP_FAILED");
    expect(focusOf((await owner(server).lists()).body)?.rows[0].symbols).toEqual(["AMD"]);
  });

  it("limits the owner's edits per window", async () => {
    const server = app({ ownerEditLimit: { max: 2, windowMs: 60_000 } });
    await owner(server).add({ symbol: "AMD", rowId: "focus" }).expect(201);
    await owner(server).remove("AMD").expect(200);
    const limited = await owner(server).add({ symbol: "AMD", rowId: "focus" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("EDIT_RATE_LIMIT");
  });

  it("keeps Owner Focus in the lists a browser gets back from its own edits", async () => {
    const server = app();
    await owner(server).add({ symbol: "PLTR", rowId: "focus" }).expect(201);
    const alice = request.agent(server);
    const edited = await alice.post("/api/watchlists/chips/symbols").send({ symbol: "TSM", rowId: "compute" }).expect(201);
    expect(focusOf(edited.body.watchlists)?.rows[0].symbols).toEqual(["PLTR"]);
    const removed = await alice.delete("/api/watchlists/chips/symbols/AMD").expect(200);
    expect(focusOf(removed.body.watchlists)?.rows[0].symbols).toEqual(["PLTR"]);
    const reset = await alice.delete("/api/watchlists/chips/edits").expect(200);
    expect(focusOf(reset.body.watchlists)?.rows[0].symbols).toEqual(["PLTR"]);
    // A browser cannot edit its own copy of Owner Focus.
    const denied = await alice.post("/api/watchlists/owner-focus/symbols").send({ symbol: "TSM", rowId: "focus" });
    expect(denied.status).toBe(403);
  });
});

describe("OwnerFocusStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "owner-focus-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("serialises concurrent additions so none is lost", async () => {
    const file = join(root, "owner-focus.json");
    const store = new OwnerFocusStore(file);
    await Promise.all(["AAA", "BBB", "CCC", "DDD"].map((symbol) => store.add(symbol)));

    const reloaded = await new OwnerFocusStore(file).read();
    expect(reloaded.symbols.map((entry) => entry.symbol).sort()).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("caps the list and treats an unreadable file as empty", async () => {
    const file = join(root, "owner-focus.json");
    await writeFile(file, JSON.stringify({ version: 1, updatedAt: null, symbols: [] }));
    const store = new OwnerFocusStore(file);
    for (let i = 0; i < MAX_OWNER_FOCUS_SYMBOLS; i += 1)
      await store.add(`S${String(i).padStart(3, "0")}`);
    await expect(store.add("ONEMORE")).rejects.toMatchObject({ code: "WATCHLIST_ADD_LIMIT" });

    await writeFile(file, "{not json");
    expect((await new OwnerFocusStore(file).read()).symbols).toEqual([]);
    await writeFile(file, JSON.stringify({ version: 2, symbols: "nope" }));
    expect((await new OwnerFocusStore(file).read()).symbols).toEqual([]);
  });
});
