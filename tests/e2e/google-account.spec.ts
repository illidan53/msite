import { expect, test } from "@playwright/test";

test("Google account menu explains setup and fits a narrow screen", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { enabled: false, clientId: null, nonce: null, user: null },
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const menu = page.locator(".google-account summary");
  await expect(menu).toHaveText("Google sign-in");
  await menu.click();
  await expect(
    page.getByText("Google sign-in is awaiting setup. Please try again later."),
  ).toBeVisible();
  const panel = await page.locator(".google-account-panel").boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "test-results/google-account-mobile.png" });
});

test("account menu distinguishes owner and visitor and supports logout", async ({
  page,
}) => {
  let loggedIn = true;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        clientId: "test",
        nonce: null,
        user: loggedIn ? { email: "owner@example.com", owner: true } : null,
      },
    }),
  );
  await page.route("**/api/auth/logout", (route) => {
    loggedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.locator(".google-account summary")).toHaveText(
    "Site owner",
  );
  await page.locator(".google-account summary").click();
  await expect(
    page.getByText("owner@example.com", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".google-account summary")).toHaveText(
    "Google sign-in",
  );
});
