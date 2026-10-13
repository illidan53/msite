import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { parseSettingsConfig, parseWatchlistsConfig } from "../../shared/schemas";
import type { SettingsConfig, WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { resolveConfigPaths } from "./configPaths";
import {
  OWNER_FOCUS_ID,
  OWNER_FOCUS_ROW_ID,
  OwnerFocusStore,
  ownerFocusWatchlist,
} from "./ownerFocus";
import {
  applyWatchlistEdits,
  BrowserEditStore,
  type BrowserEditLimits,
} from "./watchlistEdits";

export interface ConfigRepositoryOptions {
  configDir?: string;
  /** Keep per-browser watchlist edits in memory; without it lists are read-only. */
  browserEdits?: boolean;
  /** Memory limits for per-browser edits; defaults below. */
  limits?: Partial<BrowserEditLimits>;
  /** JSON file holding the Owner Focus list; without it there is no such list. */
  ownerFocusFile?: string;
}

export interface StockWorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

/** Runtime additions per list (each browser also has an overall cap). */
export const MAX_ADDED_SYMBOLS_PER_LIST = 50;
/**
 * Memory guards for the 912 MB production host. An addition with a full
 * 160-character note and every sub-sector tag retains about 0.6–0.8 KB of
 * heap (measured), so the worst case is about 1,000 × 60 × 0.8 KB ≈ 48 MB.
 */
export const DEFAULT_BROWSER_LIMITS: BrowserEditLimits = {
  maxBrowsers: 1_000,
  maxAddedPerBrowser: 60,
};

const watchlistError = (status: number, code: string, message: string) =>
  new ApiError(status, code, message, { source: "watchlists" });

export class ConfigRepository {
  private readonly paths: ReturnType<typeof resolveConfigPaths>;
  private readonly edits: BrowserEditStore | null;
  private readonly ownerFocus: OwnerFocusStore | null;

  constructor(options: ConfigRepositoryOptions = {}) {
    this.paths = resolveConfigPaths(options.configDir);
    this.edits = options.browserEdits
      ? new BrowserEditStore({ ...DEFAULT_BROWSER_LIMITS, ...options.limits })
      : null;
    this.ownerFocus = options.ownerFocusFile ? new OwnerFocusStore(options.ownerFocusFile) : null;
  }

  async readConfig(browserId: string | null = null, owner = false): Promise<StockWorkbenchConfig> {
    const [watchlists, settings] = await Promise.all([
      this.readWatchlists(browserId, owner),
      this.readSettings(),
    ]);

    return { watchlists, settings };
  }

  /**
   * The Owner Focus list first, then the YAML watchlists with the browser's
   * own additions and removals applied when one is given. Other browsers,
   * the Quant System and Models see the YAML lists only. `owner` marks
   * whether this visitor may edit Owner Focus.
   */
  async readWatchlists(browserId: string | null = null, owner = false): Promise<WatchlistsConfig> {
    const base = await this.readBaseWatchlists();

    return this.withOwnerFocus(
      browserId && this.edits ? applyWatchlistEdits(base, this.edits.read(browserId)) : base,
      owner,
    );
  }

  /** Puts the Owner Focus list (when configured) in front of `lists`. */
  async withOwnerFocus(lists: WatchlistsConfig, owner: boolean): Promise<WatchlistsConfig> {
    if (!this.ownerFocus) return lists;

    return {
      watchlists: [ownerFocusWatchlist(await this.ownerFocus.read(), owner), ...lists.watchlists],
    };
  }

  isOwnerFocus(listId: string): boolean {
    return listId === OWNER_FOCUS_ID && this.ownerFocus !== null;
  }

  /** Appends a symbol to Owner Focus; the caller has checked it is the owner. */
  async addOwnerFocusSymbol(input: {
    symbol: string;
    rowId: string;
    description?: string;
    subsectors?: string[];
  }): Promise<void> {
    if (!this.ownerFocus) throw watchlistError(404, "WATCHLIST_NOT_FOUND", "Unknown watchlist");
    if (input.rowId !== OWNER_FOCUS_ROW_ID)
      throw watchlistError(400, "WATCHLIST_ROW_NOT_FOUND", "Unknown watchlist row");
    if (input.subsectors?.length)
      throw watchlistError(400, "WATCHLIST_SUBSECTOR_NOT_FOUND", "Unknown watchlist subsector");
    await this.ownerFocus.add(input.symbol, input.description);
  }

  async removeOwnerFocusSymbol(symbol: string): Promise<void> {
    if (!this.ownerFocus) throw watchlistError(404, "WATCHLIST_NOT_FOUND", "Unknown watchlist");
    await this.ownerFocus.remove(symbol);
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
   * Adds `symbol` to one row of a list, optionally tagged with subsectors.
   * Re-adding a YAML symbol to its own row with no new description or
   * subsector just undoes its removal; anything else records an addition at
   * the end of that row.
   */
  async addWatchlistSymbol(
    browserId: string,
    listId: string,
    input: { symbol: string; rowId: string; description?: string; subsectors?: string[] },
  ): Promise<WatchlistsConfig> {
    const { symbol, rowId, description } = input;
    const subsectors = [...new Set(input.subsectors ?? [])];
    const { base, list, store } = await this.editableList(listId);
    if (!list.rows.some((row) => row.id === rowId))
      throw watchlistError(400, "WATCHLIST_ROW_NOT_FOUND", "Unknown watchlist row");
    if (subsectors.some((id) => !list.subsectors?.some((subsector) => subsector.id === id)))
      throw watchlistError(400, "WATCHLIST_SUBSECTOR_NOT_FOUND", "Unknown watchlist subsector");
    const baseRow = list.rows.find((row) => row.symbols.includes(symbol))?.id;
    const baseSubsectors = new Set(
      list.subsectors?.filter((s) => s.symbols.includes(symbol)).map((s) => s.id),
    );
    const restores =
      baseRow === rowId &&
      (!description || description === list.symbolDescriptions?.[symbol]) &&
      subsectors.every((id) => baseSubsectors.has(id));
    const edits = store.update(browserId, listId, (listEdits, current) => {
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
      listEdits.added.push({
        symbol,
        rowId,
        ...(description ? { description } : {}),
        ...(subsectors.length ? { subsectors } : {}),
      });
    });

    return applyWatchlistEdits(base, edits);
  }

  /** Removes `symbol` from every row of a list; a list keeps at least one symbol. */
  async removeWatchlistSymbol(
    browserId: string,
    listId: string,
    symbol: string,
  ): Promise<WatchlistsConfig> {
    const { base, list, store } = await this.editableList(listId);
    const inBase = list.rows.some((row) => row.symbols.includes(symbol));
    const edits = store.update(browserId, listId, (listEdits, current) => {
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

  /** Drops the browser's edits to one list, back to the YAML version. */
  async resetWatchlist(browserId: string, listId: string): Promise<WatchlistsConfig> {
    const { base, store } = await this.editableList(listId);
    const edits = store.update(browserId, listId, (listEdits) => {
      listEdits.added = [];
      listEdits.removed = [];
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
