import { expect, test } from "@playwright/test";
import type { WatchlistsConfig } from "../../shared/types";

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
  expect(
    cloud?.rows.find((row) => row.name === "GPU cloud operators")?.symbols,
  ).toEqual(["CRWV", "NBIS", "IREN"]);
  expect(cloud?.rows.flatMap((row) => row.symbols)).toContain("P");
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
  await page.getByRole("button", { name: "Stock / ETF", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stock / ETF", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run analysis", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Saved reports")).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(
    page.getByRole("heading", { name: "个股 / ETF", exact: true }),
  ).toBeVisible();
});
