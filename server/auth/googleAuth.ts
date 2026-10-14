import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { readCookie } from "../browser/browserId";
import { ApiError } from "../http/apiError";
import { assertSameSiteWrite } from "../http/ownerWrite";

// Only server middleware can attach an identity; never trust a request header.
export const googleOwnerAccess = new WeakMap<object, boolean>();
const SESSION_MS = 8 * 60 * 60_000;
const NONCE_MS = 5 * 60_000;
const MAX_ENTRIES = 1000;
interface Session {
  email: string;
  owner: boolean;
  expires: number;
}

export function createGoogleAuth(options: {
  clientId?: string;
  ownerEmail?: string;
  secure: boolean;
  verify?: (credential: string) => Promise<TokenPayload | undefined>;
  now?: () => number;
}) {
  const router = Router();
  const clientId = options.clientId?.trim();
  const ownerEmail = options.ownerEmail?.trim().toLowerCase();
  if (clientId && !ownerEmail)
    throw new Error("GOOGLE_OWNER_EMAIL is required with GOOGLE_CLIENT_ID");
  const enabled = Boolean(clientId && ownerEmail);
  const now = options.now ?? Date.now;
  const client = new OAuth2Client(clientId);
  const verify =
    options.verify ??
    (async (credential: string) =>
      (
        await client.verifyIdToken({ idToken: credential, audience: clientId })
      ).getPayload());
  const prefix = options.secure ? "__Host-" : "";
  const sessionName = `${prefix}msite_session`;
  const nonceName = `${prefix}msite_login`;
  const cookieOptions = {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax" as const,
    path: "/",
  };
  const sessions = new Map<string, Session>();
  const nonces = new Map<string, number>();
  const prune = () => {
    for (const [id, s] of sessions) if (s.expires <= now()) sessions.delete(id);
    for (const [id, expires] of nonces) if (expires <= now()) nonces.delete(id);
  };
  const read = (req: Request) => {
    const id = readCookie(req.headers.cookie, sessionName);
    const session = id ? sessions.get(id) : undefined;
    return session && session.expires > now() ? session : null;
  };
  router.use((req, res, next) => {
    prune();
    if (enabled) {
      const session = read(req);
      googleOwnerAccess.set(req, session?.owner ?? false);
      // Apply CSRF protection to all cookie-authorized writes, including research.
      if (session?.owner && !["GET", "HEAD", "OPTIONS"].includes(req.method))
        assertSameSiteWrite(req, {
          source: "auth",
          requireJson: req.method !== "DELETE",
        });
    }
    if (req.path.startsWith("/auth/")) res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/auth/session", (req, res) => {
    const session = read(req);
    let nonce: string | null = null;
    if (enabled && !session) {
      const existing = readCookie(req.headers.cookie, nonceName);
      if (existing && nonces.has(existing)) nonce = existing;
      else {
        if (nonces.size >= MAX_ENTRIES)
          throw new ApiError(429, "AUTH_BUSY", "Please try signing in later");
        nonce = randomBytes(32).toString("base64url");
        nonces.set(nonce, now() + NONCE_MS);
        res.cookie(nonceName, nonce, { ...cookieOptions, maxAge: NONCE_MS });
      }
    }
    res.json({
      enabled,
      clientId: enabled ? clientId : null,
      nonce,
      user: session ? { email: session.email, owner: session.owner } : null,
    });
  });
  router.post("/auth/google", async (req, res) => {
    assertSameSiteWrite(req, { source: "auth" });
    if (!enabled)
      throw new ApiError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Google sign-in is not configured",
      );
    const nonce = readCookie(req.headers.cookie, nonceName);
    if (!nonce || !nonces.has(nonce))
      throw new ApiError(
        401,
        "LOGIN_EXPIRED",
        "Reload the page to sign in again",
      );
    nonces.delete(nonce); // A login challenge can be used only once.
    res.clearCookie(nonceName, cookieOptions);
    const credential: unknown = req.body?.credential;
    if (typeof credential !== "string" || credential.length > 16_384)
      throw new ApiError(
        400,
        "INVALID_CREDENTIAL",
        "Invalid Google credential",
      );
    let payload: TokenPayload | undefined;
    try {
      payload = await verify(credential);
    } catch {
      throw new ApiError(
        401,
        "INVALID_CREDENTIAL",
        "Google sign-in could not be verified",
      );
    }
    if (
      !payload?.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      (payload as TokenPayload & { nonce?: string }).nonce !== nonce
    )
      throw new ApiError(
        401,
        "INVALID_CREDENTIAL",
        "Google sign-in could not be verified",
      );
    if (sessions.size >= MAX_ENTRIES)
      throw new ApiError(429, "AUTH_BUSY", "Please try signing in later");
    const old = readCookie(req.headers.cookie, sessionName);
    if (old) sessions.delete(old);
    const id = randomBytes(32).toString("base64url");
    const session = {
      email: payload.email,
      owner: payload.email.toLowerCase() === ownerEmail,
      expires: now() + SESSION_MS,
    };
    sessions.set(id, session);
    res.cookie(sessionName, id, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ user: { email: session.email, owner: session.owner } });
  });
  router.post("/auth/logout", (req, res) => {
    assertSameSiteWrite(req, { source: "auth" });
    const id = readCookie(req.headers.cookie, sessionName);
    if (id) sessions.delete(id);
    res.clearCookie(sessionName, cookieOptions);
    res.json({ ok: true });
  });
  return router;
}
