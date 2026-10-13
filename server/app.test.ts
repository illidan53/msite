import request from "supertest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("createApp", () => {
  it("returns a health response without exposing secrets", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "stock-workbench-api",
    });
    expect(JSON.stringify(response.body)).not.toContain("POLYGON_API_KEY");
  });

  it("offers no sign-in without provider credentials and hardens production responses", async () => {
    const app = createApp({ nodeEnv: "production", staticDir: await mkdtemp(join(tmpdir(), "msite-static-")) });
    const session = await request(app).get("/api/auth/session").expect(200);

    expect(session.body).toEqual({ user: null, providers: [] });
    expect(session.headers["x-powered-by"]).toBeUndefined();
    expect(session.headers["strict-transport-security"]).toBe("max-age=31536000");
    await request(app).get("/api/auth/login/google").expect(404);
    // Edits need an account, whatever the client IP.
    const edit = await request(app).post("/api/watchlists/semiconductors/symbols").send({});
    expect(edit.status).toBe(401);
    expect(edit.body.code).toBe("AUTH_REQUIRED");
  });

  it("serves the production frontend shell and static assets", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "msite-static-"));
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Stock Workbench</title><div id=\"root\"></div>");
    await writeFile(join(staticDir, "asset.txt"), "asset body");

    const app = createApp({ nodeEnv: "production", staticDir });

    const shellResponse = await request(app).get("/");
    expect(shellResponse.status).toBe(200);
    expect(shellResponse.text).toContain("Stock Workbench");

    const assetResponse = await request(app).get("/asset.txt");
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.text).toBe("asset body");
  });

  it("does not mount dynamic watchlist recommendation routes", async () => {
    const response = await request(createApp()).post("/api/watchlists/recommendations").send({
      excludedSymbols: [],
      limit: 5,
      pinnedSymbols: ["NVDA"],
      theme: "semiconductors",
    });

    expect(response.status).toBe(404);
  });
});
