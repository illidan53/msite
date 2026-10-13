import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { parseSettingsConfig, parseWatchlistsConfig } from "../../shared/schemas";
import type { SettingsConfig, WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { resolveConfigPaths } from "./configPaths";
import {
  AccountEditStores,
  applyWatchlistEdits,
  type AccountStorageLimits,
} from "./watchlistEdits";

export interface ConfigRepositoryOptions {
  configDir?: string;
  /** Where per-account watchlist edits are kept; without it lists are read-only. */
  dataDir?: string;
  /** Storage limits for per-account edits; defaults below. */
  limits?: Partial<AccountStorageLimits>;
}

/** The signed-in account whose edits are read or written. */
export interface EditingAccount {
  id: string;
  provider: string;
  email?: string;
  /**
   * Re-checked inside the account's write queue, just before writing: false
   * means the session ended (sign-out or "Delete my data") after the request
   * was authorised, and the edit is refused.
   */
  isCurrent?: () => Promise<boolean>;
}

export interface StockWorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

/** Runtime additions per list, so a stuck client cannot grow a list without bound. */
export const MAX_ADDED_SYMBOLS_PER_LIST = 100;
/**
 * Storage guards for the 8 GB production volume, which also holds Docker
 * images and Quant System data. Free space is the real limit; the count is a
 * backstop. One account's file is at most a few hundred KB.
 */
export const DEFAULT_STORAGE_LIMITS: AccountStorageLimits = {
  maxAccounts: 50_000,
  newAccountFreeBytes: 1024 ** 3,
  writeFreeBytes: 256 * 1024 ** 2,
};

const watchlistError = (status: number, code: string, message: string) =>
  new ApiError(status, code, message, { source: "watchlists" });

export class ConfigRepository {
  private readonly paths: ReturnType<typeof resolveConfigPaths>;
  private readonly accounts: AccountEditStores | null;

  constructor(options: ConfigRepositoryOptions = {}) {
    this.paths = resolveConfigPaths(options.configDir);
    this.accounts = options.dataDir
      ? new AccountEditStores(options.dataDir, {
          ...DEFAULT_STORAGE_LIMITS,
          ...options.limits,
        })
      : null;
  }

  async readConfig(account: Pick<EditingAccount, "id"> | null = null): Promise<StockWorkbenchConfig> {
    const [watchlists, settings] = await Promise.all([this.readWatchlists(account), this.readSettings()]);

    return { watchlists, settings };
  }

  /**
   * The YAML watchlists, with the account's own additions and removals
   * applied when one is given. Everyone else, the Quant System and Models
   * see the YAML lists only.
   */
  async readWatchlists(account: Pick<EditingAccount, "id"> | null = null): Promise<WatchlistsConfig> {
    const base = await this.readBaseWatchlists();
    if (!account || !this.accounts) return base;

    return applyWatchlistEdits(base, await this.accounts.for(account.id).read());
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
    account: EditingAccount,
    listId: string,
    input: { symbol: string; rowId: string; description?: string; subsectors?: string[] },
  ): Promise<WatchlistsConfig> {
    const { symbol, rowId, description } = input;
    const subsectors = [...new Set(input.subsectors ?? [])];
    const { base, list, store, options } = await this.editableList(account, listId);
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
      listEdits.added.push({
        symbol,
        rowId,
        ...(description ? { description } : {}),
        ...(subsectors.length ? { subsectors } : {}),
      });
    }, options);

    return applyWatchlistEdits(base, edits);
  }

  /** Removes `symbol` from every row of a list; a list keeps at least one symbol. */
  async removeWatchlistSymbol(
    account: EditingAccount,
    listId: string,
    symbol: string,
  ): Promise<WatchlistsConfig> {
    const { base, list, store, options } = await this.editableList(account, listId);
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
    }, options);

    return applyWatchlistEdits(base, edits);
  }

  /** Drops the account's edits to one list, back to the YAML version. */
  async resetWatchlist(account: EditingAccount, listId: string): Promise<WatchlistsConfig> {
    const { base, store, options } = await this.editableList(account, listId);
    const edits = await store.update(listId, (listEdits) => {
      listEdits.added = [];
      listEdits.removed = [];
    }, options);

    return applyWatchlistEdits(base, edits);
  }

  /** Deletes everything stored for the account (its "Delete my data"). */
  async deleteAccountEdits(account: Pick<EditingAccount, "id">): Promise<void> {
    await this.accounts?.delete(account.id);
  }

  private async editableList(account: EditingAccount, listId: string) {
    if (!this.accounts)
      throw watchlistError(503, "WATCHLIST_EDITS_UNAVAILABLE", "Watchlist editing is not configured");
    const base = await this.readBaseWatchlists();
    const list = base.watchlists.find((item) => item.id === listId);
    if (!list) throw watchlistError(404, "WATCHLIST_NOT_FOUND", "Unknown watchlist");
    const accounts = this.accounts;

    return {
      base,
      list,
      store: accounts.for(account.id),
      options: {
        account: { provider: account.provider, ...(account.email ? { email: account.email } : {}) },
        guard: async () => {
          if (account.isCurrent && !(await account.isCurrent()))
            throw watchlistError(401, "AUTH_REQUIRED", "Sign in to edit watchlists");
        },
        beforeWrite: async (isNew: boolean) => {
          if (isNew) await accounts.ensureCapacity(account.id);
          await accounts.ensureWriteSpace();
        },
      },
    };
  }
}
