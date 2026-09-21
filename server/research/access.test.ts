import { describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import request from "supertest";
import { researchAccess, parseIps } from "./access";
import { createResearchRoutes } from "../routes/researchRoutes";
import { apiErrorHandler } from "../http/apiError";
import type { ResearchService } from "./service";
const allowed = "70.111.76.119";
const proxy = "172.17.0.1";
function peer(ip: string, headers: Request["headers"] = {}) {
  return { socket: { remoteAddress: ip }, headers } as Pick<
    Request,
    "socket" | "headers"
  >;
}
const access = researchAccess({
  allowedIps: [allowed],
  trustedProxyIps: [proxy],
});
describe("research IP authorization", () => {
  it("allows only the exact address, including IPv4-mapped connections", () => {
    expect(access(peer(allowed)).canRun).toBe(true);
    expect(access(peer(`::ffff:${allowed}`)).canRun).toBe(true);
    for (const ip of ["70.111.76.118", "127.0.0.1", "::1", "", "2001:db8::1"])
      expect(access(peer(ip)).canRun).toBe(false);
  });
  it("ignores spoofed forwarding headers from untrusted peers", () => {
    expect(
      access(
        peer("198.51.100.7", {
          "x-forwarded-for": allowed,
          "x-real-ip": allowed,
          forwarded: `for=${allowed}`,
        }),
      ),
    ).toEqual({ canRun: false, clientIp: "198.51.100.7" });
  });
  it("accepts one client IP only through the explicitly trusted proxy", () => {
    expect(
      access(peer(`::ffff:${proxy}`, { "x-forwarded-for": allowed })),
    ).toEqual({ canRun: true, clientIp: allowed });
    for (const forwarded of [
      undefined,
      "",
      `${allowed}, 198.51.100.7`,
      `198.51.100.7, ${allowed}`,
      [allowed, allowed],
      `${allowed}:1234`,
      "unknown",
      "[70.111.76.119]",
    ])
      expect(access(peer(proxy, { "x-forwarded-for": forwarded })).canRun).toBe(
        false,
      );
  });
  it("defaults to deny and rejects invalid configuration", () => {
    expect(
      researchAccess({ allowedIps: [], trustedProxyIps: [] })(peer(allowed))
        .canRun,
    ).toBe(false);
    expect(() => parseIps("0.0.0.0/0")).toThrow();
    expect(() => parseIps("invalid")).toThrow();
    expect(parseIps(undefined)).toEqual([]);
  });
  it("blocks every run module before invoking the service but keeps reading public", async () => {
    const service = {
      start: vi.fn(),
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({ id: "saved" })),
    };
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createResearchRoutes(service as unknown as ResearchService, {
        allowedIps: [allowed],
        trustedProxyIps: [],
      }),
    );
    app.use(apiErrorHandler);
    for (const module of ["all", "quant", "fundamentals", "news", "ai"]) {
      const response = await request(app)
        .post("/api/research")
        .set("X-Forwarded-For", allowed)
        .send({ symbol: "AAPL", module });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("RESEARCH_IP_FORBIDDEN");
    }
    expect(service.start).not.toHaveBeenCalled();
    expect((await request(app).get("/api/research")).status).toBe(200);
    expect((await request(app).get("/api/research/access")).body.canRun).toBe(
      false,
    );
    expect(
      (
        await request(app).get(
          "/api/research/84c70d36-2087-4b5c-b2e9-7ce3c411a188",
        )
      ).status,
    ).toBe(200);
  });
  it("allows the configured client through a trusted proxy and rejects a different client", async () => {
    const service = { start: vi.fn(async () => ({ id: "new" })) };
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createResearchRoutes(service as unknown as ResearchService, {
        allowedIps: [allowed],
        trustedProxyIps: ["127.0.0.1", "::1"],
      }),
    );
    app.use(apiErrorHandler);
    expect(
      (
        await request(app)
          .post("/api/research")
          .set("X-Forwarded-For", allowed)
          .send({ symbol: "AAPL" })
      ).status,
    ).toBe(202);
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(
      (
        await request(app)
          .post("/api/research")
          .set("X-Forwarded-For", "198.51.100.7")
          .send({ symbol: "AAPL" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/research/access")
          .set("X-Forwarded-For", allowed)
      ).body,
    ).toEqual({ canRun: true, clientIp: allowed });
  });
});
