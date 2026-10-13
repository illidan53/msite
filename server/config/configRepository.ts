import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { parseSettingsConfig, parseWatchlistsConfig } from "../../shared/schemas";
import type { SettingsConfig, WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { resolveConfigPaths } from "./configPaths";
import { applyWatchlistEdits, WatchlistEditStore } from "./watchlistEdits";

export interface ConfigRepositoryOptions {
  configDir?: string;
  /** Where runtime watchlist edits are kept; without it lists are read-only. */
  dataDir?: string;
}

export interface StockWorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

/** Runtime additions per list, so a stuck client cannot grow a list without bound. */
export const MAX_ADDED_SYMBOLS_PER_LIST = 100;

const watchlistError = (status: number, code: string, message: string) =>
  new ApiError(status, code, message, { source: "watchlists" });

export class ConfigRepository {
  private readonly paths: ReturnType<typeof resolveConfigPaths>;
  private readonly edits: WatchlistEditStore | null;

  constructor(options: ConfigRepositoryOptions = {}) {
    this.paths = resolveConfigPaths(options.configDir);
    this.edits = options.dataDir ? new WatchlistEditStore(options.dataDir) : null;
  }

  async readConfig(): Promise<StockWorkbenchConfig> {
    const [watchlists, settings] = await Promise.all([this.readWatchlists(), this.readSettings()]);

    return { watchlists, settings };
  }

  /** The YAML watchlists with runtime additions and removals applied. */
  async readWatchlists(): Promise<WatchlistsConfig> {
    const base = await this.readBaseWatchlists();

    return this.edits ? applyWatchlistEdits(base, await this.edits.read()) : base;
  }

  async readBaseWatchlists(): Promise<WatchlistsConfig> {
    const content = await readFile(this.paths.watchlistsPath, "utf8");

    return parseWatchlistsConfig(YAML.parse(content));
  }

  async readSettings(): Promise<SettingsConfig> {
    const content = await readFile(this.paths.settingsPath, "utf8");

    return parseSettingsConfig(YAML.parse(content));
  }

  /**
   * Adds `symbol` to one row of a list. Re-adding a YAML symbol to its own row
   * with no or its YAML description just undoes its removal; any other row,
   * or a new description, records an addition at the end of that row.
   */
  async addWatchlistSymbol(
    listId: string,
    input: { symbol: string; rowId: string; description?: string },
  ): Promise<WatchlistsConfig> {
    const { symbol, rowId, description } = input;
    const { base, list, store } = await this.editableList(listId);
    if (!list.rows.some((row) => row.id === rowId))
      throw watchlistError(400, "WATCHLIST_ROW_NOT_FOUND", "Unknown watchlist row");
    const baseRow = list.rows.find((row) => row.symbols.includes(symbol))?.id;
    const restores =
      baseRow === rowId && (!description || description === list.symbolDescriptions?.[symbol]);
    const edits = await store.update(listId, (listEdits, current) => {
      const merged = applyWatchlistEdits(base, current).watchlists.find((l) => l.id === listId);
      if (merged?.rows.some((row) => row.symbols.includes(symbol)))
        throw watchlistError(409, "WATCHLIST_SYMBOL_EXISTS", "The symbol is already in this watchlist");
      listEdits.added = listEdits.added.filter((entry) => entry.symbol !== symbol);
      if (restores) {
        listEdits.removed = listEdits.removed.filter((s) => s !== symbol);
        return;
      }
      if (listEdits.added.length >= MAX_ADDED_SYMBOLS_PER_LIST)
        throw watchlistError(409, "WATCHLIST_ADD_LIMIT", "This watchlist has too many added symbols");
      listEdits.added.push({ symbol, rowId, ...(description ? { description } : {}) });
    });

    return applyWatchlistEdits(base, edits);
  }

  /** Removes `symbol` from every row of a list; a list keeps at least one symbol. */
  async removeWatchlistSymbol(listId: string, symbol: string): Promise<WatchlistsConfig> {
    const { base, list, store } = await this.editableList(listId);
    const inBase = list.rows.some((row) => row.symbols.includes(symbol));
    const edits = await store.update(listId, (listEdits, current) => {
      const merged = applyWatchlistEdits(base, current).watchlists.find((l) => l.id === listId);
      const members = new Set(merged?.rows.flatMap((row) => row.symbols));
      if (!members.has(symbol))
        throw watchlistError(404, "WATCHLIST_SYMBOL_NOT_FOUND", "The symbol is not in this watchlist");
      if (members.size <= 1)
        throw watchlistError(409, "WATCHLIST_LAST_SYMBOL", "A watchlist must keep at least one symbol");
      listEdits.added = listEdits.added.filter((entry) => entry.symbol !== symbol);
      if (inBase && !listEdits.removed.includes(symbol)) listEdits.removed.push(symbol);
    });

    return applyWatchlistEdits(base, edits);
  }

  private async editableList(listId: string) {
    if (!this.edits)
      throw watchlistError(503, "WATCHLIST_EDITS_UNAVAILABLE", "Watchlist editing is not configured");
    const base = await this.readBaseWatchlists();
    const list = base.watchlists.find((item) => item.id === listId);
    if (!list) throw watchlistError(404, "WATCHLIST_NOT_FOUND", "Unknown watchlist");

    return { base, list, store: this.edits };
  }
}
