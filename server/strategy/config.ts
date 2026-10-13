import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { WatchlistsConfig } from "../../shared/types";
import { STRATEGY_ENGINE_VERSION, type Bilingual } from "../../shared/strategy";
import { ruleCatalog } from "../../shared/strategyRules";

const bilingual = z.object({ en: z.string().min(1), zh: z.string().min(1) });
const symbol = z
  .string()
  .trim()
  .min(1)
  .transform((v) => v.toUpperCase());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const bookBase = {
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: bilingual,
  riskTarget: z.number().positive().max(1),
  maxPositionWeight: z.number().positive().max(1),
  capital: z.number().positive(),
  enabled: z.boolean().default(true),
};

export const strategyConfigSchema = z
  .object({
    version: z.literal(1),
    benchmark: symbol,
    engine: z.object({
      forecastCap: z.number().positive(),
      buffer: z.number().min(0).max(1),
      lot: z.number().positive(),
      minTradeNotional: z.number().min(0),
      eligibilitySessions: z.number().int().positive(),
      evaluationMinSession: z.number().int().positive(),
      evaluationEligibleShare: z.number().min(0).max(1),
      ruleCostLimitSharpe: z.number().positive(),
      instrumentCostLimitSharpe: z.number().positive(),
      diversificationCap: z.number().min(1),
      overlay: z.object({
        gross: z.number().positive(),
        normalRisk: z.number().positive(),
        correlationShock: z.number().positive(),
        jumpRisk: z.number().positive(),
      }),
    }),
    costs: z.object({
      benchmarkBps: z.number().min(0),
      tiers: z
        .array(
          z.object({
            minDollarVolume: z.number().min(0),
            bps: z.number().min(0),
          }),
        )
        .min(1)
        .refine(
          (tiers) =>
            tiers.at(-1)!.minDollarVolume === 0 &&
            tiers.every(
              (t, i) => i === 0 || t.minDollarVolume < tiers[i - 1].minDollarVolume,
            ),
          "Cost tiers must descend and end at 0",
        ),
      secFeeBps: z.number().min(0),
      secFeeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    books: z
      .array(
        z.discriminatedUnion("source", [
          z.object({
            ...bookBase,
            source: z.literal("watchlists"),
            classExcludeLists: z.array(z.string()).default([]),
            classOverrides: z.record(z.string()).default({}),
          }),
          z.object({
            ...bookBase,
            source: z.literal("symbols"),
            className: z.string().min(1),
            symbols: z.array(symbol).min(2),
          }),
        ]),
      )
      .min(1),
    schedule: z.object({
      timezone: z.literal("America/New_York"),
      dailyAt: time,
      dailyRetryMinutes: z.number().int().positive(),
      dailyGiveUpAt: time,
      weeklyDay: z.number().int().min(0).max(6),
      weeklyAt: time,
    }),
    email: z.object({
      locale: z.enum(["en", "zh"]),
      sendWhenNoSignals: z.boolean(),
      weeklyReport: z.boolean(),
      failureAlerts: z.boolean(),
    }),
  })
  .refine(
    (c) => new Set(c.books.map((b) => b.id)).size === c.books.length,
    "Book ids must be unique",
  );
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

export async function loadStrategyConfig(configDir: string) {
  const text = await readFile(join(configDir, "strategy.yaml"), "utf8");
  return strategyConfigSchema.parse(YAML.parse(text));
}

/** One handcrafting group: equal across classes, then rows, then symbols. */
export interface BookClass {
  id: string;
  name: string;
  rows: { id: string; symbols: string[] }[];
}
export interface BookDefinition {
  id: string;
  name: Bilingual;
  riskTarget: number;
  maxPositionWeight: number;
  capital: number;
  /** Every symbol exactly once, in class → row order. */
  symbols: string[];
  classOf: Record<string, string>;
  classes: BookClass[];
}

/**
 * Resolves configured books against the live watchlists. A watchlist symbol's
 * class is its override, else the first list (in YAML order) not excluded from
 * defining classes. Within a class, symbols keep the rows of that list; an
 * override symbol absent from those rows joins a trailing "other" row.
 */
export function resolveBooks(
  config: StrategyConfig,
  watchlists: WatchlistsConfig,
): BookDefinition[] {
  return config.books
    .filter((b) => b.enabled)
    .map((book): BookDefinition => {
      const base = {
        id: book.id,
        name: book.name,
        riskTarget: book.riskTarget,
        maxPositionWeight: book.maxPositionWeight,
        capital: book.capital,
      };
      if (book.source === "symbols") {
        const symbols = [...new Set(book.symbols)];
        // A single class named after the book, so signals and emails read naturally.
        const id = book.id;
        return {
          ...base,
          symbols,
          classOf: Object.fromEntries(symbols.map((s) => [s, id])),
          classes: [{ id, name: book.className, rows: [{ id: "all", symbols }] }],
        };
      }
      const excluded = new Set(book.classExcludeLists);
      const classOf: Record<string, string> = {};
      const all: string[] = [];
      for (const list of watchlists.watchlists)
        for (const row of list.rows)
          for (const s of row.symbols) {
            if (!all.includes(s)) all.push(s);
            if (!classOf[s] && !excluded.has(list.id)) classOf[s] = list.id;
          }
      for (const [s, cls] of Object.entries(book.classOverrides)) {
        const key = s.toUpperCase();
        if (!watchlists.watchlists.some((l) => l.id === cls))
          throw new Error(`Unknown class override ${key} → ${cls}`);
        if (all.includes(key)) classOf[key] = cls;
      }
      // A symbol only on excluded lists has no class and stays out of the
      // book until a sector list or classOverrides gives it one.
      const classes: BookClass[] = [];
      for (const list of watchlists.watchlists) {
        if (excluded.has(list.id)) continue;
        const members = new Set(all.filter((s) => classOf[s] === list.id));
        if (!members.size) continue;
        const placed = new Set<string>();
        const rows = list.rows.flatMap((row) => {
          const symbols = row.symbols.filter(
            (s) => members.has(s) && !placed.has(s),
          );
          symbols.forEach((s) => placed.add(s));
          return symbols.length ? [{ id: row.id, symbols }] : [];
        });
        const rest = [...members].filter((s) => !placed.has(s));
        if (rest.length) rows.push({ id: "other", symbols: rest });
        classes.push({ id: list.id, name: list.name, rows });
      }
      const symbols = classes.flatMap((c) => c.rows.flatMap((r) => r.symbols));
      return { ...base, symbols, classOf, classes };
    });
}

/** Stable hash of everything that changes signals: config, catalog and engine version. */
export function configHash(config: StrategyConfig, books: BookDefinition[]) {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value as object)
              .sort()
              .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
          )
        : value;
  const { schedule: _schedule, email: _email, ...signalConfig } = config;
  return createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          engine: STRATEGY_ENGINE_VERSION,
          config: signalConfig,
          rules: ruleCatalog,
          books: books.map((b) => ({ id: b.id, classOf: b.classOf, classes: b.classes })),
        }),
      ),
    )
    .digest("hex")
    .slice(0, 12);
}
