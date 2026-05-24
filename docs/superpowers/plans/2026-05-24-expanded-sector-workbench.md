# Expanded Sector Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Stock Workbench into a file-generated sector dashboard with expanded sector watchlists, long shared time ranges, sortable paginated tables, API usage stats, and off-canvas symbol details.

**Architecture:** Keep the existing React/Express boundary. The backend expands accepted history ranges and Polygon aggregate mapping; the frontend flattens file-backed watchlists into sector tables, polls the selected sector, and overlays chart detail in an off-canvas panel. Watchlist write/recommendation backend routes remain available but are removed from the main UI.

**Tech Stack:** Vite, React 19, TypeScript, Express, Zod, Vitest, Testing Library, Playwright, lightweight-charts, YAML.

---

## File Structure

- Modify `shared/types.ts`: expand `PriceSeries["range"]` to the shared time option union.
- Modify `server/routes/marketRoutes.ts`: accept the expanded range enum.
- Modify `server/market/marketDataProvider.ts`: map hourly/month/year ranges to Polygon aggregates.
- Modify `server/market/marketDataProvider.test.ts`: add range mapping tests.
- Modify `server/routes/marketRoutes.test.ts`: add route validation for the expanded range.
- Modify `server/rate/ratePlanner.ts`: evaluate long refresh options.
- Modify `server/rate/ratePlanner.test.ts`: update disabled interval expectations.
- Modify `src/features/settings/RefreshControls.tsx`: expose the shared long time options.
- Modify `src/features/settings/RefreshControls.test.tsx`: assert new labels and seconds mapping.
- Modify `src/features/charts/SymbolChart.tsx`: use the shared range labels.
- Modify `src/features/charts/SymbolChart.test.tsx`: update range selection tests.
- Modify `src/features/workbench/Workbench.tsx`: remove editor UI, flatten sector symbols, add stats, sort, pagination, and off-canvas detail.
- Modify `src/features/workbench/Workbench.test.tsx`: replace row/editor tests with sector dashboard tests.
- Modify `src/styles.css`: update two-column layout, table controls, stats table, pagination, and off-canvas styles.
- Modify `config/watchlists.yaml`: add the expanded sector watchlists.
- Modify `tests/e2e/workbench.spec.ts`: update end-to-end coverage for the new dashboard behavior.

## Task 1: Backend History Ranges

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/routes/marketRoutes.ts`
- Modify: `server/market/marketDataProvider.ts`
- Test: `server/routes/marketRoutes.test.ts`
- Test: `server/market/marketDataProvider.test.ts`

- [ ] **Step 1: Write failing route and provider tests**

Add these cases:

```ts
it("accepts expanded history ranges for validated symbols", async () => {
  const provider = createFakeProvider();

  const response = await request(createMarketTestApp(provider)).get("/api/market/history").query({
    symbol: "nvda",
    range: "2month",
  });

  expect(response.status).toBe(200);
  expect(provider.getHistory).toHaveBeenCalledWith({ symbol: "NVDA", range: "2month" });
});

it("uses minute aggregates for hourly history ranges", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T15:30:00.000Z"));
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "NVDA", results: [] }), { status: 200 }));
  const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

  await provider.getHistory({ symbol: "nvda", range: "3h" });

  const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
  expect(requestedUrl.pathname).toBe("/v2/aggs/ticker/NVDA/range/1/minute/2026-05-26/2026-05-26");
});

it("maps expanded daily history ranges to the correct calendar window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T15:30:00.000Z"));
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ticker: "MSFT", results: [] }), { status: 200 }));
  const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

  await provider.getHistory({ symbol: "msft", range: "2month" });
  await provider.getHistory({ symbol: "msft", range: "5y" });

  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/v2/aggs/ticker/MSFT/range/1/day/2026-03-26/2026-05-26");
  expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe("/v2/aggs/ticker/MSFT/range/1/day/2021-05-26/2026-05-26");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run server/routes/marketRoutes.test.ts server/market/marketDataProvider.test.ts
```

Expected: FAIL because `"2month"` and `"3h"` are not assignable/accepted ranges yet.

- [ ] **Step 3: Implement expanded range support**

Use this union in `shared/types.ts`:

```ts
range: "1h" | "3h" | "6h" | "1d" | "5d" | "30d" | "2month" | "3month" | "6month" | "1y" | "5y";
```

Use this enum in `server/routes/marketRoutes.ts`:

```ts
const historyRangeSchema = z.enum(["1h", "3h", "6h", "1d", "5d", "30d", "2month", "3month", "6month", "1y", "5y"]);
```

Update `rangeToAggregates` in `server/market/marketDataProvider.ts` so hourly ranges use `1/minute`, `1d` and `5d` use `5/minute`, and longer ranges use `1/day`.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npx vitest run server/routes/marketRoutes.test.ts server/market/marketDataProvider.test.ts
```

