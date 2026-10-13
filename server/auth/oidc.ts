import { createHash } from "node:crypto";
import { join } from "node:path";
import { Router, type Request, type Response } from "express";
import * as client from "openid-client";
import type { AuthProvider, AuthSession } from "../../shared/types";
import { assertSameSiteWrite } from "../http/ownerWrite";
import { CookieSealer, loadCookieKey, readCookie } from "./sealedCookie";
import { SESSION_TTL_MS, SessionStore, type SessionAccount } from "./sessionStore";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthOptions {
  /** Public origin, e.g. https://finance.nphunter.net; never derived from the request. */
  baseUrl: string;
  dataDir: string;
  google?: ProviderCredentials;
  microsoft?: ProviderCredentials;
  /** Tests inject a fake fetch for discovery and the token endpoint. */
  fetch?: client.CustomFetch;
  /** Tests inject the cookie key; production loads or creates it in dataDir. */
  cookieKey?: Promise<Buffer>;
  /** Deletes the account's stored data for "Delete my data". */
  deleteAccountData?: (account: SessionAccount) => Promise<void>;
}

/**
 * Discovery inputs. Microsoft must be the bare issuer-style /common URL: only
 * real discovery from it lets openid-client match the ID token `iss` against
 * the `{tenantid}` template using the token's `tid`.
 */
const ISSUER_URLS: Record<AuthProvider, string> = {
  google: "https://accounts.google.com",
  microsoft: "https://login.microsoftonline.com/common/v2.0",
};
const LOGIN_TTL_SECONDS = 600;
const MAX_RETURN_TO = 512;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICROSOFT_ISS =
  /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/i;

