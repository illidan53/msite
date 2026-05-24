interface MemoryCacheOptions {
  maxEntries?: number;
}

export class MemoryCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();
  private readonly maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = normalizeMaxEntries(options.maxEntries);
  }

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.pruneExpired();
    if (this.values.has(key)) {
      this.values.delete(key);
    }
    this.values.set(key, { expiresAt: Date.now() + ttlMs, value });
    this.evictOldest();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= now) {
        this.values.delete(key);
      }
    }
  }

  private evictOldest(): void {
    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.values.delete(oldestKey);
    }
  }
}

function normalizeMaxEntries(maxEntries: number | undefined): number {
  if (maxEntries === undefined || !Number.isFinite(maxEntries) || maxEntries < 1) {
    return 500;
  }

  return Math.trunc(maxEntries);
}