Expected: PASS.

## Task 2: Long Refresh Controls And Rate Planner

**Files:**
- Modify: `server/rate/ratePlanner.ts`
- Test: `server/rate/ratePlanner.test.ts`
- Modify: `src/features/settings/RefreshControls.tsx`
- Test: `src/features/settings/RefreshControls.test.tsx`

- [ ] **Step 1: Write failing tests**

Add/update tests to assert:

```ts
expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getByRole("button", { name: "3h" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "2month" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "5y" })).toBeInTheDocument();

await user.click(screen.getByRole("button", { name: "3h" }));
expect(onChange).toHaveBeenCalledWith(10_800);
```

In rate planner tests, assert disabled intervals are drawn from:

```ts
[3_600, 10_800, 21_600, 86_400, 432_000, 2_592_000, 5_184_000, 7_776_000, 15_552_000, 31_536_000, 157_680_000]
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run src/features/settings/RefreshControls.test.tsx server/rate/ratePlanner.test.ts
```

Expected: FAIL because old short intervals are rendered/evaluated.

- [ ] **Step 3: Implement shared refresh options**

Update `RefreshControls.tsx` options:

```ts
const INTERVALS = [
  { label: "1h", seconds: 3_600 },
  { label: "3h", seconds: 10_800 },
  { label: "6h", seconds: 21_600 },
  { label: "1d", seconds: 86_400 },
  { label: "5d", seconds: 432_000 },
  { label: "30d", seconds: 2_592_000 },
  { label: "2month", seconds: 5_184_000 },
  { label: "3month", seconds: 7_776_000 },
  { label: "6month", seconds: 15_552_000 },
  { label: "1y", seconds: 31_536_000 },
  { label: "5y", seconds: 157_680_000 },
];
```

