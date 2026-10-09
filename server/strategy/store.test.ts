import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, SerialQueue, writeJsonAtomic } from "./store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "msite-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const isList = (v: unknown): v is number[] => Array.isArray(v);

describe("atomic JSON storage", () => {
  it("creates parent directories and writes owner-only files without leftovers", async () => {
    const file = join(dir, "strategy", "reports", "index.json");
    await writeJsonAtomic(file, { a: 1 });
    expect(await readJson(file)).toEqual({ a: 1 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(dir, "strategy", "reports"))).toEqual(["index.json"]);
  });

  it("treats missing, corrupt, truncated and invalid files as empty", async () => {
    const file = join(dir, "x.json");
    expect(await readJson(file)).toBeNull();
    await writeFile(file, "{not json");
    expect(await readJson(file)).toBeNull();
    await writeFile(file, '{"a": [1, 2');
    expect(await readJson(file)).toBeNull();
    await writeFile(file, '{"a": 1}');
    expect(await readJson(file, isList)).toBeNull();
    await writeFile(file, "[1,2]");
    expect(await readJson(file, isList)).toEqual([1, 2]);
  });

  it("still throws real I/O faults", async () => {
    await mkdir(join(dir, "folder.json"));
    await expect(readJson(join(dir, "folder.json"))).rejects.toThrow();
  });

  it("serialises writes to one file in call order and snapshots values", async () => {
    const file = join(dir, "seq.json");
    const value = { n: 0 };
    const writes = Array.from({ length: 25 }, (_, i) => {
      value.n = i;
      return writeJsonAtomic(file, value);
    });
    value.n = 999;
    // A read issued while writes are queued waits for them.
    expect(await readJson(file)).toEqual({ n: 24 });
    await Promise.all(writes);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ n: 24 });
    expect(await readdir(dir)).toEqual(["seq.json"]);
  });

  it("keeps the old document when a write fails and recovers on the next one", async () => {
    const file = join(dir, "doc.json");
    await writeJsonAtomic(file, { ok: 1 });
    await mkdir(`${file}.tmp`);
    await expect(writeJsonAtomic(file, { ok: 2 })).rejects.toThrow();
    expect(await readJson(file)).toEqual({ ok: 1 });
    await rm(`${file}.tmp`, { recursive: true });
    await writeJsonAtomic(file, { ok: 3 });
    expect(await readJson(file)).toEqual({ ok: 3 });
  });

  it("runs queued read-modify-write tasks one at a time", async () => {
    const queue = new SerialQueue();
    let value = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        queue.run(async () => {
          const read = value;
          await new Promise((r) => setTimeout(r, 1));
          value = read + 1;
          order.push(i);
        }),
      ),
    );
    expect(value).toBe(10);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
