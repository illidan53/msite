import { join } from "node:path";
import {
  STRATEGY_ENGINE_VERSION,
  type Signal,
  type SignalAction,
  type SignalRecord,
} from "../../shared/strategy";
import { readJson, SerialQueue, writeJsonAtomic } from "./store";

/** entry 0 → held (or a side flip), exit → 0, otherwise add or trim by size. */
export function classifyAction(fromShares: number, toShares: number): SignalAction {
  if (toShares === 0) return "exit";
  if (fromShares === 0 || Math.sign(fromShares) !== Math.sign(toShares)) return "entry";
  return Math.abs(toShares) > Math.abs(fromShares) ? "add" : "trim";
}

export const SIGNAL_LOG_LIMIT = 5000;

interface SignalFile {
  version: typeof STRATEGY_ENGINE_VERSION;
  records: SignalRecord[];
}
const isSignalFile = (v: unknown): v is SignalFile =>
  !!v &&
  typeof v === "object" &&
  (v as SignalFile).version === STRATEGY_ENGINE_VERSION &&
  Array.isArray((v as SignalFile).records);

/**
 * Signal history in `<dir>/signals.json`, newest decision session first,
 * capped at 5000 records. Fill and cancel outcomes arrive on later runs.
 */
export class SignalLog {
  private queue = new SerialQueue();
  private file: string;
  constructor(dir: string) {
    this.file = join(dir, "signals.json");
  }
  private async read() {
    return (await readJson(this.file, isSignalFile))?.records ?? [];
  }
  private update(change: (records: SignalRecord[]) => SignalRecord[]) {
    return this.queue.run(async () => {
      const records = change(await this.read()).slice(0, SIGNAL_LOG_LIMIT);
      await writeJsonAtomic(this.file, {
        version: STRATEGY_ENGINE_VERSION,
        records,
      } satisfies SignalFile);
    });
  }
  async list(limit = SIGNAL_LOG_LIMIT): Promise<SignalRecord[]> {
    await this.queue.run(async () => {});
    return (await this.read()).slice(0, Math.max(0, limit));
  }
  /**
   * Adds new signals. A signal with an existing id (the same book, session and
   * symbol decided again) replaces it but keeps any known e-mail and fill state.
   */
  append(signals: (Signal & { emailed?: boolean })[]) {
    return this.update((records) => {
      const byId = new Map(records.map((r) => [r.id, r]));
      const added: SignalRecord[] = signals.map((s) => {
        const old = byId.get(s.id);
        const fill = s.fill ?? old?.fill;
        return {
          ...s,
          ...(fill ? { fill } : {}),
          emailed: s.emailed ?? old?.emailed ?? false,
        };
      });
      const ids = new Set(added.map((s) => s.id));
      // Stable: within one session the given order wins, older sessions follow.
      return [...added, ...records.filter((r) => !ids.has(r.id))].sort((a, b) =>
        a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0,
      );
    });
  }
  markEmailed(ids: string[]) {
    const set = new Set(ids);
    return this.update((records) =>
      records.map((r) => (set.has(r.id) ? { ...r, emailed: true } : r)),
    );
  }
  applyFills(updates: { signalId: string; fill: Signal["fill"] }[]) {
    const fills = new Map(updates.map((u) => [u.signalId, u.fill]));
    return this.update((records) =>
      records.map((r) => {
        const fill = fills.get(r.id);
        return fill ? { ...r, fill } : r;
      }),
    );
  }
}
