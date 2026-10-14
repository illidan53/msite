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

  it("lets any browser edit its own lists and hardens production responses", async () => {
    const app = createApp({ nodeEnv: "production", staticDir: await mkdtemp(join(tmpdir(), "msite-static-")) });
    const health = await request(app).get("/api/health").expect(200);

    expect(health.headers["x-powered-by"]).toBeUndefined();
    expect(health.headers["strict-transport-security"]).toBe("max-age=31536000");
    // Personal edits still belong to the browser, independently of owner login.
    const session = await request(app).get("/api/auth/session").expect(200);
    expect(session.body.user).toBeNull();
    const edit = await request(app).post("/api/watchlists/semiconductors/symbols").send({});
    expect(edit.status).toBe(400);
    expect(edit.body.code).toBe("INVALID_WATCHLIST_EDIT");
    // A rejected edit gets no browser cookie; a valid one gets a Secure one.
    expect(edit.headers["set-cookie"]).toBeUndefined();
    const reset = await request(app).delete("/api/watchlists/semiconductors/edits").expect(200);
    expect(String(reset.headers["set-cookie"])).toMatch(/^__Host-msite_browser=.+; Secure; SameSite=Lax/);
    // Development over http:// uses a plain cookie.
    const dev = await request(createApp({ nodeEnv: "development" }))
      .delete("/api/watchlists/semiconductors/edits")
      .expect(200);
    expect(String(dev.headers["set-cookie"])).toMatch(/^msite_browser=/);
    expect(String(dev.headers["set-cookie"])).not.toMatch(/Secure/);
  });

  it("lets only the research IP allowlist edit Owner Focus, kept in RESEARCH_DATA_DIR", async () => {
    const saved = { ...process.env };
    process.env.RESEARCH_DATA_DIR = await mkdtemp(join(tmpdir(), "msite-research-"));
    try {
      delete process.env.RESEARCH_ALLOWED_IPS;
      const visitor = createApp();
      const lists = await request(visitor).get("/api/watchlists").expect(200);
      expect(lists.body.watchlists[0]).toMatchObject({
        id: "owner-focus",
        rows: [{ symbols: [] }],
        ownerManaged: { canEdit: false },
      });
      const denied = await request(visitor).post("/api/watchlists/owner-focus/symbols").send({});
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("RESEARCH_IP_FORBIDDEN");

      process.env.RESEARCH_ALLOWED_IPS = "127.0.0.1";
      const owner = createApp();
      const mine = await request(owner).get("/api/config").expect(200);
      expect(mine.body.watchlists.watchlists[0].ownerManaged).toEqual({ canEdit: true });
      // Past the owner gate, an invalid edit is refused before any lookup.
      const invalid = await request(owner).post("/api/watchlists/owner-focus/symbols").send({});
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe("INVALID_WATCHLIST_EDIT");
    } finally {
      process.env = saved;
    }
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
