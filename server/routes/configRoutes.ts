import { Router, type Request } from "express";
import { z } from "zod";
import type { WatchlistEditResult } from "../../shared/types";
import { ConfigRepository, type EditingAccount } from "../config/configRepository";
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
  /** The signed-in account for a request, or null for visitors. */
  resolveAccount?: (
    request: Request,
  ) => Promise<EditingAccount | null> | EditingAccount | null;
  /** Watchlist writes allowed per account per window (default 60 per 10 min). */
  editLimit?: { max: number; windowMs: number };
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
  const resolveAccount = options.resolveAccount ?? (() => null);
  const limit = options.editLimit ?? { max: 60, windowMs: 10 * 60_000 };
  const recentEdits = new Map<string, number[]>();

  /**
   * Writes are same-site only and need a signed-in account; each account
   * has a sliding-window budget so a script cannot hammer the ticker lookup
   * or the disk.
   */
  const editingAccount = async (request: Request, requireJson = true) => {
    assertSameSiteWrite(request, { source: "watchlists", requireJson });
    const account = await resolveAccount(request);
    if (!account)
      throw new ApiError(401, "AUTH_REQUIRED", "Sign in to edit watchlists", {
        source: "watchlists",
      });
    const now = Date.now();
    const recent = (recentEdits.get(account.id) ?? []).filter(
      (time) => now - time < limit.windowMs,
    );
    if (recent.length >= limit.max)
      throw new ApiError(429, "EDIT_RATE_LIMIT", "Too many watchlist edits", {
        source: "watchlists",
      });
    recent.push(now);
    recentEdits.set(account.id, recent);
    if (recentEdits.size > 10_000) recentEdits.clear();
    // The edit may wait on a ticker lookup; its write re-checks the session.
    return {
      ...account,
      isCurrent: async () => (await resolveAccount(request))?.id === account.id,
    };
  };
  // Responses depend on the session cookie: never cache them anywhere shared.
  const personal = { "Cache-Control": "private, no-store", Vary: "Cookie" };

  router.get("/config", async (request, response) => {
    response.set(personal).json(await repository.readConfig(await resolveAccount(request)));
  });

  router.get("/watchlists", async (request, response) => {
    response.set(personal).json(await repository.readWatchlists(await resolveAccount(request)));
  });

  router.post("/watchlists/:watchlistId/symbols", async (request, response) => {
    const account = await editingAccount(request);
    const listId = parse(idSchema, request.params.watchlistId);
    const input = parse(addSchema, request.body);
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
    const watchlists = await repository.addWatchlistSymbol(account, listId, {
      ...input,
      symbol,
    });
    const result: WatchlistEditResult = { symbol, name: found.name, watchlists };
    response.status(201).set(personal).json(result);
  });

  router.delete("/watchlists/:watchlistId/symbols/:symbol", async (request, response) => {
    const account = await editingAccount(request, false);
    const listId = parse(idSchema, request.params.watchlistId);
    const symbol = parse(symbolSchema, request.params.symbol);
    const watchlists = await repository.removeWatchlistSymbol(account, listId, symbol);
    const result: WatchlistEditResult = { symbol, watchlists };
    response.set(personal).json(result);
  });

  router.delete("/watchlists/:watchlistId/edits", async (request, response) => {
    const account = await editingAccount(request, false);
    const listId = parse(idSchema, request.params.watchlistId);
    const watchlists = await repository.resetWatchlist(account, listId);
    response.set(personal).json({ watchlists });
  });

  return router;
}
