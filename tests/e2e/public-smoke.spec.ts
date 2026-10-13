import { expect, test } from "@playwright/test";
import type { AuthSession, WatchlistsConfig } from "../../shared/types";

test.skip(
  !process.env.MSITE_PUBLIC_BASE_URL,
  "Set MSITE_PUBLIC_BASE_URL to verify a deployed public instance.",
);

test("public deployment serves the workbench shell and health endpoint", async ({
  page,
  request,
}) => {
  const healthResponse = await request.get("/api/health");

  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toEqual({
    ok: true,
    service: "stock-workbench-api",
  });

  const configResponse = await request.get("/api/watchlists");
  expect(configResponse.ok()).toBe(true);
  const config = (await configResponse.json()) as WatchlistsConfig;
  const cloud = config.watchlists.find(
    (list) => list.id === "ai-cloud-infrastructure",
  );
  const semis = config.watchlists.find((list) => list.id === "semiconductors");
  expect(
    semis?.subsectors?.find((subsector) => subsector.id === "networking")
      ?.name,
  ).toBe("Networking");
  expect(semis?.subsectors?.map((subsector) => subsector.id)).toEqual(
    expect.arrayContaining(["ai-chips", "optical", "cpu"]),
  );
  // Members can be edited at runtime, so check the structure, not the symbols.
  expect(
    cloud?.rows.find((row) => row.name === "GPU cloud operators")?.symbols
      .length,
  ).toBeGreaterThan(0);
  expect(
    cloud?.selectionSources?.some(
      (source) => source.kind === "discussion" && source.publishedAt,
    ),
  ).toBe(true);

  await page.goto("/");

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(
    page.getByRole("heading", { name: "Stock Workbench" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Watchlist", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.locator(".watchlist-heading-line > .watchlist-performance"),
  ).toBeVisible();
  const subsectorBar = page.getByRole("group", { name: "Sub-sectors" });
  await subsectorBar.getByRole("button", { name: /^Optical modules/ }).click();
  await expect(
    subsectorBar.getByRole("button", { name: /^Optical modules/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Watchlist", exact: true }).click();
  await expect(
    page.locator(".watchlist-buttons > .watchlist-performance-button"),
  ).toHaveCount(4);
  const other = page.getByRole("button", { name: "Other", exact: true });
  await expect(other).toHaveAttribute("aria-expanded", "false");
  await other.click();
  await expect(page.locator("#other-watchlists > button")).toHaveCount(9);
  await page
    .getByRole("button", { name: "Software & SaaS", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Software & SaaS", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sectors & ETFs", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sectors & ETFs" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Overview/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const highlight = page.getByRole("button", {
    name: "Highlight SOXX",
    exact: true,
  });
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "true");
  await highlight.click();
  await expect(
    page.getByRole("heading", { name: "Rotation overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: /^Rotation history/ })
      .getByRole("button", { name: /^Explore / }),
  ).toHaveCount(23);
  await page
    .getByRole("button", { name: "About Rebased price paths", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Missing dates break the line",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(
    page.getByRole("heading", { name: "板块与 ETF", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByLabel("对比指标", { exact: true }).selectOption("rvol");
  await expect(
    page
      .getByRole("region", { name: "走势对比", exact: true })
      .getByRole("heading", { name: "量比（5/20）", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "板块轮动总览", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("public deployment serves stock and ETF research", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/research");
  expect(response.ok()).toBe(true);
  expect(Array.isArray(await response.json())).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Dig Deep", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dig Deep", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run analysis", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Saved reports")).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(
    page.getByRole("heading", { name: "深度研究", exact: true }),
  ).toBeVisible();
});

test("public research authorization resists spoofed source headers", async ({
  request,
}) => {
  const baseline = await request.get("/api/research/access");
  expect(baseline.ok()).toBe(true);
  const access = (await baseline.json()) as {
    canRun: boolean;
    clientIp: string | null;
  };
  expect(access.clientIp).toBeTruthy();
  expect(access.clientIp).not.toMatch(
    /^(172\.(1[6-9]|2\d|3[01])\.|127\.|10\.|192\.168\.|::1$)/,
  );
  expect(access.canRun).toBe(access.clientIp === "70.111.76.119");
  for (const spoof of [
    "70.111.76.119",
    "198.51.100.7",
    "70.111.76.119, 198.51.100.7",
  ]) {
    const headers = {
      "X-Forwarded-For": spoof,
      "X-Real-IP": spoof,
      Forwarded: `for=${spoof}`,
    };
    const result = await request.get("/api/research/access", { headers });
    expect(await result.json()).toEqual(access);
    // Invalid input checks authorization without running jobs or spending tokens.
    const denied = await request.post("/api/research", {
      headers,
      data: { symbol: "../invalid" },
    });
    expect(denied.status()).toBe(access.canRun ? 400 : 403);
    const historyDenied = await request.post("/api/research/invalid/history", {
      headers,
    });
    expect(historyDenied.status()).toBe(access.canRun ? 400 : 403);
    const modelDenied = await request.post("/api/research/invalid/models", {
      headers,
    });
    expect(modelDenied.status()).toBe(access.canRun ? 400 : 403);
    if (!access.canRun) {
      expect((await denied.json()).code).toBe("RESEARCH_IP_FORBIDDEN");
      // Only probe the scan endpoint when it cannot start a real scan.
      const scanDenied = await request.post("/api/models/scan", { headers });
      expect(scanDenied.status()).toBe(403);
    }
    // An invalid job name checks authorization without starting a quant run.
    const strategyDenied = await request.post("/api/strategy/run", {
      headers,
      data: { job: "invalid" },
    });
    expect(strategyDenied.status()).toBe(access.canRun ? 400 : 403);
    // Watchlist edits need a signed-in account whatever the IP.
    const addDenied = await request.post(
      "/api/watchlists/semiconductors/symbols",
      { headers, data: {} },
    );
    expect(addDenied.status()).toBe(401);
    const removeDenied = await request.delete(
      "/api/watchlists/semiconductors/symbols/%24BAD",
      { headers },
    );
    expect(removeDenied.status()).toBe(401);
  }
});

test("public deployment serves saved model scans read-only", async ({
  request,
}) => {
  const response = await request.get("/api/models/scan");
  expect(response.ok()).toBe(true);
  const state = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(state).sort()).toEqual(["job", "lastFailure", "scan"]);
  const invalid = await request.get("/api/models/charts/%24BAD");
  expect(invalid.status()).toBe(400);
});

test("public deployment serves the quant system read-only", async ({
  request,
}) => {
  const response = await request.get("/api/strategy/state");
  expect(response.ok()).toBe(true);
  const state = (await response.json()) as {
    books: { id: string }[];
    email: Record<string, unknown>;
    scheduler: { enabled: boolean };
  };
  expect(state.books.map((b) => b.id)).toEqual(["stocks", "sectors"]);
  expect(Object.keys(state.email).sort()).toEqual([
    "configured",
    "lastSent",
    "transport",
  ]);
  expect(state.scheduler.enabled).toBe(true);
  // Never reveal recipients.
  expect(JSON.stringify(state)).not.toMatch(/[\w.+-]+@[a-z0-9-]+\.[a-z]/i);
  const outbox = await request.get("/api/strategy/outbox");
  expect(outbox.ok()).toBe(true);
  expect(await outbox.text()).not.toMatch(/[\w.+-]+@[a-z0-9-]+\.[a-z]/i);
  const invalid = await request.get("/api/strategy/charts/stocks/%24BAD");
  expect(invalid.status()).toBe(400);
});

test("public deployment exposes sign-in without a session", async ({
  request,
}) => {
  const response = await request.get("/api/auth/session");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const session = (await response.json()) as AuthSession;
  expect(session.user).toBeNull();
  for (const provider of ["google", "microsoft"] as const) {
    const login = await request.get(`/api/auth/login/${provider}?returnTo=%2F`, {
      maxRedirects: 0,
    });
    if (!session.providers.includes(provider)) {
      expect(login.status()).toBe(404);
      continue;
    }
    expect(login.status()).toBe(302);
    const target = new URL(login.headers()["location"]);
    expect(target.origin).toBe(
      provider === "google"
        ? "https://accounts.google.com"
        : "https://login.microsoftonline.com",
    );
    expect(target.searchParams.get("redirect_uri")).toBe(
      `https://finance.nphunter.net/api/auth/callback/${provider}`,
    );
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("nonce")).toBeTruthy();
    expect(login.headers()["set-cookie"]).toContain("__Host-");
  }
  // A callback without this browser's sealed transaction never signs in.
  const forged = await request.get(
    "/api/auth/callback/google?code=x&state=forged&iss=https%3A%2F%2Faccounts.google.com",
    { maxRedirects: 0 },
  );
  expect(forged.status()).toBe(303);
  expect(forged.headers()["location"]).toBe("/?login=failed");
  expect(forged.headers()["referrer-policy"]).toBe("no-referrer");
  expect(forged.headers()["set-cookie"] ?? "").not.toContain("msite_session=");
  expect(forged.headers()["strict-transport-security"]).toBe("max-age=31536000");
  const privacy = await request.get("/privacy.html");
  expect(privacy.ok()).toBe(true);
  expect(await privacy.text()).toContain("Delete my data");
});
