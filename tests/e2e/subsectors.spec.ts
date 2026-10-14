import { expect, test } from "@playwright/test";
import type { WatchlistSubsector } from "../../shared/types";

for (const width of [1440, 375]) {
  test(`owner manages shared sub-sectors at ${width}px`, async ({ page }) => {
    let groups: WatchlistSubsector[] = [{ id: "ai", name: "AI", symbols: ["NVDA"] }];
    let revision = "a".repeat(64);
    let canEdit = true;
    let conflict = false;
    const list = () => ({ id: "chips", name: "Chips", pinnedSymbols: [], rows: [{ id: "core", name: "Core", expandedByDefault: true, symbols: ["NVDA", "AMD", "TSM"] }], subsectors: groups, subsectorManaged: { canEdit } });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config") return route.fulfill({ json: { settings: { polygon: { plan: "paid", warningThreshold: .8, hardThreshold: 1 } }, watchlists: { watchlists: [list()] } } });
      if (path === "/api/auth/session") return route.fulfill({ json: { enabled: false, user: null } });
      if (path === "/api/watchlists/chips/subsectors") {
        if (route.request().method() === "PUT") {
          if (conflict) return route.fulfill({ status: 409, json: { code: "SUBSECTORS_CONFLICT" } });
          const input = route.request().postDataJSON();
          expect(input.revision).toBe(revision);
          groups = input.subsectors;
          revision = revision === "a".repeat(64) ? "b".repeat(64) : "a".repeat(64);
          return route.fulfill({ json: { editor: { symbols: ["NVDA", "AMD", "TSM"], subsectors: groups, revision }, watchlists: { watchlists: [list()] } } });
        }
        return route.fulfill({ json: { symbols: ["NVDA", "AMD", "TSM"], subsectors: groups, revision } });
      }
      if (path === "/api/market/history") return route.fulfill({ json: { symbol: new URL(route.request().url()).searchParams.get("symbol"), range: "1h", bars: [] } });
      if (path === "/api/market/snapshots") return route.fulfill({ json: ["NVDA", "AMD", "TSM"].map((symbol) => ({ symbol, price: 100, change: 1, changePercent: 1, spanChange: 1, spanChangePercent: 1, volume: 100, updatedAt: "2026-10-14T15:00:00Z", timeframe: "DELAYED" })) });
      if (path === "/api/rate-plan/evaluate") return route.fulfill({ json: { status: "ok", plan: "paid", intervalSeconds: 60, estimatedCallsPerMinute: 1, message: "OK", disabledIntervals: [] } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Manage sub-sectors", exact: true }).click();
    const manager = page.locator("#subsector-manager");
    await expect(manager.getByLabel("Sub-sector name", { exact: true })).toHaveValue("AI");
    await manager.getByLabel("Sub-sector name", { exact: true }).fill("AI chips");
    await manager.getByRole("checkbox", { name: "AMD", exact: true }).check();
    await manager.getByRole("button", { name: "Add sub-sector", exact: true }).click();
    await manager.getByLabel("Sub-sector name", { exact: true }).fill("Foundry");
    await manager.getByRole("checkbox", { name: "TSM", exact: true }).check();
    await manager.getByRole("checkbox", { name: "NVDA", exact: true }).check();
    await manager.getByRole("button", { name: "Save shared sub-sectors" }).click();
    await expect(manager.getByText("Saved for all visitors.")).toBeVisible();
    expect(groups.map((g) => g.symbols)).toEqual([["NVDA", "AMD"], ["TSM", "NVDA"]]);
    const bar = page.getByRole("group", { name: "Sub-sectors", exact: true });
    await bar.getByRole("button", { name: /^Foundry/ }).click();
    await expect(page.getByRole("button", { name: "AMD", exact: true })).toHaveCount(0);
    const box = await manager.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/subsectors-${width}.png`, fullPage: true });

    await manager.getByLabel("Sub-sector name", { exact: true }).fill("Draft name");
    conflict = true;
    await manager.getByRole("button", { name: "Save shared sub-sectors" }).click();
    await expect(manager.getByRole("alert")).toContainText("Another edit changed this list");
    await expect(manager.getByLabel("Sub-sector name", { exact: true })).toHaveValue("Draft name");
    await manager.getByRole("button", { name: "Discard draft and reload" }).click();
    await expect(manager.getByLabel("Sub-sector name", { exact: true })).toHaveValue("AI chips");
    conflict = false;
    await manager.getByLabel("Choose sub-sector").selectOption({ label: "Foundry (2)" });
    await manager.getByRole("button", { name: "Remove sub-sector", exact: true }).click();
    await manager.getByRole("button", { name: "Confirm removing this sub-sector" }).click();
    await manager.getByRole("button", { name: "Save shared sub-sectors" }).click();
    await expect(manager.getByText("Saved for all visitors.")).toBeVisible();
    expect(groups).toHaveLength(1);
    canEdit = false;
    await page.reload();
    await expect(page.getByRole("button", { name: "Manage sub-sectors", exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Sub-sectors", exact: true }).getByRole("button", { name: /^AI chips/ })).toBeVisible();
  });
}
