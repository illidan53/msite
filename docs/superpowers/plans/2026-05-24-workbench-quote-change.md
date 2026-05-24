# Workbench Quote Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate names and separate session change from time-span change in the stock workbench.

**Architecture:** Keep snapshot enrichment server-side so every client gets consistent names and session-change math. Compute span change client-side from history series for visible symbols only, reusing the selected time-span data model already used by the off-canvas chart.

**Tech Stack:** TypeScript, Express, React, Vitest, Testing Library, Playwright.

---

### Task 1: Snapshot Names And Session Change

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/market/marketDataProvider.ts`
- Test: `server/market/marketDataProvider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add a test where snapshot lacks `name`, reference ticker details returns `NVIDIA Corporation`, and the DTO includes that name. Add a test where `day.c=0`, `prevDay.c=110`, and recent daily aggregates contain closes `100` and `110`; the DTO should expose `price=110`, `sessionChange=10`, and `sessionChangePercent=10`.

- [ ] **Step 2: Run provider tests and verify red**

Run: `npm test -- server/market/marketDataProvider.test.ts`

Expected: new tests fail because `MarketSnapshot` has no session fields and `getSnapshots` does not enrich names or compute previous-close fallback change.

- [ ] **Step 3: Add snapshot fields and enrichment**

Update `MarketSnapshot` with `sessionChange`, `sessionChangePercent`, optional `spanChange`, optional `spanChangePercent`, and optional `asOfSource`. In `getSnapshots`, fetch the snapshot response, map basic snapshots, then fill missing names from `/v3/reference/tickers/{symbol}` with an in-memory metadata cache. For `PREVIOUS_CLOSE`, fetch recent daily aggregates and compute the prior close before the displayed close.

- [ ] **Step 4: Verify provider tests pass**

Run: `npm test -- server/market/marketDataProvider.test.ts`

Expected: all provider tests pass.

### Task 2: Table Columns And Span Move

**Files:**
- Modify: `src/features/workbench/Workbench.tsx`
- Test: `src/features/workbench/Workbench.test.tsx`

- [ ] **Step 1: Write failing workbench tests**

Add assertions for `Session Chg`, `Session Chg %`, `Span Chg`, and `Span Chg %` headers. Add a test where the visible page history gives `AMD` a larger selected-span move than `NVDA`; selecting Heat should put `AMD` first.

- [ ] **Step 2: Run workbench tests and verify red**

Run: `npm test -- src/features/workbench/Workbench.test.tsx`

Expected: tests fail because the UI still uses `Change`/`Change %` and heat sort only reads snapshot change percent.

- [ ] **Step 3: Implement span history cache and columns**

Request history for visible-page symbols when `selectedRange`, active sector, page, or page size changes. Store span metrics by `symbol:range`. Render session change from snapshot fields, render span change from the cache, and fall back heat sorting to session change until span metrics are available.

- [ ] **Step 4: Verify workbench tests pass**

Run: `npm test -- src/features/workbench/Workbench.test.tsx`

Expected: all workbench tests pass.

### Task 3: Integration Verification And Release

**Files:**
- Modify as needed: `tests/e2e/workbench.spec.ts`

- [ ] **Step 1: Update e2e expectations**

Ensure the local e2e smoke verifies one toolbar, no `Live workspace`, visible session/span columns, and populated names.

- [ ] **Step 2: Run full verification**

Run: `npm run lint && npm test && npm run build && npm run test:e2e`

Expected: lint exits 0, all Vitest suites pass, build exits 0, local Playwright workbench test passes and public smoke skips unless `MSITE_PUBLIC_BASE_URL` is set.

- [ ] **Step 3: Deploy**

Push `main`, upload a release tarball containing `dist`, `config`, `package.json`, and `package-lock.json`, then restart `msite.service` through SSM and verify `/api/health`.
