import { existsSync } from "node:fs";
import { mkdir, readdir, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { WatchlistsConfig } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { readJson, SerialQueue, writeJsonAtomic } from "../strategy/store";

/**
 * One account's additions and removals layered over `config/watchlists.yaml`.
 * The YAML ships inside the image, so edits live in the persistent data
 * directory and survive deploys; a later YAML change still shows through.
 */
const listEditsSchema = z.object({
  added: z.array(
    z.object({
      symbol: z.string().min(1),
      rowId: z.string().min(1),
      description: z.string().optional(),
      subsectors: z.array(z.string().min(1)).optional(),
    }),
  ),
  removed: z.array(z.string().min(1)),
});

const editsSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  /** Who owns the file, for operators reading it; never used for access. */
  account: z
    .object({ provider: z.string(), email: z.string().optional() })
    .optional(),
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

export class WatchlistEditStore {
  private readonly queue = new SerialQueue();

  constructor(readonly file: string) {}

  async read(): Promise<WatchlistEdits> {
    return (await readJson(this.file, isEdits)) ?? emptyEdits();
  }

  /** Runs `task` after every queued edit, so none can land after it. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    return this.queue.run(task);
  }

  /**
   * Runs `change` on a fresh copy of one list's edits and saves the result.
   * Changes are serialised so concurrent edits never drop each other.
   */
  update(
    listId: string,
    change: (edits: ListEdits, current: WatchlistEdits) => void,
    options: {
      account?: WatchlistEdits["account"];
      /**
       * Runs first inside the queue; throwing aborts the edit. Re-checks
       * that the request's session still exists, so an edit authorised
       * before "Delete my data" cannot recreate the deleted file.
       */
      guard?: () => Promise<void>;
      /** Runs inside the queue before writing; `isNew` for a first write. */
      beforeWrite?: (isNew: boolean) => Promise<void>;
    } = {},
  ): Promise<WatchlistEdits> {
    return this.queue.run(async () => {
      await options.guard?.();
      const current = await this.read();
      const listEdits: ListEdits = structuredClone(
        current.lists[listId] ?? { added: [], removed: [] },
      );
      change(listEdits, current);
      const isNew = current.updatedAt === null;
      // A no-op (e.g. resetting an untouched list) never creates a file.
      if (isNew && !listEdits.added.length && !listEdits.removed.length) return current;
      await options.beforeWrite?.(isNew);
      const next: WatchlistEdits = {
        version: 1,
        updatedAt: new Date().toISOString(),
        ...(options.account ?? current.account
          ? { account: options.account ?? current.account }
          : {}),
        lists: { ...current.lists, [listId]: listEdits },
      };
      if (!listEdits.added.length && !listEdits.removed.length)
        delete next.lists[listId];
      await writeJsonAtomic(this.file, next);
      return next;
    });
  }
}

/** Account ids are server-made hashes; anything else never becomes a path. */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{16,64}$/;

export interface AccountStorageLimits {
  /** Backstop on the number of accounts with stored edits. */
  maxAccounts: number;
  /** Free space a new account needs before its first write. */
  newAccountFreeBytes: number;
  /** Free space any write needs. */
  writeFreeBytes: number;
  /** Tests inject this; production asks the file system. */
  freeBytes?: (path: string) => Promise<number>;
}

const storageError = (code: string, message: string) =>
  new ApiError(503, code, message, { source: "watchlists" });

/**
 * Per-account edit files at `<dataDir>/accounts/<accountId>/watchlist-edits.json`.
 * Disk is the real limit on the small production volume: new accounts need
 * `newAccountFreeBytes` free and every write `writeFreeBytes`, with
 * `maxAccounts` as a backstop. Existing accounts keep working until space
 * itself runs low.
 */
export class AccountEditStores {
  private readonly stores = new Map<string, WatchlistEditStore>();
  private readonly root: string;
  private readonly creating = new SerialQueue();

  constructor(
    dataDir: string,
    private readonly limits: AccountStorageLimits,
  ) {
    this.root = join(dataDir, "accounts");
  }

  private async freeBytes() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (this.limits.freeBytes) return this.limits.freeBytes(this.root);
    const stats = await statfs(this.root);
    return Number(stats.bavail) * Number(stats.bsize);
  }

  /** Throws 503 STORAGE_LOW when the volume is nearly full. */
  async ensureWriteSpace(): Promise<void> {
    if ((await this.freeBytes()) < this.limits.writeFreeBytes)
      throw storageError("STORAGE_LOW", "Saving is paused while the server is low on storage");
  }

  for(accountId: string): WatchlistEditStore {
    if (!ACCOUNT_ID.test(accountId)) throw new Error("Invalid account id");
    let store = this.stores.get(accountId);
    if (!store) {
      store = new WatchlistEditStore(
        join(this.root, accountId, "watchlist-edits.json"),
      );
      this.stores.set(accountId, store);
    }
    return store;
  }

  /** Permanently removes an account's edits directory. */
  async delete(accountId: string): Promise<void> {
    const store = this.for(accountId);
    await store.exclusive(() =>
      rm(join(this.root, accountId), { recursive: true, force: true }),
    );
  }

  /**
   * Claims a directory for a new account, or throws 503 ACCOUNT_LIMIT when
   * space or the backstop count would be exceeded. Serialised, so concurrent
   * sign-ups cannot overshoot it.
   */
  ensureCapacity(accountId: string): Promise<void> {
    return this.creating.run(async () => {
      if (existsSync(join(this.root, accountId))) return;
      const free = await this.freeBytes();
      const count = (await readdir(this.root, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory(),
      ).length;
      if (count >= this.limits.maxAccounts || free < this.limits.newAccountFreeBytes)
        throw storageError("ACCOUNT_LIMIT", "New accounts cannot save watchlist edits right now");
      await mkdir(join(this.root, accountId), { recursive: true, mode: 0o700 });
    });
  }
}
