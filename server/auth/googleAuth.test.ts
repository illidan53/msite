import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { TokenPayload } from "google-auth-library";
import { createGoogleAuth } from "./googleAuth";
import { researchAccess } from "../research/access";
import { apiErrorHandler } from "../http/apiError";

const owner = "owner@gmail.com";
function fixture(configured = true, secure = false) {
  let now = Date.now();
  const verify = vi.fn<(token: string) => Promise<TokenPayload>>();
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createGoogleAuth({
      clientId: configured ? "test.apps.googleusercontent.com" : undefined,
      ownerEmail: owner,
      secure,
      verify,
      now: () => now,
    }),
  );
  const access = researchAccess({
    allowedIps: ["127.0.0.1", "::1"],
    trustedProxyIps: [],
  });
  app.get("/api/access", (req, res) => res.json(access(req)));
  app.post("/api/write", (req, res) =>
    res.sendStatus(access(req).canRun ? 200 : 403),
  );
  app.use(apiErrorHandler);
  const agent = request.agent(app);
  const login = async (email = owner, extra = {}) => {
    const challenge = await agent.get("/api/auth/session").expect(200);
    verify.mockResolvedValue({
      sub: "google-user",
      email,
      email_verified: true,
      nonce: challenge.body.nonce,
      ...extra,
    } as unknown as TokenPayload);
    return agent.post("/api/auth/google").send({ credential: "valid-token" });
  };
  return {
    app,
    agent,
    verify,
    login,
    advance: () => {
      now += 9 * 60 * 60_000;
    },
  };
}
describe("Google owner authentication", () => {
  it("grants the verified owner access and revokes it on logout", async () => {
    const f = fixture();
    expect((await f.agent.get("/api/access")).body.canRun).toBe(false); // IP cannot bypass Google.
    const result = await f.login();
    expect(result.status).toBe(200);
    expect(result.body.user.owner).toBe(true);
    const cookie = result.headers["set-cookie"][0];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect((await f.agent.get("/api/access")).body.canRun).toBe(true);
    await f.agent.post("/api/write").send({}).expect(200);
    await f.agent.post("/api/auth/logout").send({}).expect(200);
    expect((await f.agent.get("/api/access")).body.canRun).toBe(false);
    expect(
      (
        await request(f.app)
          .get("/api/access")
          .set("Cookie", cookie.split(";")[0])
      ).body.canRun,
    ).toBe(false);
  });
  it("other Google accounts are visitors, even from an allowed IP", async () => {
    const f = fixture();
    expect((await f.login("visitor@gmail.com")).body.user.owner).toBe(false);
    await f.agent.post("/api/write").send({}).expect(403);
  });
  it("rejects unverified email and nonce mismatch", async () => {
    for (const extra of [{ email_verified: false }, { nonce: "wrong" }]) {
      const f = fixture();
      expect((await f.login(owner, extra)).status).toBe(401);
      expect((await f.agent.get("/api/access")).body.canRun).toBe(false);
    }
  });
  it("rejects invalid signatures/audiences and cannot replay a consumed challenge", async () => {
    const f = fixture();
    await f.agent.get("/api/auth/session");
    f.verify.mockRejectedValue(new Error("invalid token"));
    await f.agent
      .post("/api/auth/google")
      .send({ credential: "bad" })
      .expect(401);
    await f.agent
      .post("/api/auth/google")
      .send({ credential: "bad" })
      .expect(401);
    expect(f.verify).toHaveBeenCalledTimes(1);
  });
  it("rejects forged cookies, expired sessions and cross-origin writes", async () => {
    const f = fixture();
    expect(
      (
        await request(f.app)
          .get("/api/access")
          .set("Cookie", "msite_session=fake")
      ).body.canRun,
    ).toBe(false);
    await f.login();
    await f.agent
      .post("/api/write")
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
    await f.agent
      .post("/api/write")
      .set("Sec-Fetch-Site", "same-site")
      .send({})
      .expect(403);
    await f.agent
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
    f.advance();
    expect((await f.agent.get("/api/access")).body.canRun).toBe(false);
  });
  it("rejects cross-origin and form logins before token verification", async () => {
    const f = fixture();
    await f.agent.get("/api/auth/session");
    await f.agent
      .post("/api/auth/google")
      .set("Origin", "https://evil.example")
      .send({ credential: "x" })
      .expect(403);
    await f.agent
      .post("/api/auth/google")
      .type("form")
      .send({ credential: "x" })
      .expect(415);
    expect(f.verify).not.toHaveBeenCalled();
  });
  it("retains legacy IP access only until Google is configured", async () => {
    const f = fixture(false);
    expect((await f.agent.get("/api/auth/session")).body.enabled).toBe(false);
    expect((await f.agent.get("/api/access")).body.canRun).toBe(true);
    await f.agent
      .post("/api/auth/google")
      .send({ credential: "x" })
      .expect(503);
  });
  it("uses host-only secure cookies in production", async () => {
    const f = fixture(true, true);
    const result = await f.agent.get("/api/auth/session");
    expect(result.headers["set-cookie"][0]).toMatch(/^__Host-msite_login=/);
    expect(result.headers["set-cookie"][0]).toContain("Secure");
    expect(result.headers["set-cookie"][0]).not.toContain("Domain=");
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});
