import { expect, test, type Page } from "@playwright/test";
import type {
  MarketSnapshot,
  PriceSeries,
  RatePlanEvaluation,
  RecommendationCandidate,
  SettingsConfig,
  WatchlistsConfig,
} from "../../shared/types";

test("covers the stock workbench flow without live market calls", async ({ page }) => {
  const apiMocks = await mockWorkbenchApis(page);

  await page.goto("/");

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(page.getByRole("heading", { name: "Stock Workbench" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Semiconductors" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Leaders" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Equipment" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "ASML" })).toHaveCount(0);

  await page.getByRole("button", { name: "Equipment" }).click();

  await expect(page.getByRole("button", { name: "Equipment" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "ASML" })).toBeVisible();
  await expect.poll(() => apiMocks.snapshotRequests.some((symbols) => symbols.includes("ASML"))).toBe(true);

  await page.getByRole("button", { name: "NVDA" }).click();

  await expect(page.getByRole("heading", { name: "NVDA" })).toBeVisible();
  await expect(page.getByLabel("NVDA chart")).toBeVisible();
  await expect(page.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => apiMocks.historyRequests.some((request) => request.symbol === "NVDA" && request.range === "1M"))
    .toBe(true);

  await page.getByRole("button", { name: "Candles" }).click();

  await expect(page.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "New Watchlist" }).click();
  const editor = page.getByRole("dialog", { name: "Watchlist editor" });

  await expect(editor).toBeVisible();
  await editor.getByLabel("Name").fill("AI Leaders");
  await editor.getByLabel("Theme").fill("AI chips");
  await editor.getByLabel("Pinned symbols").fill("nvda");
  await editor.getByRole("button", { name: "Recommend" }).click();
  await expect(editor.getByRole("checkbox", { name: /TSM/i })).toBeVisible();
  await editor.getByRole("checkbox", { name: /TSM/i }).check();
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "AI Leaders" })).toBeVisible();
  await expect.poll(() => apiMocks.savedWatchlists.length).toBe(1);

  expect(apiMocks.recommendationRequests).toEqual([
    {
      excludedSymbols: [],
      limit: 8,
      pinnedSymbols: ["NVDA"],
      theme: "AI chips",
    },
  ]);
  expect(apiMocks.savedWatchlists[0]?.watchlists).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "ai-leaders",
        name: "AI Leaders",
        rows: [
          expect.objectContaining({
            id: "recommended",
            name: "Recommended",
            symbols: ["NVDA", "TSM"],
          }),
        ],
      }),
    ]),
  );
  expect(apiMocks.configRequests).toEqual(expect.arrayContaining(["GET /api/config"]));
  expect(apiMocks.configRequests.every((request) => request === "GET /api/config")).toBe(true);
  expect(apiMocks.ratePlanRequests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        activeSymbolCount: 3,
        intervalSeconds: 30,
        paidPlanName: "stocks-starter",
        plan: "paid",
      }),
    ]),
  );
  expect(apiMocks.unexpectedApiRequests).toEqual([]);
});

async function mockWorkbenchApis(page: Page) {
  const configRequests: string[] = [];
  const snapshotRequests: string[][] = [];
  const historyRequests: Array<{ range: PriceSeries["range"]; symbol: string }> = [];
  const ratePlanRequests: unknown[] = [];
  const recommendationRequests: unknown[] = [];
  const savedWatchlists: WatchlistsConfig[] = [];
  const unexpectedApiRequests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const label = `${request.method()} ${url.pathname}${url.search}`;

    if (isMockedApiRequest(request.method(), url)) {
      await route.fallback();
      return;
    }

    unexpectedApiRequests.push(label);

    await route.fulfill({
      status: 599,
      json: {
        error: `Unexpected API call in workbench E2E: ${label}`,
      },
    });
  });

  await page.route("**/api/config", async (route) => {
    const request = route.request();

    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }

    configRequests.push("GET /api/config");

    await route.fulfill({
      json: workbenchConfig,
    });
  });

  await page.route("**/api/market/snapshots", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    const payload = route.request().postDataJSON() as { symbols?: string[] };
    const symbols = (payload.symbols ?? []).map((symbol) => symbol.toUpperCase());

    snapshotRequests.push(symbols);

    await route.fulfill({
      json: symbols.map((symbol) => snapshotFor(symbol)),
    });
  });

  await page.route("**/api/market/history?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    const url = new URL(route.request().url());
    const symbol = (url.searchParams.get("symbol") ?? "NVDA").toUpperCase();
    const range = (url.searchParams.get("range") ?? "1M") as PriceSeries["range"];

    historyRequests.push({ range, symbol });

    await route.fulfill({
      json: historyFor(symbol, range),
    });
  });

  await page.route("**/api/rate-plan/evaluate", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    ratePlanRequests.push(route.request().postDataJSON());

    await route.fulfill({
      json: ratePlanEvaluation,
    });
  });

  await page.route("**/api/watchlists/recommendations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    recommendationRequests.push(route.request().postDataJSON());

    await route.fulfill({
      json: recommendationCandidates,
    });
  });

  await page.route("**/api/config/watchlists", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    const payload = route.request().postDataJSON() as WatchlistsConfig;

    savedWatchlists.push(payload);

    await route.fulfill({
      json: payload,
    });
  });

  return {
    configRequests,
    historyRequests,
    ratePlanRequests,
    recommendationRequests,
    savedWatchlists,
    snapshotRequests,
    unexpectedApiRequests,
  };
}

