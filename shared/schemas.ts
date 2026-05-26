import { z } from "zod";
import type { SettingsConfig, WatchlistsConfig } from "./types";

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toUpperCase());

const watchlistRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  expandedByDefault: z.boolean().default(true),
  symbols: z.array(symbolSchema).min(1),
});

const symbolDescriptionsSchema = z.record(z.string()).transform((descriptions) =>
  Object.fromEntries(
    Object.entries(descriptions).flatMap(([rawSymbol, rawDescription]) => {
      const symbol = rawSymbol.trim().toUpperCase();
      const description = rawDescription.trim();

      return symbol && description ? [[symbol, description]] : [];
    }),
  ),
);

const watchlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  theme: z.string().optional(),
  pinnedSymbols: z.array(symbolSchema).default([]),
  symbolDescriptions: symbolDescriptionsSchema.optional(),
  rows: z.array(watchlistRowSchema).min(1),
});

export const watchlistsConfigSchema = z.object({
  watchlists: z.array(watchlistSchema).min(1),
});

export const settingsConfigSchema = z.object({
  polygon: z
    .object({
      plan: z.enum(["free", "paid", "custom"]).default("paid"),
      paidPlanName: z.string().default("stocks-starter"),
      customCallsPerMinute: z.number().positive().optional(),
      warningThreshold: z.number().min(0.1).max(1).default(0.75),
      hardThreshold: z.number().min(0.1).max(1).default(0.95),
    })
    .refine((value) => value.warningThreshold < value.hardThreshold, {
      message: "warningThreshold must be lower than hardThreshold",
      path: ["warningThreshold"],
    })
    .default({}),
});

export function parseWatchlistsConfig(input: unknown): WatchlistsConfig {
  return watchlistsConfigSchema.parse(input);
}

export function parseSettingsConfig(input: unknown): SettingsConfig {
  return settingsConfigSchema.parse(input);
}
