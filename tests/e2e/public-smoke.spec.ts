import { expect, test } from "@playwright/test";

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

  await page.goto("/");

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(
    page.getByRole("heading", { name: "Stock Workbench" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Watchlist", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "板块", exact: true }).click();
  await expect(page.getByRole("heading", { name: "板块资金流" })).toBeVisible();
  await page
    .getByRole("button", { name: "了解20 日流入强度", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "20 日流入强度", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
