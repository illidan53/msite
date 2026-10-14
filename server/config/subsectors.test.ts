import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigRepository } from "./configRepository";
import { createConfigRoutes } from "../routes/configRoutes";
import { researchAccess } from "../research/access";
import { apiErrorHandler } from "../http/apiError";
import { createBrowserIds } from "../browser/browserId";

describe("shared sub-sector management", () => {
  let root: string;
  let repo: ConfigRepository;
  const makeRepo = () =>
    new ConfigRepository({
      configDir: root,
      browserEdits: true,
      subsectorsFile: join(root, "subsectors.json"),
      ownerFocusFile: join(root, "focus.json"),
    });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "msite-subsectors-"));
    await writeFile(
      join(root, "watchlists.yaml"),
      JSON.stringify({
        watchlists: [
          {
            id: "chips",
            name: "Chips",
            rows: [
              { id: "core", name: "Core", symbols: ["NVDA", "AMD", "TSM"] },
            ],
            subsectors: [{ id: "ai", name: "AI", symbols: ["NVDA"] }],
          },
        ],
      }),
    );
    repo = makeRepo();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const server = () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createConfigRoutes({
        repository: repo,
        browserIds: createBrowserIds({ secure: false }),
        ownerAccess: researchAccess({
          allowedIps: ["203.0.113.10"],
          trustedProxyIps: ["127.0.0.1", "::1"],
        }),
      }),
    );
    app.use(apiErrorHandler);
    return app;
  };
  const owner = (app: ReturnType<typeof server>) =>
    request(app)
      .get("/api/watchlists/chips/subsectors")
      .set("X-Forwarded-For", "203.0.113.10");
  const save = (app: ReturnType<typeof server>, body: object) =>
    request(app)
      .put("/api/watchlists/chips/subsectors")
      .set("X-Forwarded-For", "203.0.113.10")
      .send(body);

  it("adds, renames, changes members, and removes classifications for all visitors across restarts", async () => {
    const app = server();
    const initial = (await owner(app).expect(200)).body;
    const subsectors = [
      { id: "ai", name: "AI chips", symbols: ["NVDA", "AMD"] },
      { id: "foundry", name: "Foundry", symbols: ["TSM", "NVDA"] },
      { id: "empty", name: "Empty", symbols: [] },
    ];
    const result = await save(app, {
      revision: initial.revision,
      subsectors,
    }).expect(200);
    expect(
      result.body.watchlists.watchlists.find(
        (l: { id: string }) => l.id === "chips",
      ).subsectorManaged.canEdit,
    ).toBe(true);
    repo = makeRepo(); // New process/store view.
    const visitor = (
      await request(server()).get("/api/watchlists").expect(200)
    ).body.watchlists.find((l: { id: string }) => l.id === "chips");
    expect(visitor.subsectors).toEqual(subsectors);
    expect(visitor.subsectorManaged.canEdit).toBe(false);
    expect(
      (await repo.readBaseWatchlists()).watchlists[0].subsectors?.[0].name,
    ).toBe("AI");
    const second = await repo.readSubsectorEditor("chips");
    await repo.saveSubsectors("chips", second.revision, []);
    const list = (await repo.readWatchlists()).watchlists.find(
      (l) => l.id === "chips",
    )!;
    expect(list.subsectors).toEqual([]);
    expect(list.rows[0].symbols).toEqual(["NVDA", "AMD", "TSM"]);
  });
  it("enforces owner, same-origin, and JSON checks before writing", async () => {
    const app = server();
    await request(app).get("/api/watchlists/chips/subsectors").expect(403);
    await request(app)
      .put("/api/watchlists/chips/subsectors")
      .send({})
      .expect(403);
    await save(app, {}).set("Origin", "https://evil.example").expect(403);
    await request(app)
      .put("/api/watchlists/chips/subsectors")
      .set("X-Forwarded-For", "203.0.113.10")
      .type("form")
      .send("x=1")
      .expect(415);
    await expect(readFile(join(root, "subsectors.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
  it("rejects invalid members, duplicate names and ids without changing the file", async () => {
    const app = server();
    const { revision } = (await owner(app)).body;
    const s = { id: "one", name: "One", symbols: ["NVDA"] };
    for (const subsectors of [
      [{ ...s, symbols: ["FAKE"] }],
      [s, s],
      [s, { ...s, id: "two" }],
      [{ ...s, name: " " }],
      [{ ...s, symbols: ["NVDA", "NVDA"] }],
    ])
      await save(app, { revision, subsectors }).expect(400);
    expect((await owner(app)).body.revision).toBe(revision);
  });
  it("refuses stale concurrent saves without dropping the winning edit", async () => {
    const initial = await repo.readSubsectorEditor("chips");
    const results = await Promise.allSettled([
      repo.saveSubsectors("chips", initial.revision, [
        { id: "first", name: "First", symbols: ["AMD"] },
      ]),
      repo.saveSubsectors("chips", initial.revision, [
        { id: "second", name: "Second", symbols: ["TSM"] },
      ]),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "SUBSECTORS_CONFLICT" },
    });
    expect((await repo.readSubsectorEditor("chips")).subsectors[0].id).toBe(
      "first",
    );
  });
  it("supports Owner Focus and detects membership changes while editing", async () => {
    await repo.addOwnerFocusSymbol({ symbol: "NVDA", rowId: "focus" });
    const initial = await repo.readSubsectorEditor("owner-focus");
    await repo.saveSubsectors("owner-focus", initial.revision, [
      { id: "ai", name: "AI", symbols: ["NVDA"] },
    ]);
    const before = await repo.readSubsectorEditor("owner-focus");
    await repo.removeOwnerFocusSymbol("NVDA");
    await expect(
      repo.saveSubsectors("owner-focus", before.revision, before.subsectors),
    ).rejects.toMatchObject({ code: "SUBSECTORS_CONFLICT" });
    expect(
      (await repo.readWatchlists()).watchlists[0].subsectors?.[0].symbols,
    ).toEqual([]);
  });
  it("keeps browser-only edits separate and permits tagging new shared classifications", async () => {
    const initial = await repo.readSubsectorEditor("chips");
    await repo.saveSubsectors("chips", initial.revision, [
      { id: "shared", name: "Shared", symbols: ["NVDA"] },
    ]);
    await repo.addWatchlistSymbol("alice", "chips", {
      symbol: "INTC",
      rowId: "core",
      subsectors: ["shared"],
    });
    expect(
      (await repo.readWatchlists("alice")).watchlists[1].subsectors?.[0]
        .symbols,
    ).toEqual(["NVDA", "INTC"]);
    expect(
      (await repo.readWatchlists()).watchlists[1].subsectors?.[0].symbols,
    ).toEqual(["NVDA"]);
    expect((await repo.readSubsectorEditor("chips")).symbols).not.toContain(
      "INTC",
    );
  });
  it("fails closed on corrupt saved data rather than overwriting it", async () => {
    await writeFile(join(root, "subsectors.json"), "broken");
    await expect(repo.readSubsectorEditor("chips")).rejects.toMatchObject({
      code: "SUBSECTORS_UNAVAILABLE",
    });
    expect(await readFile(join(root, "subsectors.json"), "utf8")).toBe(
      "broken",
    );
  });
});
