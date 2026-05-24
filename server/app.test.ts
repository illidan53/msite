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
