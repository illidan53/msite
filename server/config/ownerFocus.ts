import { z } from "zod";
import type { Watchlist } from "../../shared/types";
import { ApiError } from "../http/apiError";
import { readJson, SerialQueue, writeJsonAtomic } from "../strategy/store";

/** The site owner's own list. It is not in the YAML and never reaches the Quant System or Models. */
export const OWNER_FOCUS_ID = "owner-focus";
export const OWNER_FOCUS_ROW_ID = "focus";
/** Every symbol joins each quote refresh, so the list stays small. */
export const MAX_OWNER_FOCUS_SYMBOLS = 100;

const ownerFocusSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  symbols: z.array(
    z.object({
      symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
      description: z.string().max(160).optional(),
      addedAt: z.string(),
    }),
  ),
});

export type OwnerFocus = z.infer<typeof ownerFocusSchema>;
type Entry = OwnerFocus["symbols"][number];

const isOwnerFocus = (value: unknown): value is OwnerFocus =>
  ownerFocusSchema.safeParse(value).success;

const listError = (status: number, code: string, message: string) =>
  new ApiError(status, code, message, { source: "watchlists" });

/**
 * The Owner Focus symbols, in the order they were added, saved as one JSON
 * file (production keeps it in RESEARCH_DATA_DIR, which survives deploys).
 * A missing or unreadable file counts as an empty list. Writes are atomic
 * and queued, so concurrent edits never drop each other.
 */
export class OwnerFocusStore {
  private cached: OwnerFocus | null = null;
  private readonly queue = new SerialQueue();

  constructor(private readonly file: string) {}

  async read(): Promise<OwnerFocus> {
    if (!this.cached) {
      const loaded = (await readJson(this.file, isOwnerFocus)) ?? {
        version: 1,
        updatedAt: null,
        symbols: [],
      };
      // A write that finished while this read was waiting wins.
      this.cached ??= loaded;
    }
    return this.cached;
  }

  add(symbol: string, description?: string): Promise<OwnerFocus> {
    return this.change((symbols) => {
      if (symbols.some((entry) => entry.symbol === symbol))
        throw listError(409, "WATCHLIST_SYMBOL_EXISTS", "The symbol is already in this watchlist");
      if (symbols.length >= MAX_OWNER_FOCUS_SYMBOLS)
        throw listError(409, "WATCHLIST_ADD_LIMIT", "This watchlist has too many symbols");
      return [
        ...symbols,
        { symbol, ...(description ? { description } : {}), addedAt: new Date().toISOString() },
      ];
    });
  }

  /** The list may become empty. */
  remove(symbol: string): Promise<OwnerFocus> {
    return this.change((symbols) => {
      if (!symbols.some((entry) => entry.symbol === symbol))
        throw listError(404, "WATCHLIST_SYMBOL_NOT_FOUND", "The symbol is not in this watchlist");
      return symbols.filter((entry) => entry.symbol !== symbol);
    });
  }

  /** `edit` throws to refuse a change, leaving the file as it was. */
  private change(edit: (symbols: Entry[]) => Entry[]): Promise<OwnerFocus> {
    return this.queue.run(async () => {
      const next: OwnerFocus = {
        version: 1,
        updatedAt: new Date().toISOString(),
        symbols: edit((await this.read()).symbols),
      };
      await writeJsonAtomic(this.file, next);
      this.cached = next;
      return next;
    });
  }
}

/**
 * The list as the workbench shows it: one row, everyone can read it, and
 * `canEdit` tells this visitor whether they are the owner.
 */
export function ownerFocusWatchlist(focus: OwnerFocus, canEdit: boolean): Watchlist {
  return {
    id: OWNER_FOCUS_ID,
    name: "Owner Focus",
    description: "Stocks the site owner is watching",
    navigationGroup: "primary",
    pinnedSymbols: [],
    symbolDescriptions: Object.fromEntries(
      focus.symbols.flatMap((entry) =>
        entry.description ? [[entry.symbol, entry.description]] : [],
      ),
    ),
    rows: [
      {
        id: OWNER_FOCUS_ROW_ID,
        name: "Focus",
        expandedByDefault: true,
        symbols: focus.symbols.map((entry) => entry.symbol),
      },
    ],
    ownerManaged: { canEdit },
  };
}
