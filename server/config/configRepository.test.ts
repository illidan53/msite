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
    const closeWatch = watchlists.watchlists.find((watchlist) => watchlist.id === "close-watch");

    expect(watchlists.watchlists).toHaveLength(13);
    expect(watchlists.watchlists.filter((item) => item.navigationGroup === "primary").map((item) => item.id)).toEqual(["semiconductors", "consumer-staples", "mega-cap-tech", "software"]);
    expect(watchlists.watchlists.filter((item) => item.navigationGroup === "other")).toHaveLength(9);
    const semiconductorSymbols = watchlists.watchlists[0].rows.flatMap((row) => row.symbols);
    expect(semiconductorSymbols).toEqual(expect.arrayContaining(["LITE", "NOK", "CRDO", "ALAB"]));
    for (const item of watchlists.watchlists.filter((item) => item.id !== "close-watch")) {
      const members = item.rows.flatMap((row) => row.symbols);
      expect(new Set(members).size).toBe(members.length);
      expect(members).not.toContain("GOOG");
      expect(item.selectionNote).toBeTruthy();
      expect(item.selectionReviewedAt).toBe("2026-09-20");
      expect(item.selectionSources?.some((source) => source.kind === "company")).toBe(true);
      expect(item.selectionSources?.some((source) => source.kind === "discussion" && source.publishedAt)).toBe(true);
      expect(item.pinnedSymbols.every((symbol) => members.includes(symbol))).toBe(true);
    }
    expect(symbols.size).toBeGreaterThan(200);
    for (const obsolete of ["PSTG", "HES", "MRO", "PARA", "IPG", "GOOG"]) expect(symbols.has(obsolete)).toBe(false);
    const cloud = watchlists.watchlists.find((item) => item.id === "ai-cloud-infrastructure")!;
    expect(cloud.rows.find((row) => row.name === "GPU cloud operators")?.symbols).toEqual(["CRWV", "NBIS", "IREN"]);
    expect(cloud.rows.flatMap((row) => row.symbols)).toContain("P");
    expect(cloud.rows.flatMap((row) => row.symbols)).not.toContain("AMT");
    expect(closeWatch).toMatchObject({
      name: "close watch",
      symbolDescriptions: {
        CLS: "AI hardware manufacturing services",
        EQPT: "construction equipment rental tech",
        EXE: "U.S. natural gas production",
        SMR: "small modular nuclear reactors",
        TECK: "copper and zinc mining",
        XYL: "water technology and pumps",
      },
      rows: [
        {
          id: "core",
          name: "Core",
          expandedByDefault: true,
          symbols: ["POWL", "XYL", "CCJ", "FLNC", "FORM", "SMR", "TECK", "EQPT", "EXE", "CLS"],
        },
      ],
    });
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
