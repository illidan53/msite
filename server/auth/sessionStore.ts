import { createHash, randomBytes } from "node:crypto";
import type { AuthProvider } from "../../shared/types";
import { readJson, SerialQueue, writeJsonAtomic } from "../strategy/store";

/** The signed-in account a session belongs to. */
export interface SessionAccount {
  /** Server-made hash of the provider identity; also the edits directory name. */
  id: string;
  provider: AuthProvider;
  /** Display only: never used to identify or link accounts. */
  email?: string;
  name?: string;
}

interface SessionRecord extends SessionAccount {
  createdAt: number;
  expiresAt: number;
}

interface SessionFile {
  version: 1;
  /** Keyed by the SHA-256 of the cookie token, so the file holds no live tokens. */
  sessions: Record<string, SessionRecord>;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_SESSIONS = 20_000;
/** Per account, so one account signing in repeatedly cannot evict others. */
const MAX_SESSIONS_PER_ACCOUNT = 10;

const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const isSessionFile = (value: unknown): value is SessionFile =>
  typeof value === "object" &&
  value !== null &&
  (value as SessionFile).version === 1 &&
  typeof (value as SessionFile).sessions === "object";

/**
 * Server-side sessions behind an opaque random cookie token. Signing out
 * deletes the record, so a copied cookie stops working; records live in
 * memory and are persisted (mode 0600) so deploys do not sign anyone out.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly queue = new SerialQueue();
  private loaded: Promise<void> | null = null;
  /** Memory holds changes the file does not yet (a write failed). */
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly options: {
      ttlMs?: number;
      maxSessions?: number;
      maxPerAccount?: number;
      now?: () => number;
    } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private load() {
    this.loaded ??= readJson(this.file, isSessionFile).then(
      (stored) => {
        for (const [key, record] of Object.entries(stored?.sessions ?? {}))
          if (record.expiresAt > this.now()) this.sessions.set(key, record);
      },
      (error: unknown) => {
        // A transient read error must not break sign-in until a restart.
        this.loaded = null;
        throw error;
      },
    );
    return this.loaded;
  }

  private async persist() {
    this.dirty = true;
    await writeJsonAtomic(this.file, {
      version: 1,
      sessions: Object.fromEntries(this.sessions),
    } satisfies SessionFile);
    this.dirty = false;
  }

  /** Starts a session and returns the token for the cookie. */
  create(account: SessionAccount): Promise<string> {
    return this.queue.run(async () => {
      await this.load();
      const now = this.now();
      for (const [key, record] of this.sessions)
        if (record.expiresAt <= now) this.sessions.delete(key);
      // Insertion order is oldest first: drop this account's oldest
      // sessions beyond its cap, then the oldest overall when full.
      const own = [...this.sessions].filter(([, record]) => record.id === account.id);
      for (const [key] of own.slice(
        0,
        Math.max(0, own.length - (this.options.maxPerAccount ?? MAX_SESSIONS_PER_ACCOUNT) + 1),
      ))
        this.sessions.delete(key);
      while (this.sessions.size >= (this.options.maxSessions ?? MAX_SESSIONS))
        this.sessions.delete(this.sessions.keys().next().value!);
      const token = randomBytes(32).toString("base64url");
      this.sessions.set(digest(token), {
        id: account.id,
        provider: account.provider,
        ...(account.email ? { email: account.email } : {}),
        ...(account.name ? { name: account.name } : {}),
        createdAt: now,
        expiresAt: now + (this.options.ttlMs ?? SESSION_TTL_MS),
      });
      await this.persist();
      return token;
    });
  }

  async get(token: string | undefined): Promise<SessionAccount | null> {
    if (!token || token.length > 128) return null;
    await this.load();
    const record = this.sessions.get(digest(token));
    if (!record || record.expiresAt <= this.now()) return null;
    const { createdAt: _createdAt, expiresAt: _expiresAt, ...account } = record;
    return account;
  }

  /** Ends every session of one account (all devices). */
  destroyAccount(accountId: string): Promise<void> {
    return this.queue.run(async () => {
      await this.load();
      let changed = false;
      for (const [key, record] of this.sessions)
        if (record.id === accountId) changed = this.sessions.delete(key) || changed;
      // Memory changes first so the session stops working at once; a retry
      // after a failed write still saves the file.
      if (changed || this.dirty) await this.persist();
    });
  }

  destroy(token: string | undefined): Promise<void> {
    return this.queue.run(async () => {
      if (!token) return;
      await this.load();
      if (this.sessions.delete(digest(token)) || this.dirty) await this.persist();
    });
  }
}
