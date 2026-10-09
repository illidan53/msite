import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Signal } from "../../shared/strategy";
import { classifyAction, SignalLog } from "./signals";

describe("signal actions", () => {
  it("classifies entries, adds, trims and exits", () => {
    expect(classifyAction(0, 10)).toBe("entry");
    expect(classifyAction(10, 15)).toBe("add");
    expect(classifyAction(10, 4)).toBe("trim");
    expect(classifyAction(10, 0)).toBe("exit");
    expect(classifyAction(-5, 5)).toBe("entry");
    expect(classifyAction(-5, -8)).toBe("add");
  });
});

const signal = (asOf: string, symbol: string, extra: Partial<Signal> = {}): Signal => ({
  id: `stocks:${asOf}:${symbol}`,
  book: "stocks",
  symbol,
  class: "chips",
  asOf,
  action: "entry",
  fromShares: 0,
  toShares: 10,
  shares: 10,
  price: 100,
  notional: 1000,
  fromWeight: 0,
  toWeight: 1,
  forecast: 8,
  drivers: [],
  reason: "forecast",
  ...extra,
});

describe("signal log", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "msite-signals-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends newest first and tracks e-mail and fill outcomes", async () => {
    const log = new SignalLog(dir);
    expect(await log.list()).toEqual([]);
    await log.append([signal("2026-10-06", "A"), signal("2026-10-06", "B")]);
    await log.append([signal("2026-10-07", "C")]);
    expect((await log.list()).map((s) => s.id)).toEqual([
      "stocks:2026-10-07:C",
      "stocks:2026-10-06:A",
      "stocks:2026-10-06:B",
    ]);
    expect((await log.list(1)).map((s) => s.symbol)).toEqual(["C"]);
    await log.markEmailed(["stocks:2026-10-07:C"]);
    await log.applyFills([
      { signalId: "stocks:2026-10-06:A", fill: { date: "2026-10-07", price: 101, cost: 0.03 } },
      { signalId: "stocks:2026-10-06:B", fill: { cancelled: "2026-10-08" } },
      { signalId: "stocks:1999-01-01:Z", fill: { cancelled: "2026-10-08" } },
    ]);
    const [c, a, b] = await log.list();
    expect(c.emailed).toBe(true);
    expect(a).toMatchObject({ emailed: false, fill: { date: "2026-10-07", price: 101 } });
    expect(b.fill).toEqual({ cancelled: "2026-10-08" });
  });

  it("replaces a re-decided signal but keeps its e-mail and fill state", async () => {
    const log = new SignalLog(dir);
    await log.append([signal("2026-10-07", "A")]);
    await log.markEmailed(["stocks:2026-10-07:A"]);
    await log.append([signal("2026-10-07", "A", { shares: 12, toShares: 12 })]);
    const list = await log.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ shares: 12, emailed: true });
  });

  it("serialises concurrent updates and caps the log at 5000", async () => {
    const log = new SignalLog(dir);
    const day = (i: number) =>
      new Date(Date.UTC(2010, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    await Promise.all(
      Array.from({ length: 6 }, (_, k) =>
        log.append(Array.from({ length: 1000 }, (_, j) => signal(day(k * 1000 + j), "A"))),
      ),
    );
    const list = await log.list();
    expect(list).toHaveLength(5000);
    expect(list[0].asOf).toBe(day(5999));
    expect(list.at(-1)!.asOf).toBe(day(1000));
  });

  it("ignores a file written by another engine version or corrupted", async () => {
    await writeFile(join(dir, "signals.json"), JSON.stringify({ version: 0, records: [signal("2026-10-07", "A")] }));
    expect(await new SignalLog(dir).list()).toEqual([]);
    await writeFile(join(dir, "signals.json"), "[");
    expect(await new SignalLog(dir).list()).toEqual([]);
  });
});
