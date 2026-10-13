import { join } from "node:path";
import { z } from "zod";
import type { WatchlistsConfig } from "../../shared/types";
import { readJson, SerialQueue, writeJsonAtomic } from "../strategy/store";

/**
 * Runtime additions and removals layered over `config/watchlists.yaml`.
 * The YAML ships inside the image, so edits live in the persistent data
 * directory and survive deploys; a later YAML change still shows through.
 */
const listEditsSchema = z.object({
  added: z.array(
    z.object({
      symbol: z.string().min(1),
      rowId: z.string().min(1),
      description: z.string().optional(),
    }),
  ),
  removed: z.array(z.string().min(1)),
});

const editsSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  lists: z.record(listEditsSchema),
});

export type WatchlistEdits = z.infer<typeof editsSchema>;
type ListEdits = z.infer<typeof listEditsSchema>;

const emptyEdits = (): WatchlistEdits => ({
  version: 1,
  updatedAt: null,
  lists: {},
});
const isEdits = (value: unknown): value is WatchlistEdits =>
  editsSchema.safeParse(value).success;

/**
 * Base rows minus removed symbols, then added symbols appended to their row
 * (or the list's last row if that row no longer exists in the YAML). A symbol
 * the YAML already carries is never duplicated. Rows are kept even when empty
 * so a later add can target them.
 */
export function applyWatchlistEdits(
  base: WatchlistsConfig,
  edits: WatchlistEdits,
): WatchlistsConfig {
  return {
    watchlists: base.watchlists.map((list) => {
      const listEdits = edits.lists[list.id];
      if (!listEdits) return list;
      const removed = new Set(listEdits.removed);
      const rows = list.rows.map((row) => ({
        ...row,
        symbols: row.symbols.filter((symbol) => !removed.has(symbol)),
      }));
      const present = new Set(rows.flatMap((row) => row.symbols));
      const descriptions = { ...list.symbolDescriptions };
      for (const entry of listEdits.added) {
        if (present.has(entry.symbol)) continue;
        const row = rows.find((r) => r.id === entry.rowId) ?? rows.at(-1);
        if (!row) continue;
        row.symbols.push(entry.symbol);
        present.add(entry.symbol);
        if (entry.description) descriptions[entry.symbol] = entry.description;
      }
      return {
        ...list,
        pinnedSymbols: list.pinnedSymbols.filter((s) => !removed.has(s)),
        ...(list.symbolDescriptions || Object.keys(descriptions).length
          ? { symbolDescriptions: descriptions }
          : {}),
        rows,
      };
    }),
  };
}

export class WatchlistEditStore {
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(dataDir: string) {
    this.file = join(dataDir, "watchlist-edits.json");
  }

  async read(): Promise<WatchlistEdits> {
    return (await readJson(this.file, isEdits)) ?? emptyEdits();
  }

  /**
   * Runs `change` on a fresh copy of one list's edits and saves the result.
   * Changes are serialised so concurrent edits never drop each other.
   */
  update(
    listId: string,
    change: (edits: ListEdits, current: WatchlistEdits) => void,
  ): Promise<WatchlistEdits> {
    return this.queue.run(async () => {
      const current = await this.read();
      const listEdits: ListEdits = structuredClone(
        current.lists[listId] ?? { added: [], removed: [] },
      );
      change(listEdits, current);
      const next: WatchlistEdits = {
        version: 1,
        updatedAt: new Date().toISOString(),
        lists: { ...current.lists, [listId]: listEdits },
      };
      if (!listEdits.added.length && !listEdits.removed.length)
        delete next.lists[listId];
      await writeJsonAtomic(this.file, next);
      return next;
    });
  }
}