Set `DISABLEABLE_INTERVALS_SECONDS` in `server/rate/ratePlanner.ts` to the same seconds array.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npx vitest run src/features/settings/RefreshControls.test.tsx server/rate/ratePlanner.test.ts
```

Expected: PASS.

## Task 3: Chart Range Labels

**Files:**
- Modify: `src/features/charts/SymbolChart.tsx`
- Test: `src/features/charts/SymbolChart.test.tsx`

- [ ] **Step 1: Write failing tests**

Update chart tests to assert the new default and a new range click:

```ts
expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
await user.click(screen.getByRole("button", { name: "5y" }));
expect(onRangeChange).toHaveBeenCalledWith("5y");
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run src/features/charts/SymbolChart.test.tsx
```

Expected: FAIL because old chart range buttons are still rendered.

- [ ] **Step 3: Implement chart range options**

Change `RANGES` in `SymbolChart.tsx` to:

```ts
const RANGES: PriceSeries["range"][] = ["1h", "3h", "6h", "1d", "5d", "30d", "2month", "3month", "6month", "1y", "5y"];
```

Update `toChartTime` intraday detection to:

```ts
if (range === "1h" || range === "3h" || range === "6h" || range === "1d" || range === "5d") {
  return Math.floor(Date.parse(timestamp) / 1000);
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npx vitest run src/features/charts/SymbolChart.test.tsx
```

Expected: PASS.

## Task 4: Workbench Sector Dashboard

**Files:**
- Modify: `src/features/workbench/Workbench.tsx`
- Test: `src/features/workbench/Workbench.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing workbench tests**

Replace editor/row-expansion expectations with tests that assert:

```ts
expect(screen.queryByRole("button", { name: "New Watchlist" })).not.toBeInTheDocument();
expect(screen.getByRole("table", { name: "API usage summary" })).toBeInTheDocument();
expect(fetchSnapshots).toHaveBeenCalledWith(["NVDA", "AMD", "ASML"]);
expect(screen.getByRole("columnheader", { name: "Dollar Volume" })).toBeInTheDocument();
expect(screen.getByText("$39.1B")).toBeInTheDocument();
```

Add sorting/pagination tests:

```ts
await user.selectOptions(screen.getByLabelText("Sort by"), "heat");
expect(screen.getAllByRole("button", { name: /^[A-Z.-]+$/ })[0]).toHaveTextContent("NVDA");

expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Next page" }));
expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
```

Add off-canvas tests:

```ts
await user.click(screen.getByRole("button", { name: "NVDA" }));
expect(await screen.findByRole("dialog", { name: "NVDA details" })).toBeInTheDocument();
expect(getHistory).toHaveBeenCalledWith("NVDA", "1h");
await user.click(screen.getByRole("button", { name: "Close details" }));
expect(screen.queryByRole("dialog", { name: "NVDA details" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run src/features/workbench/Workbench.test.tsx
```

Expected: FAIL because the old row dashboard/editor/detail layout is still active.

- [ ] **Step 3: Implement sector dashboard**

In `Workbench.tsx`:

- Remove `WatchlistEditor` import and all save/recommend/editor state.
- Set initial `intervalSeconds` to `3_600`.
- Set initial `selectedRange` to `"1h"`.
- Replace expanded-row active symbols with flattened selected-sector symbols.
- Add state for `sortMode`, `currentPage`, and `pageSize`.
- Derive `sortedSymbols`, `pageSymbols`, `trackedSymbolCount`, `todayApiCalls`, and `historicalApiCalls`.
- Render a stats table, sort selector, pagination controls, and one full-width quote table.
- Render symbol detail as an off-canvas dialog only when `selectedSymbol` is set.

Use sort mode ids:

```ts
type SortMode = "config" | "size" | "heat" | "volume" | "changePercent" | "price" | "updated";
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npx vitest run src/features/workbench/Workbench.test.tsx
```

Expected: PASS.

## Task 5: Expanded Watchlist Configuration

**Files:**
- Modify: `config/watchlists.yaml`
- Test: `server/config/configRepository.test.ts`

- [ ] **Step 1: Write a config parsing regression test**

Add an assertion that the default config includes 11 watchlists and more than 200 unique symbols:

```ts
const repository = new ConfigRepository();
const watchlists = await repository.readWatchlists();
const symbols = new Set(watchlists.watchlists.flatMap((watchlist) => watchlist.rows.flatMap((row) => row.symbols)));

expect(watchlists.watchlists).toHaveLength(11);
expect(symbols.size).toBeGreaterThan(200);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run server/config/configRepository.test.ts
```

Expected: FAIL because the YAML currently only has semiconductors.

- [ ] **Step 3: Expand `config/watchlists.yaml`**

Add 11 file-backed watchlists:

```yaml
watchlists:
  - id: semiconductors
    name: Semiconductors
    rows:
      - id: core
        name: Core
        expandedByDefault: true
        symbols: [NVDA, AMD, AVGO, TSM, ASML, AMAT, LRCX, KLAC, MU, QCOM, TXN, INTC, MRVL, ADI, MCHP, ON, NXPI, MPWR, ARM, GFS]
```

Then add the remaining sectors from the spec with similarly broad symbol arrays.

- [ ] **Step 4: Run test and verify pass**

Run:

```bash
npx vitest run server/config/configRepository.test.ts
```

Expected: PASS.

## Task 6: E2E Dashboard Flow

**Files:**
- Modify: `tests/e2e/workbench.spec.ts`

- [ ] **Step 1: Update failing e2e coverage**

Change the test to assert:

```ts
await expect(page.getByRole("button", { name: "New Watchlist" })).toHaveCount(0);
await expect(page.getByRole("table", { name: "API usage summary" })).toBeVisible();
await page.getByLabel("Sort by").selectOption("heat");
await page.getByRole("button", { name: "Next page" }).click();
await page.getByRole("button", { name: "NVDA" }).click();
await expect(page.getByRole("dialog", { name: "NVDA details" })).toBeVisible();
await page.getByRole("button", { name: "5y" }).click();
```

- [ ] **Step 2: Run e2e test and verify failure**

Run:

```bash
npx playwright test tests/e2e/workbench.spec.ts
```

Expected: FAIL before implementation is fully wired.

- [ ] **Step 3: Update mocks and assertions**

Update mocked config to include enough symbols for pagination, remove recommendation/save route expectations, and assert no unexpected API requests.

- [ ] **Step 4: Run e2e test and verify pass**

Run:

```bash
npx playwright test tests/e2e/workbench.spec.ts
```

Expected: PASS.

## Task 7: Full Verification And Browser QA

**Files:**
- No direct file changes unless verification reveals issues.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npx vitest run src/features/settings/RefreshControls.test.tsx src/features/charts/SymbolChart.test.tsx src/features/workbench/Workbench.test.tsx server/routes/marketRoutes.test.ts server/market/marketDataProvider.test.ts server/rate/ratePlanner.test.ts server/config/configRepository.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run e2e**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Start dev server and inspect UI**

Run:

```bash
npm run dev
```

Expected: local app available at `http://127.0.0.1:5173`.

Use browser automation to verify the stats table, sector buttons, full-width dashboard, sort/pagination controls, and off-canvas detail panel at desktop and mobile widths.

## Self-Review

- Spec coverage: all requirements from `docs/superpowers/specs/2026-05-24-stock-workbench-expanded-sectors-design.md` map to tasks 1-7.
- Placeholder scan: this plan contains no unfinished markers.
- Type consistency: range labels, sort mode ids, interval seconds, and affected files are consistent across tasks.
