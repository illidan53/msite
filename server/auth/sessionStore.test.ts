import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore, type SessionAccount } from "./sessionStore";

const alice: SessionAccount = { id: "alice-account-0000000000", provider: "google", email: "a@example.com" };
const bob: SessionAccount = { id: "bob-account-00000000000", provider: "microsoft" };

describe("SessionStore", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "msite-sessions-"));
    file = join(dir, "auth", "sessions.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists hashed sessions privately and survives a restart", async () => {
    const token = await new SessionStore(file).create(alice);
    const text = await readFile(file, "utf8");
    expect(text).not.toContain(token);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await new SessionStore(file).get(token)).toEqual(alice);
    expect(await new SessionStore(file).get("not-a-token")).toBeNull();
  });

  it("expires sessions and caps them per account and overall", async () => {
    let now = 1_000;
    const store = new SessionStore(file, { ttlMs: 100, maxPerAccount: 2, maxSessions: 3, now: () => now });
    const first = await store.create(alice);
    const second = await store.create(alice);
    const third = await store.create(alice);
    // Alice's oldest session made room for her third.
    expect(await store.get(first)).toBeNull();
    expect(await store.get(second)).toEqual(alice);
    const bobs = await store.create(bob);
    expect(await store.get(bobs)).toEqual(bob);
    expect(await store.get(third)).toEqual(alice);

    now += 100;
    expect(await store.get(third)).toBeNull();
  });

  it("ends one session, or all of an account's sessions", async () => {
    const store = new SessionStore(file);
    const [a1, a2, b1] = [await store.create(alice), await store.create(alice), await store.create(bob)];
    await store.destroy(a1);
    expect(await store.get(a1)).toBeNull();
    expect(await store.get(a2)).toEqual(alice);
    await store.destroyAccount(alice.id);
    expect(await store.get(a2)).toBeNull();
    expect(await store.get(b1)).toEqual(bob);
    expect(await new SessionStore(file).get(a2)).toBeNull();
  });

  it("keeps a revoked session revoked when the file write fails, and retries the write", async () => {
    const store = new SessionStore(file);
    const token = await store.create(alice);
    // A directory where the temporary file goes makes the next write fail.
    await mkdir(`${file}.tmp`);
    await expect(store.destroyAccount(alice.id)).rejects.toThrow();
    expect(await store.get(token)).toBeNull();
    await rm(`${file}.tmp`, { recursive: true });

    await store.destroyAccount(alice.id);
    expect(await new SessionStore(file).get(token)).toBeNull();
  });

  it("retries loading the file after a failed first read", async () => {
    const token = await new SessionStore(file).create(alice);
    await chmod(file, 0o000);
    const store = new SessionStore(file);
    await expect(store.get(token)).rejects.toThrow();
    await chmod(file, 0o600);
    expect(await store.get(token)).toEqual(alice);
  });
});
