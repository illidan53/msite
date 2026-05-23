import { expect, test } from "@playwright/test";

test("loads the stock workbench scaffold", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Stock Workbench");
  await expect(
    page.getByRole("heading", { name: "Stock Workbench" }),
  ).toBeVisible();
  await expect(page.getByText("Loading watchlists...")).toBeVisible();
});
