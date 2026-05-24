export class MemoryCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();

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
    this.values.set(key, { expiresAt: Date.now() + ttlMs, value });
  }
}
