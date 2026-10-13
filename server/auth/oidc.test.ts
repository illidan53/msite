import express from "express";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorHandler } from "../http/apiError";
import { accountId, createAuth, safeReturnTo } from "./oidc";

const BASE = "https://finance.example";
const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const WORK_TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const OID = "00000000-0000-0000-66f3-3332eca7ea81";

const GOOGLE = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["plain", "S256"],
  authorization_response_iss_parameter_supported: true,
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
};
// Microsoft's real /common metadata: templated issuer, no PKCE methods listed.
const MICROSOFT = {
  issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
  authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
  response_types_supported: ["code", "id_token", "code id_token", "id_token token"],
  subject_types_supported: ["pairwise"],
  id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "private_key_jwt", "client_secret_basic"],
};

let privateKey: CryptoKey;
beforeAll(async () => {
  ({ privateKey } = await generateKeyPair("RS256"));
});

type Provider = "google" | "microsoft";

describe("sign-in with Google and Microsoft", () => {
  let dataDir: string;
  /** Claims the fake token endpoint puts in the next ID token. */
  let nextClaims: (provider: Provider, nonce: string) => JWTPayload;
  let discoveryDown = false;
  const tokenRequests: URLSearchParams[] = [];
  let nonces: Record<string, string> = {};

  const fakeFetch = vi.fn(async (url: string, options: { method?: string; body?: unknown }) => {
    const target = new URL(url);
    if (target.pathname.endsWith("/.well-known/openid-configuration")) {
      if (discoveryDown) return new Response("down", { status: 503 });
      if (url === "https://accounts.google.com/.well-known/openid-configuration")
        return Response.json(GOOGLE);
      if (url === "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration")
        return Response.json(MICROSOFT);
    }
    if (url === GOOGLE.token_endpoint || url === MICROSOFT.token_endpoint) {
      const provider: Provider = url === GOOGLE.token_endpoint ? "google" : "microsoft";
      const body = new URLSearchParams(String(options.body));
      tokenRequests.push(body);
      const nonce = nonces[body.get("code") ?? ""] ?? "";
      const claims = nextClaims(provider, nonce);
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .sign(privateKey);
      return Response.json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken });
    }
    return new Response("unexpected", { status: 500 });
  });

  const googleClaims = (_: Provider, nonce: string): JWTPayload => ({
    iss: GOOGLE.issuer,
    aud: "google-client",
    azp: "google-client",
    sub: "110169484474386276334",
    email: "alice@gmail.com",
    email_verified: true,
    name: "Alice",
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const microsoftClaims =
    (tid = MSA_TENANT, overrides: JWTPayload = {}) =>
    (_: Provider, nonce: string): JWTPayload => ({
      ver: "2.0",
      iss: `https://login.microsoftonline.com/${tid}/v2.0`,
      aud: "ms-client",
      tid,
      oid: OID,
      sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
      preferred_username: "bob@outlook.com",
      email: "bob@outlook.com",
      name: "Bob",
      nonce,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    });

  const deleteAccountData = vi.fn(async () => undefined);
  const makeApp = () => {
    const auth = createAuth({
      baseUrl: BASE,
      dataDir,
      google: { clientId: "google-client", clientSecret: "google-secret" },
      microsoft: { clientId: "ms-client", clientSecret: "ms-secret" },
      fetch: fakeFetch as never,
      cookieKey: Promise.resolve(Buffer.alloc(32, 7)),
      deleteAccountData,
    });
    const app = express();
    app.use(express.json());
    app.use("/api", auth.router);
    app.use(apiErrorHandler);
    return { app, auth };
  };

  const cookiesFrom = (response: request.Response) =>
    ([] as string[]).concat(response.headers["set-cookie"] ?? []);
  const cookieValue = (response: request.Response, name: string) =>
    cookiesFrom(response)
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split(";")[0]
      .slice(name.length + 1);

  /** Starts sign-in and returns what the provider would redirect back with. */
  const start = async (app: express.Express, provider: Provider, returnTo = "/watch") => {
    const response = await request(app)
      .get(`/api/auth/login/${provider}`)
      .query({ returnTo })
      .expect(302);
    const target = new URL(response.headers.location);
    const code = `code-${Object.keys(nonces).length}`;
    nonces[code] = target.searchParams.get("nonce") ?? "";
    return {
      target,
      code,
      state: target.searchParams.get("state")!,
      login: cookieValue(response, "__Host-msite_login")!,
      response,
    };
  };

  const callback = (
    app: express.Express,
    provider: Provider,
    params: Record<string, string>,
    login?: string,
  ) => {
    const call = request(app).get(`/api/auth/callback/${provider}`).query(params);
    return login ? call.set("Cookie", `__Host-msite_login=${login}`) : call;
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "msite-auth-"));
    tokenRequests.length = 0;
    nonces = {};
    discoveryDown = false;
    fakeFetch.mockClear();
    deleteAccountData.mockClear();
    nextClaims = googleClaims;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("signs in with Google using PKCE, state, nonce and the public callback URL", async () => {
    const { app } = makeApp();
    const before = await request(app).get("/api/auth/session").expect(200);
    expect(before.body).toEqual({ user: null, providers: ["google", "microsoft"] });
    expect(before.headers["cache-control"]).toBe("private, no-store");

    const { target, code, state, login, response } = await start(app, "google");
    expect(target.origin + target.pathname).toBe(GOOGLE.authorization_endpoint);
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: "google-client",
      response_type: "code",
      redirect_uri: `${BASE}/api/auth/callback/google`,
      scope: "openid email profile",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(target.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const loginCookie = cookiesFrom(response).find((cookie) => cookie.startsWith("__Host-msite_login="))!;
    expect(loginCookie).toMatch(/HttpOnly/);
    expect(loginCookie).toMatch(/Secure/);
    expect(loginCookie).toMatch(/SameSite=Lax/);
    expect(loginCookie).toMatch(/Path=\//);
    // The sealed transaction reveals nothing readable.
    expect(Buffer.from(login, "base64url").toString("latin1")).not.toContain(state);

    const done = await callback(app, "google", { code, state, iss: GOOGLE.issuer }, login).expect(303);
    expect(done.headers.location).toBe("/watch");
    expect(done.headers["referrer-policy"]).toBe("no-referrer");
    const token = tokenRequests[0];
    expect(token.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
    expect(token.get("code_verifier")).toMatch(/^[\w-]{43,128}$/);
    expect(token.get("client_secret")).toBe("google-secret");
    expect(cookiesFrom(done).some((cookie) => cookie.startsWith("__Host-msite_login=;"))).toBe(true);
    const session = cookieValue(done, "__Host-msite_session")!;
    expect(session).toMatch(/^[\w-]{43}$/);

    const me = await request(app)
      .get("/api/auth/session")
      .set("Cookie", `__Host-msite_session=${session}`)
      .expect(200);
    expect(me.body.user).toEqual({ provider: "google", email: "alice@gmail.com", name: "Alice" });

    // Only a hash of the token is stored.
    const stored = await readFile(join(dataDir, "auth", "sessions.json"), "utf8");
    expect(stored).not.toContain(session);
    expect(stored).toContain(accountId("google:110169484474386276334"));

    // The transaction cookie is single-use.
    const replay = await callback(app, "google", { code, state, iss: GOOGLE.issuer }).expect(303);
    expect(replay.headers.location).toBe("/?login=failed");
  });

  it("signs out by deleting the server session, from same-site JSON only", async () => {
    const { app } = makeApp();
    const { code, state, login } = await start(app, "google");
    const done = await callback(app, "google", { code, state, iss: GOOGLE.issuer }, login);
    const cookie = `__Host-msite_session=${cookieValue(done, "__Host-msite_session")}`;

    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Content-Type", "text/plain")
      .send("{}")
      .expect(415);
    // A sibling *.nphunter.net app is "same-site", not "same-origin".
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Sec-Fetch-Site", "same-site")
      .send({})
      .expect(403);
    expect((await request(app).get("/api/auth/session").set("Cookie", cookie)).body.user).not.toBeNull();

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie).send({}).expect(200);
    expect(cookiesFrom(out).some((value) => value.startsWith("__Host-msite_session=;"))).toBe(true);
    // A copied cookie no longer works after sign-out.
    expect((await request(app).get("/api/auth/session").set("Cookie", cookie)).body.user).toBeNull();
  });

  it("deletes an account's data and ends its sessions on every device", async () => {
    const { app } = makeApp();
    const signIn = async () => {
      const { code, state, login } = await start(app, "google");
      const done = await callback(app, "google", { code, state, iss: GOOGLE.issuer }, login);
      return `__Host-msite_session=${cookieValue(done, "__Host-msite_session")}`;
    };
    const laptop = await signIn();
    const phone = await signIn();

    await request(app).delete("/api/auth/account").expect(401);
    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", laptop)
      .set("Sec-Fetch-Site", "cross-site")
      .expect(403);
    expect(deleteAccountData).not.toHaveBeenCalled();

    await request(app).delete("/api/auth/account").set("Cookie", laptop).expect(200);
    expect(deleteAccountData).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountId("google:110169484474386276334") }),
    );
    for (const cookie of [laptop, phone])
      expect((await request(app).get("/api/auth/session").set("Cookie", cookie)).body.user).toBeNull();
  });

  it("signs in personal and work Microsoft accounts keyed by tenant and object id", async () => {
    const { app, auth } = makeApp();
    nextClaims = microsoftClaims();
    const first = await start(app, "microsoft");
    expect(first.target.origin + first.target.pathname).toBe(MICROSOFT.authorization_endpoint);
    // PKCE even though Microsoft's metadata does not advertise it.
    expect(first.target.searchParams.get("code_challenge_method")).toBe("S256");
    // A future RFC 9207 iss from Entra must not break sign-in.
    const done = await callback(
      app,
      "microsoft",
      { code: first.code, state: first.state, iss: `https://login.microsoftonline.com/${MSA_TENANT}/v2.0` },
      first.login,
    ).expect(303);
    expect(done.headers.location).toBe("/watch");
    const cookie = `__Host-msite_session=${cookieValue(done, "__Host-msite_session")}`;
    const account = await auth.accountFor({ headers: { cookie } } as never);
    expect(account).toEqual({
      id: accountId(`microsoft:${MSA_TENANT}:${OID}`),
      provider: "microsoft",
      email: "bob@outlook.com",
      name: "Bob",
    });

    // A work account in another tenant with the same oid is a different account.
    nextClaims = microsoftClaims(WORK_TENANT, { email: undefined, preferred_username: "bob@contoso.com" });
    const second = await start(app, "microsoft");
    const work = await callback(app, "microsoft", { code: second.code, state: second.state }, second.login).expect(303);
    const workAccount = await auth.accountFor({
      headers: { cookie: `__Host-msite_session=${cookieValue(work, "__Host-msite_session")}` },
    } as never);
    expect(workAccount?.id).toBe(accountId(`microsoft:${WORK_TENANT}:${OID}`));
    expect(workAccount?.email).toBe("bob@contoso.com");
  });

  it("rejects forged, mixed-up and tampered callbacks without creating a session", async () => {
    const { app } = makeApp();
    const failed = async (
      provider: Provider,
      params: Record<string, string>,
      login?: string,
      location = "/watch?login=failed",
    ) => {
      const response = await callback(app, provider, params, login).expect(303);
      expect(response.headers.location).toBe(location);
      expect(cookieValue(response, "__Host-msite_session")).toBeUndefined();
    };

    const google = await start(app, "google");
    await failed("google", { code: google.code, state: "forged", iss: GOOGLE.issuer }, google.login);
    await failed("google", { code: google.code, state: google.state }, google.login); // no RFC 9207 iss
    await failed("microsoft", { code: google.code, state: google.state }, google.login); // mix-up
    await failed("google", { code: google.code, state: google.state, iss: GOOGLE.issuer }, undefined, "/?login=failed");
    // Flip one character mid-token, where every bit counts (the final
    // base64url character carries padding bits a change may not touch).
    const middle = Math.floor(google.login.length / 2);
    const tampered = `${google.login.slice(0, middle)}${google.login[middle] === "A" ? "B" : "A"}${google.login.slice(middle + 1)}`;
    await failed("google", { code: google.code, state: google.state, iss: GOOGLE.issuer }, tampered, "/?login=failed");

    nextClaims = (provider, nonce) => ({ ...googleClaims(provider, nonce), nonce: "replayed" });
    await failed("google", { code: google.code, state: google.state, iss: GOOGLE.issuer }, google.login);
    nextClaims = (provider, nonce) => ({ ...googleClaims(provider, nonce), aud: "someone-else" });
    await failed("google", { code: google.code, state: google.state, iss: GOOGLE.issuer }, google.login);
    nextClaims = (provider, nonce) => ({ ...googleClaims(provider, nonce), exp: Math.floor(Date.now() / 1000) - 3600 });
    await failed("google", { code: google.code, state: google.state, iss: GOOGLE.issuer }, google.login);

    const ms = await start(app, "microsoft");
    // iss for one tenant, tid claim for another.
    nextClaims = microsoftClaims(WORK_TENANT, { iss: `https://login.microsoftonline.com/${MSA_TENANT}/v2.0` });
    await failed("microsoft", { code: ms.code, state: ms.state }, ms.login);
    nextClaims = microsoftClaims(MSA_TENANT, { oid: undefined });
    await failed("microsoft", { code: ms.code, state: ms.state }, ms.login);
    nextClaims = microsoftClaims("not-a-guid", { iss: "https://login.microsoftonline.com/not-a-guid/v2.0" });
    await failed("microsoft", { code: ms.code, state: ms.state }, ms.login);
  });

  it("never redirects off-site after a cancelled sign-in, whatever returnTo was", async () => {
    const { app } = makeApp();
    for (const returnTo of ["/.//evil.example", "/%2e//evil.example", "/x/..//evil.example"]) {
      const { state, login } = await start(app, "google", returnTo);
      const cancelled = await callback(
        app,
        "google",
        { error: "access_denied", state, iss: GOOGLE.issuer },
        login,
      ).expect(303);
      expect(cancelled.headers.location).toBe("/?login=cancelled");
    }
  });

  it("keeps the sign-in status when a long return path no longer fits", async () => {
    const { app } = makeApp();
    const { state, login } = await start(app, "google", `/${"a".repeat(505)}`);
    const cancelled = await callback(
      app,
      "google",
      { error: "access_denied", state, iss: GOOGLE.issuer },
      login,
    ).expect(303);
    expect(cancelled.headers.location).toBe("/?login=cancelled");
  });

  it("deletes the account's data even when the session file cannot be written", async () => {
    const { app } = makeApp();
    const { code, state, login } = await start(app, "google");
    const done = await callback(app, "google", { code, state, iss: GOOGLE.issuer }, login);
    const cookie = `__Host-msite_session=${cookieValue(done, "__Host-msite_session")}`;
    await mkdir(join(dataDir, "auth", "sessions.json.tmp"));

    await request(app).delete("/api/auth/account").set("Cookie", cookie).expect(200);
    expect(deleteAccountData).toHaveBeenCalledTimes(1);
    expect((await request(app).get("/api/auth/session").set("Cookie", cookie)).body.user).toBeNull();
  });

  it("reports a cancelled sign-in and an unreachable provider", async () => {
    const { app } = makeApp();
    const { state, login } = await start(app, "google", "/?tab=1");
    const cancelled = await callback(
      app,
      "google",
      { error: "access_denied", state, iss: GOOGLE.issuer },
      login,
    ).expect(303);
    expect(cancelled.headers.location).toBe("/?tab=1&login=cancelled");
    expect(tokenRequests).toHaveLength(0);

    discoveryDown = true;
    const down = await request(makeApp().app).get("/api/auth/login/microsoft").expect(303);
    expect(down.headers.location).toBe("/?login=unavailable");
    discoveryDown = false;
  });

  it("only offers configured providers and only returns to same-origin paths", async () => {
    const auth = createAuth({
      baseUrl: "http://localhost:5173",
      dataDir,
      google: { clientId: "google-client", clientSecret: "google-secret" },
      fetch: fakeFetch as never,
      cookieKey: Promise.resolve(Buffer.alloc(32, 7)),
    });
    const app = express();
    app.use("/api", auth.router);
    expect((await request(app).get("/api/auth/session")).body.providers).toEqual(["google"]);
    const missing = await request(app).get("/api/auth/login/microsoft").expect(404);
    expect(missing.body.code).toBe("AUTH_PROVIDER_UNAVAILABLE");
    await request(app).get("/api/auth/login/github").expect(404);
    // Plain cookie names over http:// in development.
    const dev = await request(app).get("/api/auth/login/google").expect(302);
    expect(String(dev.headers["set-cookie"])).toMatch(/^msite_login=/);
    expect(String(dev.headers["set-cookie"])).not.toMatch(/Secure/);
    expect(new URL(dev.headers.location).searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/api/auth/callback/google",
    );

    for (const evil of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "evil",
      "/ok\nSet-Cookie:x",
      "/\u0000",
      // Dot segments normalise to the protocol-relative "//evil.example".
      "/.//evil.example",
      "/%2e//evil.example",
      "/%2E%2E//evil.example",
      "/x/..//evil.example",
      "/x/../api/auth/login/google",
    ])
      expect(safeReturnTo(evil)).toBe("/");
    for (const api of ["/api/auth/login/google", "/API/auth/logout", "/api", "/api?x=1"])
      expect(safeReturnTo(api)).toBe("/");
    expect(safeReturnTo("/?a=1#b")).toBe("/?a=1#b");
    // The limit applies after percent-encoding.
    expect(safeReturnTo(`/${"é".repeat(100)}`)).toBe("/");
    expect(safeReturnTo(`/${"é".repeat(50)}`)).toBe(`/${"%C3%A9".repeat(50)}`);
    expect(safeReturnTo("/apis-overview")).toBe("/apis-overview");
    expect(safeReturnTo(["/"])).toBe("/");
  });
});