function isMockedApiRequest(method: string, url: URL) {
  return (
    (method === "POST" && url.pathname === "/api/market/snapshots") ||
    (method === "GET" && url.pathname === "/api/market/history") ||
    (method === "POST" && url.pathname === "/api/rate-plan/evaluate") ||
    (method === "POST" && url.pathname === "/api/watchlists/recommendations") ||
    (method === "GET" && url.pathname === "/api/config") ||
    (method === "PUT" && url.pathname === "/api/config/watchlists")
  );
}

const workbenchConfig: { settings: SettingsConfig; watchlists: WatchlistsConfig } = {
  settings: {
    polygon: {
      plan: "paid",
      paidPlanName: "stocks-starter",
      warningThreshold: 0.75,
      hardThreshold: 0.95,
    },
  },
  watchlists: {
    watchlists: [
      {
        id: "semiconductors",
        name: "Semiconductors",
        description: "Large semiconductor names and user focus list",
        theme: "semiconductors",
        pinnedSymbols: ["NVDA", "AMD"],
        rows: [
          {
            id: "leaders",
            name: "Leaders",
            expandedByDefault: true,
            symbols: ["NVDA", "AMD", "AVGO"],
          },
          {
            id: "equipment",
            name: "Equipment",
            expandedByDefault: false,
            symbols: ["ASML", "AMAT", "LRCX"],
          },
        ],
      },
    ],
  },
};

const ratePlanEvaluation: RatePlanEvaluation = {
  status: "ok",
  plan: "paid",
  intervalSeconds: 30,
  estimatedCallsPerMinute: 2,
  message: "Refresh interval is within the configured budget.",
  disabledIntervals: [],
};

function snapshotFor(symbol: string): MarketSnapshot {
  const snapshots: Record<string, MarketSnapshot> = {
    AMD: createSnapshot("AMD", "Advanced Micro Devices", 164.1, -0.8),
    AMAT: createSnapshot("AMAT", "Applied Materials", 211.77, 0.9),
    ASML: createSnapshot("ASML", "ASML Holding", 956.24, 1.35),
    AVGO: createSnapshot("AVGO", "Broadcom", 1428.62, 0.6),
    LRCX: createSnapshot("LRCX", "Lam Research", 921.4, -0.2),
    NVDA: createSnapshot("NVDA", "NVIDIA", 119.08, 2.45),
    TSM: createSnapshot("TSM", "Taiwan Semiconductor", 188.53, 1.1),
  };

  return snapshots[symbol] ?? createSnapshot(symbol, symbol, 100, 0);
}

function createSnapshot(symbol: string, name: string, price: number, changePercent: number): MarketSnapshot {
  return {
    symbol,
    name,
    price,
    change: Number((price * changePercent * 0.01).toFixed(2)),
    changePercent,
    volume: 42_100_000,
    updatedAt: "2026-05-23T14:30:00.000Z",
    timeframe: "DELAYED",
  };
}

function historyFor(symbol: string, range: PriceSeries["range"]): PriceSeries {
  return {
    symbol,
    range,
    bars: [
      {
        timestamp: "2026-05-20T14:30:00.000Z",
        open: 116,
        high: 121,
        low: 115,
        close: 120,
        volume: 32_000_000,
      },
      {
        timestamp: "2026-05-21T14:30:00.000Z",
        open: 120,
        high: 124,
        low: 119,
        close: 123,
        volume: 35_000_000,
      },
      {
        timestamp: "2026-05-22T14:30:00.000Z",
        open: 123,
        high: 126,
        low: 121,
        close: 125,
        volume: 38_000_000,
      },
    ],
  };
}

const recommendationCandidates: RecommendationCandidate[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    score: 1,
    reasons: ["Pinned by user"],
    source: "pinned",
  },
  {
    symbol: "TSM",
    name: "Taiwan Semiconductor",
    score: 0.89,
    reasons: ["Large semiconductor foundry"],
    source: "reference",
  },
  {
    symbol: "ASML",
    name: "ASML Holding",
    score: 0.82,
    reasons: ["Semiconductor equipment exposure"],
    source: "related",
  },
];
