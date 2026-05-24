import { expect, test, type Page } from "@playwright/test";
import type { MarketSnapshot, PriceSeries, RatePlanEvaluation, SettingsConfig, WatchlistsConfig } from "../../shared/types";

test("covers the stock workbench sector dashboard without live market calls", async ({ page }) => {
  const apiMocks = await mockWorkbenchApis(page);

  await page.goto("/");

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(page.getByRole("heading", { name: "Stock Workbench" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Semiconductors" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "New Watchlist" })).toHaveCount(0);
  const usageTable = page.getByRole("table", { name: "API usage summary" });
  await expect(usageTable).toBeVisible();
  await expect(usageTable.getByRole("row", { name: "Quote requests this session 1" })).toBeVisible();
  await expect(usageTable.getByRole("row", { name: "REST requests this session 21" })).toBeVisible();
  await expect(page.getByText("Today's API calls")).toHaveCount(0);

  const quoteTable = page.getByRole("table", { name: "Semiconductors quotes" });

  await expect(quoteTable).toBeVisible();
  await expect(quoteTable.getByRole("columnheader", { name: "Session Chg", exact: true })).toBeVisible();
  await expect(quoteTable.getByRole("columnheader", { name: "Span Chg %", exact: true })).toBeVisible();
  await expect(quoteTable.getByRole("columnheader", { name: "Dollar Volume" })).toBeVisible();
  await expect(quoteTable.getByText("NVIDIA")).toBeVisible();
  await expect.poll(() => apiMocks.snapshotRequests.some((symbols) => symbols.length === sectorSymbols.length)).toBe(true);
  await expect(page.getByText("Live workspace")).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: "Table controls" });
  await expect(toolbar.getByLabel("Time span")).toHaveValue("1h");
  await expect(toolbar.getByLabel("Refresh interval")).toHaveValue("60");

  await toolbar.getByLabel("Sort by").selectOption("heat");
  await expect(quoteTable.getByRole("button").first()).toHaveText("NVDA");

  await quoteTable.getByRole("button", { name: "NVDA" }).click();
  const detailPanel = page.getByRole("dialog", { name: "NVDA details" });

  await expect(detailPanel).toBeVisible();
  await expect(detailPanel.getByLabel("NVDA chart")).toBeVisible();
  await expect(detailPanel.getByRole("table", { name: "NVDA detail summary" })).toBeVisible();
  await expect(detailPanel.getByRole("row", { name: "Name NVIDIA" })).toBeVisible();
  await expect(detailPanel.getByRole("row", { name: "Range High $126.00" })).toBeVisible();
  await expect.poll(() => apiMocks.historyRequests.some((request) => request.symbol === "NVDA" && request.range === "1h")).toBe(true);

  await detailPanel.getByRole("button", { name: "5y" }).click();

  await expect.poll(() => apiMocks.historyRequests.some((request) => request.symbol === "NVDA" && request.range === "5y")).toBe(true);
  await detailPanel.getByRole("button", { name: "Close details" }).click();
  await expect(detailPanel).toBeHidden();

  await page.getByRole("button", { name: "Next page" }).click();

  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(quoteTable.getByRole("button", { name: "GE" })).toBeVisible();

  await page.getByRole("button", { name: "Consumer Staples" }).click();

  await expect(page.getByRole("table", { name: "Consumer Staples quotes" })).toBeVisible();
  await expect.poll(() => apiMocks.snapshotRequests.some((symbols) => symbols.join(",") === "COST,WMT,PG,KO")).toBe(true);

  expect(apiMocks.configRequests).toEqual(expect.arrayContaining(["GET /api/config"]));
  expect(apiMocks.configRequests.every((request) => request === "GET /api/config")).toBe(true);
  expect(apiMocks.ratePlanRequests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        activeSymbolCount: sectorSymbols.length,
        intervalSeconds: 60,
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
    const range = (url.searchParams.get("range") ?? "1h") as PriceSeries["range"];

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

  return {
    configRequests,
    historyRequests,
    ratePlanRequests,
    snapshotRequests,
    unexpectedApiRequests,
  };
}

function isMockedApiRequest(method: string, url: URL) {
  return (
    (method === "POST" && url.pathname === "/api/market/snapshots") ||
    (method === "GET" && url.pathname === "/api/market/history") ||
    (method === "POST" && url.pathname === "/api/rate-plan/evaluate") ||
    (method === "GET" && url.pathname === "/api/config")
  );
}

const sectorSymbols = [
  "NVDA",
  "AMD",
  "ASML",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
  "COST",
  "WMT",
  "PG",
  "KO",
  "PEP",
  "JPM",
  "BAC",
  "XOM",
  "CVX",
  "UNH",
  "LLY",
  "GE",
  "CAT",
  "RTX",
];

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
            symbols: ["NVDA", "AMD", "ASML", "NVDA"],
          },
          {
            id: "market",
            name: "Market",
            expandedByDefault: true,
            symbols: sectorSymbols.slice(3),
          },
        ],
      },
      {
        id: "consumer-staples",
        name: "Consumer Staples",
        description: "Large staples names",
        theme: "consumer staples",
        pinnedSymbols: ["COST"],
        rows: [
          {
            id: "staples",
            name: "Staples",
            expandedByDefault: true,
            symbols: ["COST", "WMT", "PG", "KO"],
          },
        ],
      },
    ],
  },
};

const ratePlanEvaluation: RatePlanEvaluation = {
  status: "ok",
  plan: "paid",
  intervalSeconds: 60,
  estimatedCallsPerMinute: 1,
  message: "Refresh interval is within the configured budget.",
  disabledIntervals: [],
};

function snapshotFor(symbol: string): MarketSnapshot {
  const snapshots: Record<string, MarketSnapshot> = {
    AMD: createSnapshot("AMD", "Advanced Micro Devices", 164.1, -0.8),
    ASML: createSnapshot("ASML", "ASML Holding", 956.24, 1.35),
    NVDA: createSnapshot("NVDA", "NVIDIA", 927.75, 2.45),
  };
  const index = sectorSymbols.indexOf(symbol);

  return snapshots[symbol] ?? createSnapshot(symbol, `${symbol} Inc.`, 100 + Math.max(index, 0), 0.5);
}

function createSnapshot(symbol: string, name: string, price: number, changePercent: number): MarketSnapshot {
  return {
    symbol,
    name,
    price,
    change: Number((price * changePercent * 0.01).toFixed(2)),
    changePercent,
    sessionChange: Number((price * changePercent * 0.01).toFixed(2)),
    sessionChangePercent: changePercent,
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
