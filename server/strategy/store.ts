import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Per-file write chains: a later write never lands before an earlier one. */
const writes = new Map<string, Promise<void>>();

/**
 * Reads a JSON file written by writeJsonAtomic. A missing, truncated or
 * corrupt file, or one failing `valid`, counts as empty (null); any other
 * I/O error (permissions, EISDIR) is a real fault and throws.
 */
export async function readJson<T>(
  file: string,
  valid?: (v: unknown) => v is T,
): Promise<T | null> {
  const key = resolve(file);
  await writes.get(key)?.catch(() => {});
  let text: string;
  try {
    text = await readFile(key, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  return !valid || valid(value) ? (value as T) : null;
}

/**
 * Writes `<file>.tmp` (mode 0600) and renames it over `file`, so readers see
 * either the old or the new document, never a partial one. The value is
 * serialised immediately, so later mutations of it are not persisted.
 */
export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const key = resolve(file);
  const text = JSON.stringify(value);
  const next = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(key), { recursive: true });
      const temp = `${key}.tmp`;
      await writeFile(temp, text, { mode: 0o600 });
      await rename(temp, key);
    });
  writes.set(key, next);
  const settle = () => {
    if (writes.get(key) === next) writes.delete(key);
  };
  next.then(settle, settle);
  return next;
}

/**
 * Serialises read-modify-write cycles on one store object so concurrent
 * callers never drop each other's changes.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(task);
    this.tail = next;
    return next;
  }
}
