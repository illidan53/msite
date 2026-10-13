import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * AES-256-GCM sealing for cookie values: the browser can neither read nor
 * alter them. `purpose` is bound as associated data, so a login-transaction
 * cookie can never be replayed as a session, and `exp` (seconds) is checked
 * on open.
 */
export class CookieSealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Cookie key must be 32 bytes");
  }

  seal(purpose: string, value: object, ttlSeconds: number, now = Date.now()) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = JSON.stringify({
      ...value,
      exp: Math.floor(now / 1000) + ttlSeconds,
    });
    const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
  }

  open<T extends object>(
    purpose: string,
    token: string | undefined,
    now = Date.now(),
  ): (T & { exp: number }) | null {
    if (!token || token.length > 4096) return null;
    try {
      const raw = Buffer.from(token, "base64url");
      if (raw.length < 12 + 16 + 1) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      const body = Buffer.concat([
        decipher.update(raw.subarray(12, raw.length - 16)),
        decipher.final(),
      ]).toString("utf8");
      const value = JSON.parse(body) as T & { exp: number };
      return typeof value.exp === "number" && value.exp * 1000 > now
        ? value
        : null;
    } catch {
      return null;
    }
  }
}

/**
 * The cookie key: derived from SESSION_SECRET when set, otherwise generated
 * once and kept (mode 0600) in the data directory so sessions survive
 * restarts and deploys. Rotating either signs everyone out.
 */
export async function loadCookieKey(
  dataDir: string,
  secret = process.env.SESSION_SECRET,
): Promise<Buffer> {
  if (secret?.trim()) {
    if (secret.trim().length < 32)
      throw new Error("SESSION_SECRET must be at least 32 characters");
    return createHash("sha256").update(secret.trim()).digest();
  }
  const file = join(dataDir, "auth", "cookie-key");
  const readKey = async () => {
    const stored = Buffer.from((await readFile(file, "utf8")).trim(), "hex");
    if (stored.length !== 32) throw new Error(`Invalid cookie key in ${file}`);
    return stored;
  };
  try {
    return await readKey();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    // "wx": if another process won the race, use its key instead.
    await writeFile(file, key.toString("hex"), { mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readKey();
  }
}

/** Parses a Cookie header; the first value wins for a repeated name. */
export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
