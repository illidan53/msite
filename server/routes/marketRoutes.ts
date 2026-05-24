import { Router } from "express";
import { z } from "zod";
import type { MarketSnapshot, PriceSeries } from "../../shared/types";
import { ApiError } from "../http/apiError";

export interface MarketRouteProvider {
  getHistory(input: { range: PriceSeries["range"]; symbol: string }): Promise<PriceSeries>;
  getSnapshots(symbols: string[]): Promise<MarketSnapshot[]>;
}

const safeTickerSymbolSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^(?=.*[A-Z0-9])[A-Z0-9.-]+$/.test(value), {
    message: "Invalid ticker symbol",
  });

const historyRangeSchema = z.enum([
  "1h",
  "1d",
  "5d",
  "30d",
  "3month",
  "1y",
  "5y",
]);

const snapshotsRequestSchema = z.object({
  symbols: z.array(safeTickerSymbolSchema).min(1).max(250),
});

const historyQuerySchema = z.object({
  range: historyRangeSchema,
  symbol: safeTickerSymbolSchema,
});

export function createMarketRoutes(provider: MarketRouteProvider): Router {
  const router = Router();

  router.post("/market/snapshots", async (request, response) => {
    const input = parseMarketInput(snapshotsRequestSchema, request.body);
    response.json(await provider.getSnapshots(input.symbols));
  });

  router.get("/market/history", async (request, response) => {
    const input = parseMarketInput(historyQuerySchema, request.query);
    response.json(await provider.getHistory(input));
  });

  return router;
}

function parseMarketInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid market input", {
      details: result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
      source: "market",
    });
  }

  return result.data;
}
