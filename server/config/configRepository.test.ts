import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { createApp } from "../app";
import { ConfigRepository } from "./configRepository";

const watchlistsYaml = `watchlists:
  - id: semiconductors
    name: Semiconductors
    pinnedSymbols:
      - nvda
    rows:
      - id: leaders
        name: Leaders
        symbols:
          - amd
`;

const settingsYaml = `polygon:
  plan: free
  warningThreshold: 0.5
  hardThreshold: 0.9
`;

async function writeConfigFiles(configDir: string, watchlists = watchlistsYaml) {
  await writeFile(join(configDir, "watchlists.yaml"), watchlists, "utf8");
  await writeFile(join(configDir, "settings.yaml"), settingsYaml, "utf8");
}

describe("ConfigRepository", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "stock-config-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("reads watchlists and settings YAML from the configured directory", async () => {
    await writeConfigFiles(configDir);
    const repository = new ConfigRepository({ configDir });

    const config = await repository.readConfig();

    expect(config).toEqual({
      watchlists: {
        watchlists: [
          {
            id: "semiconductors",
            name: "Semiconductors",
            pinnedSymbols: ["NVDA"],
            rows: [
              {
                id: "leaders",
                name: "Leaders",
                expandedByDefault: true,
                symbols: ["AMD"],
              },
            ],
          },
        ],
      },
      settings: {
        polygon: {
          plan: "free",
          paidPlanName: "stocks-starter",
          warningThreshold: 0.5,
          hardThreshold: 0.9,
        },
      },
    });
  });

  it("writes validated watchlists through a temp file, renames them, and backs up the previous YAML", async () => {
    await writeConfigFiles(configDir);
    const repository = new ConfigRepository({ configDir });

    const saved = await repository.writeWatchlists({
      watchlists: [
        {
          id: "cloud",
          name: "Cloud",
          pinnedSymbols: ["msft"],
          rows: [
            {
              id: "leaders",
              name: "Leaders",
              symbols: ["amzn", "googl"],
            },
          ],
        },
      ],
    });

    expect(saved.watchlists[0]?.pinnedSymbols).toEqual(["MSFT"]);
    expect(saved.watchlists[0]?.rows[0]?.symbols).toEqual(["AMZN", "GOOGL"]);

    const backup = await readFile(join(configDir, "watchlists.yaml.bak"), "utf8");
    expect(backup).toBe(watchlistsYaml);

    const written = YAML.parse(await readFile(join(configDir, "watchlists.yaml"), "utf8"));
    expect(written.watchlists[0].pinnedSymbols).toEqual(["MSFT"]);
    expect(written.watchlists[0].rows[0].symbols).toEqual(["AMZN", "GOOGL"]);

    const files = await readdir(configDir);
    expect(files.some((file) => file.includes(".tmp"))).toBe(false);
  });

  it("rejects invalid watchlist input before writing", async () => {
    await writeConfigFiles(configDir);
    const repository = new ConfigRepository({ configDir });

    await expect(repository.writeWatchlists({ watchlists: [] })).rejects.toThrow(/watchlists/i);
  });
});

describe("config routes", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "stock-routes-"));
    await writeConfigFiles(configDir);
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("serves the combined config and watchlists config", async () => {
    const app = createApp({ configDir });

    const configResponse = await request(app).get("/api/config");
    const watchlistsResponse = await request(app).get("/api/watchlists");

    expect(configResponse.status).toBe(200);
    expect(configResponse.body.settings.polygon.plan).toBe("free");
    expect(configResponse.body.watchlists.watchlists[0].pinnedSymbols).toEqual(["NVDA"]);
    expect(watchlistsResponse.status).toBe(200);
    expect(watchlistsResponse.body.watchlists[0].rows[0].symbols).toEqual(["AMD"]);
  });

  it("allows development watchlist writes without an admin token", async () => {
    const app = createApp({ configDir, nodeEnv: "development" });

    const response = await request(app)
      .put("/api/config/watchlists")
      .send({
        watchlists: [
          {
            id: "ai",
            name: "AI",
            rows: [{ id: "leaders", name: "Leaders", symbols: ["nvda"] }],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.watchlists[0].rows[0].symbols).toEqual(["NVDA"]);
  });

  it("requires the configured admin token for production watchlist writes", async () => {
    const app = createApp({
      configDir,
      nodeEnv: "production",
      adminToken: "correct-token",
    });
    const payload = {
      watchlists: [
        {
          id: "ai",
          name: "AI",
          rows: [{ id: "leaders", name: "Leaders", symbols: ["nvda"] }],
        },
      ],
    };

    const missingTokenResponse = await request(app).put("/api/config/watchlists").send(payload);
    const wrongTokenResponse = await request(app)
      .put("/api/config/watchlists")
      .set("x-admin-token", "wrong-token")
      .send(payload);
    const correctTokenResponse = await request(app)
      .put("/api/config/watchlists")
      .set("x-admin-token", "correct-token")
      .send(payload);

    expect(missingTokenResponse.status).toBe(401);
    expect(missingTokenResponse.body).toMatchObject({
      code: "UNAUTHORIZED",
      source: "config",
    });
    expect(wrongTokenResponse.status).toBe(401);
    expect(wrongTokenResponse.body).toMatchObject({
      code: "UNAUTHORIZED",
      source: "config",
    });
    expect(correctTokenResponse.status).toBe(200);
    expect(correctTokenResponse.body.watchlists[0].rows[0].symbols).toEqual(["NVDA"]);
  });

  it("fails closed when production admin token is not configured", async () => {
    const app = createApp({ configDir, nodeEnv: "production" });

    const response = await request(app)
      .put("/api/config/watchlists")
      .set("x-admin-token", "anything")
      .send({
        watchlists: [
          {
            id: "ai",
            name: "AI",
            rows: [{ id: "leaders", name: "Leaders", symbols: ["nvda"] }],
          },
        ],
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: "ADMIN_TOKEN_MISSING",
      source: "config",
    });
  });

  it("reports Zod validation errors as config validation errors", async () => {
    const app = createApp({ configDir, nodeEnv: "development" });

    const response = await request(app).put("/api/config/watchlists").send({
      watchlists: [],
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "VALIDATION_ERROR",
      source: "config",
    });
  });
});
