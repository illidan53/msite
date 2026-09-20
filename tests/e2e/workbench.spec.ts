import { expect, test, type Page } from "@playwright/test";
import type {
  MarketSnapshot,
  PriceSeries,
  RatePlanEvaluation,
  SettingsConfig,
  WatchlistsConfig,
} from "../../shared/types";

test("covers the stock workbench sector dashboard without live market calls", async ({
  page,
}) => {
  const apiMocks = await mockWorkbenchApis(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Watchlist", exact: true }).click();

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(
    page.getByRole("heading", { name: "Stock Workbench" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Semiconductors" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "New Watchlist" })).toHaveCount(
    0,
  );
  await page.getByText("Data connection", { exact: true }).click();
  await page.getByRole("button", { name: "All columns" }).click();
  const usageTable = page.getByRole("table", { name: "API usage summary" });
  await expect(usageTable).toBeVisible();
  await expect(
    usageTable.getByRole("row", { name: "Quote requests this session 1" }),
  ).toBeVisible();
  await expect(
    usageTable.getByRole("row", { name: "REST requests this session 21" }),
  ).toBeVisible();
  await expect(page.getByText("Today's API calls")).toHaveCount(0);

  const quoteTable = page.getByRole("table", { name: "Semiconductors quotes" });

  await expect(quoteTable).toBeVisible();
  await expect(
    quoteTable.getByRole("columnheader", { name: "Session Chg", exact: true }),
  ).toBeVisible();
  await expect(
    quoteTable.getByRole("columnheader", { name: "Span Chg %", exact: true }),
  ).toBeVisible();
  await expect(
    quoteTable.getByRole("columnheader", { name: "Dollar Volume" }),
  ).toBeVisible();
  await expect(quoteTable.getByText("NVIDIA")).toBeVisible();
  await expect
    .poll(() =>
      apiMocks.snapshotRequests.some(
        (symbols) => symbols.length === sectorSymbols.length,
      ),
    )
    .toBe(true);
  await expect(page.getByText("Live workspace")).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: "Table controls" });
  await expect(toolbar.getByLabel("Time span")).toHaveValue("1h");
  await expect(toolbar.getByLabel("Refresh interval")).toHaveValue("60");

  await toolbar.getByLabel("Sort by").selectOption("heat");
  await expect(
    quoteTable.getByRole("button", { name: /^[A-Z]+$/ }).first(),
  ).toHaveAccessibleName("NVDA");

  await quoteTable.getByRole("button", { name: "NVDA" }).click();
  const detailPanel = page.getByRole("complementary", { name: "NVDA details" });

  await expect(detailPanel).toBeVisible();
  await expect(detailPanel.getByLabel("NVDA chart")).toBeVisible();
  await detailPanel.getByText("Quote & range details").click();
  await expect(
    detailPanel.getByRole("table", { name: "NVDA detail summary" }),
  ).toBeVisible();
  await expect(
    detailPanel.getByRole("row", { name: "Name NVIDIA" }),
  ).toBeVisible();
  await expect(
    detailPanel.getByRole("row", { name: "Range High $126.00" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      apiMocks.historyRequests.some(
        (request) => request.symbol === "NVDA" && request.range === "1h",
      ),
    )
    .toBe(true);

  await detailPanel.getByRole("button", { name: "5y" }).click();

  await expect
    .poll(() =>
      apiMocks.historyRequests.some(
        (request) => request.symbol === "NVDA" && request.range === "5y",
      ),
    )
    .toBe(true);
  await detailPanel.getByRole("button", { name: "Close details" }).click();
  await expect(detailPanel).toBeHidden();

  await page.getByRole("button", { name: "Next page" }).click();

  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(
    quoteTable.getByRole("button", { name: "GE", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Consumer Staples" }).click();

  await expect(
    page.getByRole("table", { name: "Consumer Staples quotes" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      apiMocks.snapshotRequests.some((symbols) =>
        ["COST", "WMT", "PG", "KO"].every((symbol) => symbols.includes(symbol)),
      ),
    )
    .toBe(true);

  expect(apiMocks.configRequests).toEqual(
    expect.arrayContaining(["GET /api/config"]),
  );
  expect(
    apiMocks.configRequests.every((request) => request === "GET /api/config"),
  ).toBe(true);
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

test("keeps the quote list available while switching the linked chart", async ({
  page,
}) => {
  await mockWorkbenchApis(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Watchlist", exact: true }).click();
  const quotes = page.getByRole("table", { name: "Semiconductors quotes" });
  await expect(
    quotes.getByRole("columnheader", { name: "Price", exact: true }),
  ).toBeVisible();
  await expect(
    quotes.getByRole("columnheader", { name: "Business" }),
  ).toHaveCount(0);
  await quotes.getByRole("button", { name: "NVDA", exact: true }).click();
  await expect(page.getByLabel("NVDA chart")).toBeVisible();
  await quotes.getByRole("button", { name: "AMD", exact: true }).click();
  await expect(page.getByLabel("AMD chart")).toBeVisible();
  await quotes.getByRole("button", { name: "AMD", exact: true }).click();
  await expect(page.getByLabel("AMD chart")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Consumer Staples", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "AMD details" }),
  ).toHaveCount(0);
});

test("keeps essential quotes and chart inside a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockWorkbenchApis(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Watchlist", exact: true }).click();
  const quotes = page.getByRole("table", { name: "Semiconductors quotes" });
  await quotes.getByRole("button", { name: "NVDA", exact: true }).click();
  await expect(page.getByLabel("NVDA chart")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByLabel("Watchlist", { exact: true })
    .selectOption("consumer-staples");
  await expect(
    page.getByRole("table", { name: "Consumer Staples quotes" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const width of [1440, 375]) {
  test(`switches languages and explains ETF activity at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const mocks = await mockWorkbenchApis(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Watchlist", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "Sectors & ETFs", exact: true })
      .click();
    await page.getByRole("button", { name: /^Industries/ }).click();
    const table = page.getByRole("table", { name: "ETF comparison" });
    await expect(
      table.getByRole("button", { name: "SOXX", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("button", { name: "IGV", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh data", exact: true }),
    ).toBeEnabled();
    await expect(table.getByRole("row", { name: /SOXX/ })).toContainText(
      "2.00×",
    );
    expect(
      mocks.historyRequests.some(
        (r) => r.symbol === "SOXX" && r.range === "1y",
      ),
    ).toBe(true);
    await expect(
      page.getByText("资金流数据待接入", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Index benchmarks/ }).click();
    await expect(
      table.getByRole("button", { name: "QQQ", exact: true }),
    ).toBeVisible();
    await table.getByRole("button", { name: "QQQ", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "QQQ · Nasdaq-100" }),
    ).toBeVisible();
    await expect(page.getByText(/not a pure technology sector/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh data", exact: true }),
    ).toBeEnabled();
    const calls = mocks.historyRequests.length;
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(
      page.getByRole("heading", { name: "板块与 ETF", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "QQQ · 纳斯达克 100" }),
    ).toBeVisible();
    expect(mocks.historyRequests.length).toBe(calls);
    const help = page
      .getByRole("button", { name: "了解CMF（20 日）", exact: true })
      .last();
    await help.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "CMF（20 日）",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("怎么算", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/不能当作实际资金净流入/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeFocused();
    await help.click();
    await dialog.getByRole("button", { name: "明白了" }).click();
    await help.click();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page).toHaveTitle("股票观察台");
    await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh");
    await page.getByRole("button", { name: "自选列表", exact: true }).click();
    if (width < 600)
      await page
        .getByLabel("自选列表", { exact: true })
        .selectOption("consumer-staples");
    else
      await page.getByRole("button", { name: "必需消费", exact: true }).click();
    const quotes = page.getByRole("table", { name: "必需消费行情" });
    await expect(quotes).toBeVisible();
    await page.getByRole("button", { name: "全部列" }).click();
    await expect(page.getByLabel("排序方式")).toContainText("默认顺序");
    await quotes.getByRole("button", { name: "COST", exact: true }).click();
    await expect(page.getByLabel("COST 图表", { exact: true })).toBeVisible();
    await page.getByText("行情与区间详情", { exact: true }).click();
    await expect(
      page
        .getByRole("table", { name: "COST 详情摘要" })
        .getByRole("row", { name: /区间最高价/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "了解估算成交额", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByText(/也不是资金净流入/),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByLabel("语言", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Stock Workbench" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "About Estimated dollar volume",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("How it is calculated", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("怎么算");
    expect(mocks.unexpectedApiRequests).toEqual([]);
  });
}

test("keeps other ETFs usable when one history request fails, and retries it", async ({
  page,
}) => {
  await mockWorkbenchApis(page);
  let fail = true;
  await page.route("**/api/market/history?**", async (route) => {
    if (
      fail &&
      new URL(route.request().url()).searchParams.get("symbol") === "SOXX"
    )
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    else await route.fallback();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sectors & ETFs", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("SOXX");
  await expect(
    page.getByRole("button", { name: "Refresh data", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^Industries/ }).click();
  const table = page.getByRole("table", { name: "ETF comparison" });
  await expect(table.getByRole("row", { name: /IGV/ })).toContainText("2.00×");
  await expect(table.getByRole("row", { name: /SOXX/ })).toContainText("—");
  fail = false;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(table.getByRole("row", { name: /SOXX/ })).toContainText("2.00×");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const width of [1440, 375]) {
  test(`explores rotation history across all ETFs at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const mocks = await mockWorkbenchApis(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Sectors & ETFs", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^Overview/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: "Rotation overview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh data", exact: true }),
    ).toBeEnabled();
    const history = page.getByRole("table", { name: /^Rotation history/ });
    await expect(
      history.getByRole("button", { name: /^Explore / }),
    ).toHaveCount(23);
    await expect(
      page.getByRole("img", { name: "Cumulative price change chart" }),
    ).toBeVisible();
    const calls = mocks.historyRequests.length;
    const chart = page.getByRole("region", {
      name: "Trend comparison",
      exact: true,
    });
    const highlight = chart.getByRole("button", {
      name: "Highlight SOXX",
      exact: true,
    });
    const soxxPath = chart.locator('path[data-symbol="SOXX"]');
    const spyPath = chart.locator('path[data-symbol="SPY"]');
    await highlight.click();
    await expect(highlight).toHaveAttribute("aria-pressed", "true");
    await expect(soxxPath).toHaveAttribute("stroke-width", "3.5");
    await expect(spyPath).toHaveAttribute("opacity", "0.18");
    await chart
      .getByRole("button", { name: "Highlight SPY", exact: true })
      .click();
    await expect(spyPath).toHaveAttribute("opacity", "1");
    await expect(soxxPath).toHaveAttribute("opacity", "0.18");
    await page.keyboard.press("Escape");
    await expect(soxxPath).toHaveAttribute("opacity", "1");
    await highlight.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(highlight).toHaveAttribute("aria-pressed", "false");
    await highlight.click();
    const comparison = page.getByRole("region", {
      name: "Trend comparison",
      exact: true,
    });
    const selectMetric = comparison.getByLabel("Comparison metric", {
      exact: true,
    });
    const metricValues = comparison.getByRole("list", {
      name: "Metric values on selected date",
    });
    await selectMetric.selectOption("rvol");
    await expect(highlight).toHaveAttribute("aria-pressed", "true");
    await expect(spyPath).toHaveAttribute("opacity", "0.18");
    await expect(
      comparison.getByRole("heading", {
        name: "Relative volume (5/20)",
        exact: true,
      }),
    ).toBeVisible();
    await expect(metricValues.getByText("2.00×", { exact: true })).toHaveCount(
      5,
    );
    await expect(comparison.locator(".comparison-context")).toContainText(
      "Reference: 1×",
    );
    await expect(comparison.getByRole("img")).toContainText("Unit: ×");
    await expect(
      page.getByLabel("Heatmap metric", { exact: true }),
    ).toHaveValue("relative20");
    await selectMetric.selectOption("relative20");
    await expect(
      metricValues.getByText("+13.42 pp", { exact: true }),
    ).toHaveCount(4);
    await expect(
      metricValues.getByText("0.00 pp", { exact: true }),
    ).toHaveCount(1);
    await selectMetric.selectOption("cmf");
    await expect(metricValues.getByText("0.00", { exact: true })).toHaveCount(
      5,
    );
    await expect(comparison.getByRole("img")).toContainText("Unit: unitless");
    await comparison
      .getByRole("button", { name: "About CMF (20)", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "not measured capital inflow",
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    await expect(page.getByLabel("对比指标", { exact: true })).toHaveValue(
      "cmf",
    );
    await expect(
      page
        .getByRole("region", { name: "走势对比", exact: true })
        .getByRole("img"),
    ).toContainText("单位: 无量纲");
    await page.getByLabel("语言", { exact: true }).selectOption("en");
    await selectMetric.selectOption("priceChange");
    await expect(
      comparison.getByRole("heading", {
        name: "Cumulative price change",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Heatmap metric", { exact: true })
      .selectOption("rvol");
    await expect(
      history.getByRole("row", { name: /Explore SOXX/ }),
    ).toContainText("2.00");
    await page
      .getByLabel("Heatmap metric", { exact: true })
      .selectOption("cmf");
    await page
      .getByRole("button", { name: "About CMF (20)", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "not measured capital inflow",
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("Lookback", { exact: true }).selectOption("120");
    await expect(
      page.getByText("69 sessions available", { exact: false }),
    ).toBeVisible();
    const slider = page.getByRole("slider");
    await slider.focus();
    await page.keyboard.press("Home");
    const legend = page.getByRole("list", {
      name: "Price changes on selected date",
    });
    await expect(legend.getByText("0.00%", { exact: true })).toHaveCount(5);
    await page.keyboard.press("End");
    await expect(legend.getByText("+69.00%", { exact: true })).toHaveCount(4);
    await page.getByText("Choose ETFs", { exact: false }).click();
    await page
      .getByRole("checkbox", { name: /SMH/ })
      .isDisabled()
      .then((disabled) => expect(disabled).toBe(true));
    await page.getByRole("checkbox", { name: /SOXX/ }).uncheck();
    await expect(spyPath).toHaveAttribute("opacity", "1");
    await page.getByRole("checkbox", { name: /SMH/ }).check();
    await expect(legend.getByText("SMH", { exact: true })).toBeVisible();
    await expect(legend.getByText("SOXX", { exact: true })).toHaveCount(0);
    await page.getByText("Choose ETFs", { exact: false }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    await expect(
      page.getByRole("heading", { name: "板块轮动总览", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("热力图指标", { exact: true })).toHaveValue(
      "cmf",
    );
    await page
      .getByRole("button", { name: "了解同起点价格走势", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("缺失日期处断线");
    await page.keyboard.press("Escape");
    expect(mocks.historyRequests.length).toBe(calls);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "查看 IGV", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "IGV · 软件", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^行业细分/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.unexpectedApiRequests).toEqual([]);
  });
}

test("keeps overview usable when the shared benchmark is unavailable", async ({
  page,
}) => {
  await mockWorkbenchApis(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/market/history?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("symbol") === "SPY")
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    else await route.fallback();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sectors & ETFs", exact: true })
    .click();
  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(
    page.getByRole("button", { name: "Refresh data", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(
      "SPY history is unavailable. Refresh data to build comparable charts.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("slider")).toBeDisabled();
  await expect(
    page
      .getByRole("list", { name: "Price changes on selected date" })
      .getByText("—", { exact: true }),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "Explore IGV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "IGV · Software", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [1440, 375]) {
  test(`shows daily watchlist returns in menus and headings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const mocks = await mockWorkbenchApis(page);
    await page.goto("/");
    const headingBadge = page.locator(
      ".watchlist-heading-line > .watchlist-performance",
    );
    await expect(headingBadge).toHaveText("+0.57%");
    await expect(headingBadge).toHaveClass(/positive-change/);
    await page.getByRole("button", { name: "Watchlist", exact: true }).click();
    if (width > 600) {
      const menu = page.getByRole("button", {
        name: "Consumer Staples",
        exact: true,
      });
      await expect(menu).toContainText("+0.50%");
      await menu.click();
    } else {
      await expect(page.getByLabel("Watchlist", { exact: true })).toContainText(
        "Consumer Staples · +0.50%",
      );
      await expect(page.locator(".mobile-watchlist-performance")).toContainText(
        "+0.57%",
      );
      await page
        .getByLabel("Watchlist", { exact: true })
        .selectOption("consumer-staples");
    }
    await expect(headingBadge).toHaveText("+0.50%");
    await expect(page.locator(".watchlist-performance-caption")).toContainText(
      "4/4",
    );
    const count = mocks.snapshotRequests.length;
    await page
      .getByRole("button", {
        name: "About Watchlist daily change",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "not your portfolio return",
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    await expect(page.locator(".watchlist-performance-caption")).toContainText(
      "等权日涨跌",
    );
    await page
      .getByRole("button", { name: "了解列表日涨跌幅", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("重复代码只算一次");
    await page.keyboard.press("Escape");
    expect(mocks.snapshotRequests.length).toBe(count);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [1440, 390]) {
  test(`groups secondary watchlists under Other at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await mockWorkbenchApis(page);
    const focus = workbenchConfig.watchlists.watchlists[0];
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: {
          ...workbenchConfig,
          watchlists: {
            watchlists: [
              ...workbenchConfig.watchlists.watchlists,
              { ...focus, id: "mega-cap-tech", name: "Mega-Cap Tech" },
              {
                ...focus,
                id: "software",
                name: "Software & SaaS",
                selectionNote: "Software coverage",
              },
              {
                ...focus,
                id: "energy",
                name: "Energy",
                navigationGroup: "other",
              },
            ],
          },
        },
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Watchlist", exact: true }).click();
    if (width > 600) {
      await expect(
        page.locator(".watchlist-buttons > .watchlist-performance-button"),
      ).toHaveCount(4);
      const other = page.getByRole("button", { name: "Other", exact: true });
      await expect(other).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("button", { name: "Energy", exact: true }),
      ).toBeHidden();
      await other.click();
      await page.getByRole("button", { name: "Energy", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Energy", exact: true }),
      ).toBeVisible();
      await other.click();
      await expect(
        page.getByRole("heading", { name: "Energy", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Software & SaaS", exact: true })
        .click();
    } else {
      await expect(page.locator('optgroup[label="Other"] option')).toHaveCount(
        1,
      );
      await page
        .getByLabel("Watchlist", { exact: true })
        .selectOption("software");
    }
    await page
      .getByText("Selection criteria & coverage", { exact: true })
      .click();
    await expect(
      page.getByText("Software coverage", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Language", { exact: true }).selectOption("zh");
    if (width > 600) {
      await expect(
        page.getByRole("button", { name: "其他", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.locator('optgroup[label="其他"]')).toHaveCount(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

async function mockWorkbenchApis(page: Page) {
  const configRequests: string[] = [];
  const snapshotRequests: string[][] = [];
  const historyRequests: Array<{
    range: PriceSeries["range"];
    symbol: string;
  }> = [];
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
    const symbols = (payload.symbols ?? []).map((symbol) =>
      symbol.toUpperCase(),
    );

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
    const range = (url.searchParams.get("range") ??
      "1h") as PriceSeries["range"];

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

const workbenchConfig: {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
} = {
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

  return (
    snapshots[symbol] ??
    createSnapshot(symbol, `${symbol} Inc.`, 100 + Math.max(index, 0), 0.5)
  );
}

function createSnapshot(
  symbol: string,
  name: string,
  price: number,
  changePercent: number,
): MarketSnapshot {
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
  if (range === "1y") {
    const bars: PriceSeries["bars"] = [];
    const day = new Date("2025-01-01T05:00:00Z");
    while (bars.length < 70) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
        const close = symbol === "SPY" ? 100 : 100 + bars.length;
        bars.push({
          timestamp: day.toISOString(),
          open: close,
          high: close + 2,
          low: close - 2,
          close,
          volume: bars.length >= 65 ? 200 : 100,
        });
      }
      day.setUTCDate(day.getUTCDate() + 1);
    }
    return { symbol, range, bars };
  }
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
