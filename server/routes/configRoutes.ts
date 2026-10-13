import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { WatchlistEditResult } from "../../shared/types";
import type { BrowserIds } from "../browser/browserId";
import { ConfigRepository } from "../config/configRepository";
import { ApiError } from "../http/apiError";
import { assertSameSiteWrite } from "../http/ownerWrite";

/**
 * Resolves a ticker to its listed symbol, null when the provider does not
 * know it. Any other failure throws and leaves the watchlist unchanged.
 */
export type SymbolLookup = (
  symbol: string,
) => Promise<{ symbol: string; name?: string } | null>;

export interface ConfigRoutesOptions {
  repository?: ConfigRepository;
  configDir?: string;
  lookupSymbol?: SymbolLookup;
  /** Identifies each browser; without it every visitor sees the YAML lists. */
  browserIds?: BrowserIds;
  /** The client's IP (via the trusted proxy); defaults to the socket peer. */
  clientIp?: (request: Request) => string | null;
  /** Watchlist writes per browser per window (default 60 per 10 min). */
  editLimit?: Budget;
  /** Writes per client IP per window (default 120 per 10 min). */
  ipEditLimit?: Budget;
  /** New browser ids per client IP per window (default 10 per hour). */
  ipNewBrowserLimit?: Budget;
  /** Writes from everyone together per window (default 600 per 10 min). */
  siteEditLimit?: Budget;
}

interface Budget {
  max: number;
  windowMs: number;
}

/** Sliding-window counters per key; the map is bounded by clearing it. */
function slidingWindow({ max, windowMs }: Budget) {
  const hits = new Map<string, number[]>();
  return {
    full(key: string, now: number) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      hits.set(key, recent);
      return recent.length >= max;
    },
    take(key: string, now: number) {
      hits.get(key)?.push(now) ?? hits.set(key, [now]);
      if (hits.size > 10_000) hits.clear();
    },
  };
}

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(12)
  .regex(/^[A-Z][A-Z0-9.-]*$/);
const idSchema = z.string().min(1).max(64);
const addSchema = z
  .object({
    symbol: symbolSchema,
    rowId: idSchema,
    description: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((value) => value || undefined),
    subsectors: z.array(idSchema).max(20).optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, "INVALID_WATCHLIST_EDIT", "Invalid watchlist edit", {
      source: "watchlists",
    });
  return result.data;
}

export function createConfigRoutes(options: ConfigRoutesOptions = {}): Router {
  const router = Router();
  const repository =
    options.repository ?? new ConfigRepository({ configDir: options.configDir });
  const browserIds = options.browserIds;
  const clientIp =
    options.clientIp ?? ((request: Request) => request.socket.remoteAddress ?? null);
  const perBrowser = slidingWindow(options.editLimit ?? { max: 60, windowMs: 10 * 60_000 });
  const perIp = slidingWindow(options.ipEditLimit ?? { max: 120, windowMs: 10 * 60_000 });
  const newBrowsersPerIp = slidingWindow(
    options.ipNewBrowserLimit ?? { max: 10, windowMs: 60 * 60_000 },
  );
  const site = slidingWindow(options.siteEditLimit ?? { max: 600, windowMs: 10 * 60_000 });
  const rateLimited = () =>
    new ApiError(429, "EDIT_RATE_LIMIT", "Too many watchlist edits", { source: "watchlists" });

  /**
   * Writes are same-site only and change the requesting browser's copy.
   * Call it after the request has been validated and its list found, so a
   * malformed request never spends a budget or gets a cookie. Budgets are
   * per browser, per client IP (a script can always drop its cookie), for
   * new browser ids per IP (each one costs memory), and for the whole site.
   */
  const editingBrowser = (request: Request, response: Response) => {
    if (!browserIds)
      throw new ApiError(503, "WATCHLIST_EDITS_UNAVAILABLE", "Watchlist editing is not configured", {
        source: "watchlists",
      });
    const now = Date.now();
    const ip = clientIp(request) ?? "unknown";
    const known = browserIds.read(request);
    if (
      site.full("site", now) ||
      perIp.full(ip, now) ||
      (known ? perBrowser.full(known, now) : newBrowsersPerIp.full(ip, now))
    )
      throw rateLimited();
    const browserId = known ?? browserIds.ensure(request, response);
    if (!known) newBrowsersPerIp.take(ip, now);
    site.take("site", now);
    perIp.take(ip, now);
    perBrowser.take(browserId, now);
    return browserId;
  };
  /** Same-origin checks and validation come before any budget is spent. */
  const checkedList = async (request: Request, requireJson: boolean) => {
    assertSameSiteWrite(request, { source: "watchlists", requireJson });
    const listId = parse(idSchema, request.params.watchlistId);
    const known = (await repository.readBaseWatchlists()).watchlists.some(
      (list) => list.id === listId,
    );
    if (!known)
      throw new ApiError(404, "WATCHLIST_NOT_FOUND", "Unknown watchlist", { source: "watchlists" });
    return listId;
  };
  // Responses depend on the browser cookie: never cache them anywhere shared.
  const personal = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const browserOf = (request: Request) => browserIds?.read(request) ?? null;

  router.get("/config", async (request, response) => {
    response.set(personal).json(await repository.readConfig(browserOf(request)));
  });

  router.get("/watchlists", async (request, response) => {
    response.set(personal).json(await repository.readWatchlists(browserOf(request)));
  });

  router.post("/watchlists/:watchlistId/symbols", async (request, response) => {
    const listId = await checkedList(request, true);
    const input = parse(addSchema, request.body);
    const browserId = editingBrowser(request, response);
    let found: Awaited<ReturnType<SymbolLookup>>;
    try {
      found = options.lookupSymbol
        ? await options.lookupSymbol(input.symbol)
        : { symbol: input.symbol };
    } catch (cause) {
      throw new ApiError(
        502,
        "SYMBOL_LOOKUP_FAILED",
        "Unable to verify the symbol right now",
        { cause, source: "watchlists" },
      );
    }
    if (!found)
      throw new ApiError(404, "UNKNOWN_SYMBOL", "No listed security has this symbol", {
        source: "watchlists",
      });
    const symbol = found.symbol.toUpperCase();
    const watchlists = await repository.addWatchlistSymbol(browserId, listId, {
      ...input,
      symbol,
    });
    const result: WatchlistEditResult = { symbol, name: found.name, watchlists };
    response.status(201).set(personal).json(result);
  });

  router.delete("/watchlists/:watchlistId/symbols/:symbol", async (request, response) => {
    const listId = await checkedList(request, false);
    const symbol = parse(symbolSchema, request.params.symbol);
    const browserId = editingBrowser(request, response);
    const watchlists = await repository.removeWatchlistSymbol(browserId, listId, symbol);
    const result: WatchlistEditResult = { symbol, watchlists };
    response.set(personal).json(result);
  });

  router.delete("/watchlists/:watchlistId/edits", async (request, response) => {
    const listId = await checkedList(request, false);
    const browserId = editingBrowser(request, response);
    const watchlists = await repository.resetWatchlist(browserId, listId);
    response.set(personal).json({ watchlists });
  });

  return router;
}
