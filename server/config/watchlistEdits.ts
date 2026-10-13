import type { WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";

/**
 * One browser's additions and removals layered over `config/watchlists.yaml`.
 * Kept in memory only: a restart or deploy drops them, and a later YAML
 * change always shows through.
 */
interface ListEdits {
  added: Array<{
    symbol: string;
    rowId: string;
    description?: string;
    subsectors?: string[];
  }>;
  removed: string[];
}

export interface WatchlistEdits {
  version: 1;
  updatedAt: string | null;
  lists: Record<string, ListEdits>;
}

const emptyEdits = (): WatchlistEdits => ({
  version: 1,
  updatedAt: null,
  lists: {},
});

/**
 * Base rows minus removed symbols, then added symbols appended to their row
 * (or the list's last row if that row no longer exists in the YAML). A symbol
 * the YAML already carries is never duplicated. Rows are kept even when empty
 * so a later add can target them. Subsectors keep only present symbols and
 * gain the additions tagged with them.
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
      const subsectors = list.subsectors?.map((subsector) => {
        const symbols = subsector.symbols.filter((s) => present.has(s));
        for (const entry of listEdits.added)
          if (
            entry.subsectors?.includes(subsector.id) &&
            present.has(entry.symbol) &&
            !symbols.includes(entry.symbol)
          )
            symbols.push(entry.symbol);
        return { ...subsector, symbols };
      });
      return {
        ...list,
        pinnedSymbols: list.pinnedSymbols.filter((s) => !removed.has(s)),
        ...(list.symbolDescriptions || Object.keys(descriptions).length
          ? { symbolDescriptions: descriptions }
          : {}),
        rows,
        ...(subsectors ? { subsectors } : {}),
      };
    }),
  };
}

export interface BrowserEditLimits {
  /** Browsers whose edits are kept; the least recently used is dropped. */
  maxBrowsers: number;
  /** Additions per browser across all lists, bounding its memory. */
  maxAddedPerBrowser: number;
}

/**
 * Edits per browser id, in memory. A Map keeps insertion order, and every
 * read or write moves a browser to the end, so the first key is always the
 * least recently used one and is dropped when a new browser needs room.
 * Operations are synchronous, so concurrent requests cannot interleave.
 */
export class BrowserEditStore {
  private readonly browsers = new Map<string, WatchlistEdits>();

  constructor(private readonly limits: BrowserEditLimits) {}

  get size() {
    return this.browsers.size;
  }

  read(browserId: string): WatchlistEdits {
    const edits = this.browsers.get(browserId);
    if (!edits) return emptyEdits();
    this.browsers.delete(browserId);
    this.browsers.set(browserId, edits);
    return edits;
  }

  /**
   * Runs `change` on a copy of one list's edits and keeps the result.
   * `change` throws to refuse the edit, leaving everything as it was.
   */
  update(
    browserId: string,
    listId: string,
    change: (edits: ListEdits, current: WatchlistEdits) => void,
  ): WatchlistEdits {
    const current = this.read(browserId);
    const listEdits: ListEdits = structuredClone(
      current.lists[listId] ?? { added: [], removed: [] },
    );
    change(listEdits, current);
    const lists = { ...current.lists, [listId]: listEdits };
    if (!listEdits.added.length && !listEdits.removed.length) delete lists[listId];
    const added = Object.values(lists).reduce((sum, list) => sum + list.added.length, 0);
    if (added > this.limits.maxAddedPerBrowser)
      throw new ApiError(409, "BROWSER_ADD_LIMIT", "This browser has too many added symbols", {
        source: "watchlists",
      });
    // Nothing to keep (e.g. resetting an untouched list): store nothing.
    if (!Object.keys(lists).length) {
      this.browsers.delete(browserId);
      return emptyEdits();
    }
    const next: WatchlistEdits = {
      version: 1,
      updatedAt: new Date().toISOString(),
      lists,
    };
    if (!this.browsers.has(browserId))
      while (this.browsers.size >= this.limits.maxBrowsers)
        this.browsers.delete(this.browsers.keys().next().value!);
    this.browsers.delete(browserId);
    this.browsers.set(browserId, next);
    return next;
  }
}
