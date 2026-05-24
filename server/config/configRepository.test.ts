import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("loads the default expanded sector watchlists from project config", async () => {
    const repository = new ConfigRepository();

    const watchlists = await repository.readWatchlists();
    const symbols = new Set(watchlists.watchlists.flatMap((watchlist) => watchlist.rows.flatMap((row) => row.symbols)));

    expect(watchlists.watchlists).toHaveLength(11);
    expect(symbols.size).toBeGreaterThan(200);
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

  it("does not expose watchlist writes because watchlists are file-backed", async () => {
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

    expect(response.status).toBe(404);
  });
});
