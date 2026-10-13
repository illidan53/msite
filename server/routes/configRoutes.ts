import { Router } from "express";
import { z } from "zod";
import type { WatchlistEditResult } from "../../shared/types";
import { ConfigRepository } from "../config/configRepository";
import { ApiError } from "../http/apiError";
import { assertOwnerWrite } from "../http/ownerWrite";
import {
  parseIps,
  researchAccess,
  type ResearchAccessOptions,
} from "../research/access";

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
  access?: ResearchAccessOptions;
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
  const access = researchAccess(
    options.access ?? {
      allowedIps: parseIps(process.env.RESEARCH_ALLOWED_IPS),
      trustedProxyIps: parseIps(process.env.RESEARCH_TRUSTED_PROXY_IPS),
    },
  );
  const forbidden = "This IP address is not allowed to edit watchlists";

  router.get("/config", async (_request, response) => {
    response.set("Cache-Control", "no-store").json(await repository.readConfig());
  });

  router.get("/watchlists", async (_request, response) => {
    response.set("Cache-Control", "no-store").json(await repository.readWatchlists());
  });

  router.post("/watchlists/:watchlistId/symbols", async (request, response) => {
    assertOwnerWrite(access, request, { source: "watchlists", forbidden });
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
    const watchlists = await repository.addWatchlistSymbol(listId, { ...input, symbol });
    const result: WatchlistEditResult = { symbol, name: found.name, watchlists };
    response.status(201).json(result);
  });

  router.delete("/watchlists/:watchlistId/symbols/:symbol", async (request, response) => {
    assertOwnerWrite(access, request, {
      source: "watchlists",
      forbidden,
      requireJson: false,
    });
    const listId = parse(idSchema, request.params.watchlistId);
    const symbol = parse(symbolSchema, request.params.symbol);
    const watchlists = await repository.removeWatchlistSymbol(listId, symbol);
    const result: WatchlistEditResult = { symbol, watchlists };
    response.json(result);
  });

  return router;
}