interface LoginTransaction {
  provider: AuthProvider;
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

/**
 * A same-origin path to return to after sign-in, in normalised form; anything
 * else returns to the home page. Normalising first matters: "/.//evil.com"
 * and "/%2e//evil.com" become "//evil.com", a protocol-relative URL.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_RETURN_TO) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // Control characters and backslashes can be read as other origins.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  const probe = "https://return-to.invalid";
  let url: URL;
  try {
    url = new URL(value, probe);
  } catch {
    return "/";
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  // The limit applies to what is stored and re-checked: percent-encoding can
  // make the normalised path several times longer than the input.
  if (url.origin !== probe || !path.startsWith("/") || path.startsWith("//"))
    return "/";
  if (path.length > MAX_RETURN_TO) return "/";
  // Never land back on an API URL (for example a sign-in endpoint).
  if (/^\/api(\/|$)/i.test(url.pathname)) return "/";
  return path;
}

/** A stable, path-safe account id from the provider's immutable user key. */
export function accountId(key: string) {
  return createHash("sha256").update(key).digest("base64url").slice(0, 32);
}

const text = (value: unknown, max = 320) =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : undefined;

/**
 * The account for validated ID token claims. Google users are keyed by
 * `sub`; Microsoft users by tenant + object id, as Microsoft requires for
 * multi-tenant apps. Email and name are display-only: matching emails never
 * link a Google and a Microsoft account (nOAuth-style takeover).
 */
export function accountFromClaims(
  provider: AuthProvider,
  claims: client.IDToken,
): SessionAccount {
  const email = text(claims.email);
  const name = text(claims.name, 200);
  if (provider === "google") {
    if (claims.iss !== ISSUER_URLS.google) throw new Error("Unexpected Google issuer");
    const sub = text(claims.sub, 255);
    if (!sub) throw new Error("Google ID token has no subject");
    return { id: accountId(`google:${sub}`), provider, email, name };
  }
  const tid = claims.tid;
  const oid = claims.oid;
  // openid-client already compared iss with the tid-substituted template;
  // also insist on a GUID tenant and the exact v2.0 issuer shape.
  if (typeof tid !== "string" || !GUID.test(tid))
    throw new Error("Microsoft ID token has no valid tenant");
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`)
    throw new Error("Unexpected Microsoft issuer");
  if (typeof oid !== "string" || !GUID.test(oid))
    throw new Error("Microsoft ID token has no object id");
  const username = text(claims.preferred_username);
  return {
    id: accountId(`microsoft:${tid.toLowerCase()}:${oid.toLowerCase()}`),
    provider,
    email: email ?? (username?.includes("@") ? username : undefined),
    name,
  };
}

export function createAuth(options: AuthOptions) {
  const base = new URL(options.baseUrl);
  const origin = base.origin;
  const secure = base.protocol === "https:";
  // __Host- cookies are host-only, Secure and Path=/, so no sibling
  // subdomain can set or overwrite them. Plain names for http:// dev.
  const sessionCookie = secure ? "__Host-msite_session" : "msite_session";
  const loginCookie = secure ? "__Host-msite_login" : "msite_login";
  const credentials: Partial<Record<AuthProvider, ProviderCredentials>> = {
    ...(options.google ? { google: options.google } : {}),
    ...(options.microsoft ? { microsoft: options.microsoft } : {}),
  };
  const providers = (Object.keys(ISSUER_URLS) as AuthProvider[]).filter(
    (provider) => credentials[provider],
  );
  const sessions = new SessionStore(join(options.dataDir, "auth", "sessions.json"));
  let sealer: Promise<CookieSealer> | null = null;
  const getSealer = () => {
    sealer ??= (options.cookieKey ?? loadCookieKey(options.dataDir)).then(
      (key) => new CookieSealer(key),
    );
    return sealer;
  };
  const configs = new Map<AuthProvider, Promise<client.Configuration>>();
  /** Discovered lazily and memoised; a failure is retried on the next sign-in. */
  const configFor = (provider: AuthProvider) => {
    let config = configs.get(provider);
    if (!config) {
      const { clientId, clientSecret } = credentials[provider]!;
      config = client.discovery(
        new URL(ISSUER_URLS[provider]),
        clientId,
        clientSecret,
        undefined,
        {
          timeout: 10,
          ...(options.fetch ? { [client.customFetch]: options.fetch } : {}),
        },
      );
      config.catch(() => configs.delete(provider));
      configs.set(provider, config);
    }
    return config;
  };
  const redirectUri = (provider: AuthProvider) =>
    new URL(`/api/auth/callback/${provider}`, origin).href;
  const cookieOptions = (maxAge: number) => ({
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  });
  const clearCookie = (response: Response, name: string) =>
    response.clearCookie(name, { httpOnly: true, secure, sameSite: "lax", path: "/" });
  const sessionToken = (request: Request) =>
    readCookie(request.headers.cookie, sessionCookie);

  /** The signed-in account for a request, or null. */
  const accountFor = (request: Request) => sessions.get(sessionToken(request));

  /** `returnTo` with ?login=<status> so the page can explain what happened. */
  /** The safe `returnTo` with ?login=<status>, re-checked after editing. */
  const back = (returnTo: string, status: "failed" | "cancelled" | "unavailable") => {
    const target = new URL(safeReturnTo(returnTo), origin);
    target.searchParams.set("login", status);
    const path = safeReturnTo(`${target.pathname}${target.search}${target.hash}`);
    // Too long with the status added: keep the status, drop the page.
    return path === "/" ? `/?login=${status}` : path;
  };

  const router = Router();
  router.use("/auth", (_request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    next();
  });

  router.get("/auth/session", async (request, response) => {
    const account = await accountFor(request);
    const session: AuthSession = {
      user: account
        ? {
            provider: account.provider,
            ...(account.email ? { email: account.email } : {}),
            ...(account.name ? { name: account.name } : {}),
          }
        : null,
      providers,
    };
    response.set("Vary", "Cookie").json(session);
  });

  router.get("/auth/login/:provider", async (request, response) => {
    const provider = request.params.provider as AuthProvider;
    const returnTo = safeReturnTo(request.query.returnTo);
    if (!providers.includes(provider)) {
      response.status(404).json({
        code: "AUTH_PROVIDER_UNAVAILABLE",
        message: "This sign-in option is not available",
        source: "auth",
      });
      return;
    }
    let config: client.Configuration;
    try {
      config = await configFor(provider);
    } catch (error) {
      console.warn("Sign-in discovery failed", provider, (error as Error).name);
      response.redirect(303, back(returnTo, "unavailable"));
      return;
    }
    const verifier = client.randomPKCECodeVerifier();
    const transaction: LoginTransaction = {
      provider,
      state: client.randomState(),
      nonce: client.randomNonce(),
      verifier,
      returnTo,
    };
    const sealed = (await getSealer()).seal("login", transaction, LOGIN_TTL_SECONDS);
    response.cookie(loginCookie, sealed, cookieOptions(LOGIN_TTL_SECONDS * 1000));
    // PKCE is always sent: Microsoft's metadata does not advertise it, so
    // config.serverMetadata().supportsPKCE() would wrongly skip it there.
    const target = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(provider),
      scope: "openid email profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state: transaction.state,
      nonce: transaction.nonce,
      prompt: "select_account",
    });
    response.redirect(302, target.href);
  });

  router.get("/auth/callback/:provider", async (request, response) => {
    const provider = request.params.provider as AuthProvider;
    // The URL carries the one-time code and state: never send it onward.
    response.set("Referrer-Policy", "no-referrer");
    const sealer = await getSealer();
    const transaction = sealer.open<LoginTransaction>(
      "login",
      readCookie(request.headers.cookie, loginCookie),
    );
    // Single use: the transaction cookie never outlives one callback.
    clearCookie(response, loginCookie);
    const returnTo = safeReturnTo(transaction?.returnTo);
    // Binding the transaction to this provider's own redirect URI is the
    // mix-up defence for Microsoft, which sends no RFC 9207 `iss`.
    if (!transaction || transaction.provider !== provider || !providers.includes(provider)) {
      response.redirect(303, back(returnTo, "failed"));
      return;
    }
    try {
      const config = await configFor(provider);
      // Behind Caddy the app sees http://; the token request's redirect_uri
      // is derived from this URL, so it must use the public origin.
      const currentUrl = new URL(request.originalUrl, origin);
      // Entra does not send RFC 9207 `iss` today. If it starts, the library
      // would compare it with the literal {tenantid} template and reject
      // every sign-in; the ID token's issuer is still checked exactly.
      if (
        provider === "microsoft" &&
        MICROSOFT_ISS.test(currentUrl.searchParams.get("iss") ?? "")
      )
        currentUrl.searchParams.delete("iss");
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("No ID token");
      const account = accountFromClaims(provider, claims);
      // A fresh token on every sign-in; any earlier session is ended.
      await sessions.destroy(sessionToken(request));
      const token = await sessions.create(account);
      response.cookie(sessionCookie, token, cookieOptions(SESSION_TTL_MS));
      response.redirect(303, returnTo);
    } catch (error) {
      const cancelled =
        error instanceof client.AuthorizationResponseError &&
        error.error === "access_denied";
      // Never log codes, tokens or the callback URL. The OAuth error and
      // Microsoft's AADSTS number (e.g. 7000222, an expired client secret)
      // are what an operator needs.
      const oauthError =
        error instanceof client.ResponseBodyError ||
        error instanceof client.AuthorizationResponseError
          ? error.error
          : "";
      const aadsts =
        error instanceof client.ResponseBodyError ||
        error instanceof client.AuthorizationResponseError
          ? (/AADSTS\d+/.exec(error.error_description ?? "")?.[0] ?? "")
          : "";
      console.warn(
        "Sign-in failed",
        provider,
        (error as Error).name,
        (error as { code?: string }).code ?? "",
        oauthError,
        aadsts,
      );
      response.redirect(303, back(returnTo, cancelled ? "cancelled" : "failed"));
    }
  });

  router.post("/auth/logout", async (request, response) => {
    assertSameSiteWrite(request, { source: "auth" });
    await sessions.destroy(sessionToken(request));
    clearCookie(response, sessionCookie);
    response.json({ ok: true });
  });

  router.delete("/auth/account", async (request, response) => {
    assertSameSiteWrite(request, { source: "auth", requireJson: false });
    const account = await accountFor(request);
    if (!account) {
      response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Sign in first",
        source: "auth",
      });
      return;
    }
    // Sessions first, so no new edit can start while the data is removed.
    // They leave memory even if the session file cannot be written (e.g. a
    // full disk), and the data is deleted regardless; the store writes the
    // file again on its next change.
    try {
      await sessions.destroyAccount(account.id);
    } catch (error) {
      console.warn("Session file not saved after account deletion", (error as Error).name);
    }
    await options.deleteAccountData?.(account);
    clearCookie(response, sessionCookie);
    response.json({ ok: true });
  });

  return { router, accountFor, providers };
}
