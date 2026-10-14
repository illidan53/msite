import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type {
  SubsectorEditorState,
  Watchlist,
  WatchlistSubsector,
} from "../../shared/types";
import { ApiError } from "../http/apiError";
import { SerialQueue, writeJsonAtomic } from "../strategy/store";

export const subsectorEditsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(240).optional(),
        symbols: z.array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/)).max(500),
      })
      .strict(),
  )
  .max(30)
  .superRefine((items, context) => {
    if (
      new Set(items.map((s) => s.id)).size !== items.length ||
      new Set(items.map((s) => s.name.toLowerCase())).size !== items.length ||
      items.some((s) => new Set(s.symbols).size !== s.symbols.length)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate sub-sector or member",
      });
  });
const fileSchema = z.object({
  version: z.literal(1),
  lists: z.record(subsectorEditsSchema),
});
type Data = z.infer<typeof fileSchema>;

/** Display-only shared classifications. Quant/model universes still read YAML. */
export class SubsectorStore {
  private cached: Data | null = null;
  private queue = new SerialQueue();
  constructor(private readonly file: string) {}

  private async read(): Promise<Data> {
    if (this.cached) return this.cached;
    let data: Data;
    try {
      data = fileSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        data = { version: 1, lists: {} };
      else
        throw new ApiError(
          503,
          "SUBSECTORS_UNAVAILABLE",
          "Saved sub-sectors could not be read",
          { cause },
        );
    }
    this.cached ??= data;
    return this.cached;
  }

  async apply(list: Watchlist): Promise<Watchlist> {
    const stored = (await this.read()).lists[list.id];
    if (!stored) return list;
    const members = new Set(list.rows.flatMap((r) => r.symbols));
    return {
      ...list,
      subsectors: stored.map((s) => ({
        ...s,
        symbols: s.symbols.filter((symbol) => members.has(symbol)),
      })),
    };
  }

  async editor(list: Watchlist): Promise<SubsectorEditorState> {
    const current = await this.apply(list);
    const symbols = [...new Set(current.rows.flatMap((row) => row.symbols))];
    const subsectors = current.subsectors ?? [];
    const revision = createHash("sha256")
      .update(JSON.stringify({ symbols, subsectors }))
      .digest("hex");
    return { symbols, subsectors, revision };
  }

  save(
    loadList: () => Promise<Watchlist>,
    revision: string,
    subsectors: WatchlistSubsector[],
  ) {
    return this.queue.run(async () => {
      const list = await loadList();
      const current = await this.editor(list);
      if (revision !== current.revision)
        throw new ApiError(
          409,
          "SUBSECTORS_CONFLICT",
          "The list changed. Reload before saving again",
        );
      if (
        subsectors.some((s) =>
          s.symbols.some((symbol) => !current.symbols.includes(symbol)),
        )
      )
        throw new ApiError(
          400,
          "SUBSECTOR_UNKNOWN_MEMBER",
          "Choose members from this shared watchlist",
        );
      const validated = subsectorEditsSchema.parse(subsectors);
      const next: Data = {
        version: 1,
        lists: { ...(await this.read()).lists, [list.id]: validated },
      };
      await writeJsonAtomic(this.file, next);
      this.cached = next;
      return this.editor(list);
    });
  }
}
