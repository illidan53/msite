# Stock Workbench MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Vite React + Express stock workbench that loads/edit YAML watchlists, proxies Polygon/Massive market data through a server-only API key, pauses polling for collapsed rows, shows quote tables and charts, and supports dynamic watchlist recommendations.

**Architecture:** The app is a single TypeScript repository with a React frontend under `src/`, an Express API under `server/`, shared DTO/schema modules under `shared/`, and YAML configuration under `config/`. The backend owns config writes, auth, Polygon calls, caching, rate planning, and recommendation scoring; the frontend owns workbench state, polling intent, editing flows, and chart display.

**Tech Stack:** Node 20+, TypeScript, Vite, React, Express, Zod, YAML, Vitest, React Testing Library, Supertest, Playwright, lightweight-charts, lucide-react.

---

## Source References

- Polygon/Massive Full Market Snapshot supports comma-separated stock tickers through `/v2/snapshot/locale/us/markets/stocks/tickers` and is 15-minute delayed on Stocks Starter.
- Polygon/Massive Custom Bars uses `/v2/aggs/ticker/{stocksTicker}/range/{multiplier}/{timespan}/{from}/{to}` for OHLC history and is 15-minute delayed with 5 years of history on Stocks Starter.
- Polygon/Massive Ticker Overview uses `/v3/reference/tickers/{ticker}` and includes market capitalization and company metadata.
- Polygon/Massive All Tickers uses `/v3/reference/tickers` for ticker discovery and reference data.
- Polygon/Massive Related Tickers uses `/v1/related-companies/{ticker}` for peer discovery.

## File Structure

Create these files:

- `.gitignore`: ignore dependencies, builds, coverage, Playwright reports, local env files, and config backups.
- `package.json`: root scripts and dependencies for frontend, backend, unit tests, and Playwright.
- `tsconfig.base.json`: shared strict TypeScript settings.
- `tsconfig.json`: frontend TypeScript project.
- `tsconfig.server.json`: backend TypeScript project.
- `vite.config.ts`: Vite React config with `/api` proxy to Express in development.
- `vitest.config.ts`: Vitest config for Node and jsdom tests.
- `playwright.config.ts`: Playwright web server and browser settings.
- `index.html`: Vite entry shell.
- `config/watchlists.yaml`: seed watchlists.
- `config/settings.yaml`: seed settings with `paid / stocks-starter`.
- `shared/types.ts`: DTO and domain TypeScript types.
- `shared/schemas.ts`: Zod schemas and parsing helpers.
- `server/index.ts`: Express server entrypoint.
- `server/app.ts`: Express app factory.
- `server/http/apiError.ts`: structured API error helpers.
- `server/http/authGuard.ts`: production write-token guard.
- `server/config/configPaths.ts`: config path resolution.
- `server/config/configRepository.ts`: YAML read/write repository.
- `server/config/configRepository.test.ts`: repository tests.
- `server/rate/ratePlanner.ts`: refresh budget evaluator.
- `server/rate/ratePlanner.test.ts`: rate planner tests.
- `server/market/memoryCache.ts`: TTL cache utility.
- `server/market/polygonClient.ts`: low-level Polygon REST client.
- `server/market/marketDataProvider.ts`: snapshot/history/reference data provider.
- `server/market/marketDataProvider.test.ts`: Polygon mapping and error tests.
- `server/recommendations/recommendationService.ts`: candidate scoring.
- `server/recommendations/recommendationService.test.ts`: recommendation tests.
- `server/routes/configRoutes.ts`: config API routes.
- `server/routes/marketRoutes.ts`: market API routes.
- `server/routes/recommendationRoutes.ts`: recommendation API routes.
- `server/routes/rateRoutes.ts`: rate-plan API routes.
- `server/routes/routes.test.ts`: Supertest API integration tests.
- `src/main.tsx`: React entrypoint.
- `src/App.tsx`: top-level app component.
- `src/styles.css`: application styling.
- `src/test/setup.ts`: Testing Library setup.
- `src/test/lightweightChartsMock.ts`: chart library mock.
- `src/shared/apiClient.ts`: frontend API client.
- `src/features/settings/RefreshControls.tsx`: refresh interval selector and warnings.
- `src/features/settings/RefreshControls.test.tsx`: refresh control tests.
- `src/features/charts/SymbolChart.tsx`: trend and candlestick chart.
- `src/features/charts/SymbolChart.test.tsx`: chart mode tests.
- `src/features/watchlists/WatchlistEditor.tsx`: create/edit drawer.
- `src/features/watchlists/WatchlistEditor.test.tsx`: edit and recommendation flow tests.
- `src/features/workbench/Workbench.tsx`: main workbench layout and polling state.
- `src/features/workbench/Workbench.test.tsx`: row collapse and active sync tests.
- `tests/e2e/workbench.spec.ts`: Playwright end-to-end smoke.
- `README.md`: local setup and safe secret handling.

Modify these files:

- `docs/superpowers/specs/2026-05-23-stock-workbench-mvp-design.md`: no behavior change required; link the implementation plan if desired during execution.

---

### Task 1: Project Tooling And Health Smoke

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `server/app.ts`
- Create: `server/index.ts`
- Create: `server/app.test.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Write the failing health test**

Create `server/app.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("createApp", () => {
  it("returns a health response without exposing secrets", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "stock-workbench-api",
    });
    expect(JSON.stringify(response.body)).not.toContain("POLYGON_API_KEY");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- server/app.test.ts
```

Expected: command fails because `package.json` and the test runner are not installed yet.

- [ ] **Step 3: Create project tooling**

Create `package.json` with these scripts and dependencies:

```json
{
  "name": "msite",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k -n api,web \"tsx watch server/index.ts\" \"vite --host 127.0.0.1\"",
    "build": "tsup server/index.ts --format esm --platform node --out-dir dist/server --clean && vite build",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lint": "tsc --noEmit && tsc -p tsconfig.server.json --noEmit"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "cors": "^2.8.5",
    "date-fns": "^4.1.0",
    "express": "^5.1.0",
    "lightweight-charts": "^5.0.0",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "yaml": "^2.8.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.0",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.3",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/supertest": "^6.0.3",
    "@vitejs/plugin-react": "^5.0.0",
    "concurrently": "^9.2.0",
    "jsdom": "^26.0.0",
    "supertest": "^7.1.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
.env.*
*.local
config/*.bak
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  }
}
```

Create `tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["src", "shared", "vite.config.ts", "vitest.config.ts"]
}
```

Create `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["server", "shared"]
}
```

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
```

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      ["src/**/*.test.ts", "jsdom"],
      ["server/**/*.test.ts", "node"],
      ["shared/**/*.test.ts", "node"],
    ],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stock Workbench</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Implement the minimal app shell**

Create `server/app.ts`:

```ts
import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "stock-workbench-api" });
  });

  return app;
}
```

Create `server/index.ts`:

```ts
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

createApp().listen(port, host, () => {
  console.log(`stock-workbench-api listening on http://${host}:${port}`);
});
```

Create `src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <h1>Stock Workbench</h1>
      <p>Loading watchlists...</p>
    </main>
  );
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `src/styles.css`:

```css
:root {
  color: #182026;
  background: #f6f7f9;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
}
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
npm install
```

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 6: Run health test and type checks**

Run:

```bash
npm test -- server/app.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.base.json tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts playwright.config.ts index.html server src
git commit -m "chore: scaffold stock workbench app"
```

---

### Task 2: Shared Schemas And Seed Configuration

**Files:**
- Create: `shared/types.ts`
- Create: `shared/schemas.ts`
- Create: `shared/schemas.test.ts`
- Create: `config/watchlists.yaml`
- Create: `config/settings.yaml`

- [ ] **Step 1: Write failing schema tests**

Create `shared/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSettingsConfig, parseWatchlistsConfig } from "./schemas";

describe("shared config schemas", () => {
  it("parses seed watchlists with rows and pinned symbols", () => {
    const parsed = parseWatchlistsConfig({
      watchlists: [
        {
          id: "semis",
          name: "Semiconductors",
          description: "Large semiconductor names",
          theme: "semiconductors",
          pinnedSymbols: ["NVDA", "AMD"],
          rows: [
            {
              id: "leaders",
              name: "Leaders",
              expandedByDefault: true,
              symbols: ["NVDA", "AMD", "AVGO"],
            },
          ],
        },
      ],
    });

    expect(parsed.watchlists[0].rows[0].symbols).toEqual(["NVDA", "AMD", "AVGO"]);
  });

  it("defaults Polygon to paid Stocks Starter", () => {
    const parsed = parseSettingsConfig({
      polygon: {
        plan: "paid",
        paidPlanName: "stocks-starter",
        warningThreshold: 0.75,
        hardThreshold: 0.95,
      },
    });

    expect(parsed.polygon.plan).toBe("paid");
    expect(parsed.polygon.paidPlanName).toBe("stocks-starter");
  });

  it("rejects an empty watchlist row", () => {
    expect(() =>
      parseWatchlistsConfig({
        watchlists: [
          {
            id: "bad",
            name: "Bad",
            pinnedSymbols: [],
            rows: [{ id: "empty", name: "Empty", symbols: [] }],
          },
        ],
      }),
    ).toThrow(/symbols/i);
  });
});
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run:

```bash
npm test -- shared/schemas.test.ts
```

Expected: fail because `shared/schemas.ts` does not exist.

- [ ] **Step 3: Create shared types and schemas**

Create `shared/types.ts`:

```ts
export type PolygonPlan = "free" | "paid" | "custom";

export interface SettingsConfig {
  polygon: {
    plan: PolygonPlan;
    paidPlanName?: string;
    customCallsPerMinute?: number;
    warningThreshold: number;
    hardThreshold: number;
  };
}

export interface WatchlistRow {
  id: string;
  name: string;
  expandedByDefault: boolean;
  symbols: string[];
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
  theme?: string;
  pinnedSymbols: string[];
  rows: WatchlistRow[];
}

export interface WatchlistsConfig {
  watchlists: Watchlist[];
}

export interface MarketSnapshot {
  symbol: string;
  name?: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  updatedAt: string | null;
  timeframe: "DELAYED" | "REAL-TIME" | "UNKNOWN";
}

export interface PriceBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceSeries {
  symbol: string;
  range: "1D" | "5D" | "1M" | "3M" | "1Y";
  bars: PriceBar[];
}

export interface RatePlanEvaluation {
  status: "ok" | "warning" | "blocked";
  plan: PolygonPlan;
  intervalSeconds: number;
  estimatedCallsPerMinute: number;
  message: string;
  disabledIntervals: number[];
}

export interface RecommendationCandidate {
  symbol: string;
  name?: string;
  score: number;
  reasons: string[];
  source: "related" | "reference" | "pinned";
}
```

Create `shared/schemas.ts`:

```ts
import { z } from "zod";
import type { SettingsConfig, WatchlistsConfig } from "./types";

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toUpperCase());

const watchlistRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  expandedByDefault: z.boolean().default(true),
  symbols: z.array(symbolSchema).min(1),
});

const watchlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  theme: z.string().optional(),
  pinnedSymbols: z.array(symbolSchema).default([]),
  rows: z.array(watchlistRowSchema).min(1),
});

export const watchlistsConfigSchema = z.object({
  watchlists: z.array(watchlistSchema).min(1),
});

export const settingsConfigSchema = z.object({
  polygon: z
    .object({
      plan: z.enum(["free", "paid", "custom"]).default("paid"),
      paidPlanName: z.string().default("stocks-starter"),
      customCallsPerMinute: z.number().positive().optional(),
      warningThreshold: z.number().min(0.1).max(1).default(0.75),
      hardThreshold: z.number().min(0.1).max(1).default(0.95),
    })
    .refine((value) => value.warningThreshold < value.hardThreshold, {
      message: "warningThreshold must be lower than hardThreshold",
    }),
});

export function parseWatchlistsConfig(input: unknown): WatchlistsConfig {
  return watchlistsConfigSchema.parse(input);
}

export function parseSettingsConfig(input: unknown): SettingsConfig {
  return settingsConfigSchema.parse(input);
}
```

Create `config/watchlists.yaml`:

```yaml
watchlists:
  - id: semiconductors
    name: Semiconductors
    description: Large semiconductor names and user focus list
    theme: semiconductors
    pinnedSymbols:
      - NVDA
      - AMD
    rows:
      - id: leaders
        name: Leaders
        expandedByDefault: true
        symbols:
          - NVDA
          - AMD
          - AVGO
      - id: equipment
        name: Equipment
        expandedByDefault: false
        symbols:
          - ASML
          - AMAT
          - LRCX
```

Create `config/settings.yaml`:

```yaml
polygon:
  plan: paid
  paidPlanName: stocks-starter
  warningThreshold: 0.75
  hardThreshold: 0.95
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
npm test -- shared/schemas.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add shared config
git commit -m "feat: define stock workbench schemas"
```

---

### Task 3: Config Repository And Secure Config Routes

**Files:**
- Create: `server/config/configPaths.ts`
- Create: `server/config/configRepository.ts`
- Create: `server/config/configRepository.test.ts`
- Create: `server/http/apiError.ts`
- Create: `server/http/authGuard.ts`
- Create: `server/routes/configRoutes.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing repository and route tests**

Create `server/config/configRepository.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { ConfigRepository } from "./configRepository";

let tempDir: string | undefined;

async function makeConfigDir() {
  tempDir = await mkdtemp(path.join(tmpdir(), "msite-config-"));
  await writeFile(
    path.join(tempDir, "watchlists.yaml"),
    "watchlists:\n  - id: test\n    name: Test\n    pinnedSymbols: [AAPL]\n    rows:\n      - id: core\n        name: Core\n        expandedByDefault: true\n        symbols: [AAPL, MSFT]\n",
  );
  await writeFile(
    path.join(tempDir, "settings.yaml"),
    "polygon:\n  plan: paid\n  paidPlanName: stocks-starter\n  warningThreshold: 0.75\n  hardThreshold: 0.95\n",
  );
  return tempDir;
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("ConfigRepository", () => {
  it("reads watchlists and settings from YAML", async () => {
    const configDir = await makeConfigDir();
    const repo = new ConfigRepository(configDir);

    const config = await repo.readConfig();

    expect(config.watchlists.watchlists[0].rows[0].symbols).toEqual(["AAPL", "MSFT"]);
    expect(config.settings.polygon.plan).toBe("paid");
  });

  it("writes watchlists atomically and keeps a backup", async () => {
    const configDir = await makeConfigDir();
    const repo = new ConfigRepository(configDir);
    const current = await repo.readConfig();

    await repo.writeWatchlists({
      watchlists: [
        {
          ...current.watchlists.watchlists[0],
          rows: [{ id: "core", name: "Core", expandedByDefault: true, symbols: ["NVDA"] }],
        },
      ],
    });

    const saved = await repo.readConfig();
    const backup = await readFile(path.join(configDir, "watchlists.yaml.bak"), "utf8");
    expect(saved.watchlists.watchlists[0].rows[0].symbols).toEqual(["NVDA"]);
    expect(backup).toContain("AAPL");
  });
});

describe("config routes", () => {
  it("allows local watchlist writes without token", async () => {
    const configDir = await makeConfigDir();
    const app = createApp({ configDir, nodeEnv: "development" });

    const response = await request(app)
      .put("/api/config/watchlists")
      .send({
        watchlists: [
          {
            id: "edited",
            name: "Edited",
            pinnedSymbols: ["NVDA"],
            rows: [{ id: "core", name: "Core", expandedByDefault: true, symbols: ["NVDA"] }],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.watchlists[0].id).toBe("edited");
  });

  it("requires APP_ADMIN_TOKEN for production writes", async () => {
    const configDir = await makeConfigDir();
    const app = createApp({ configDir, nodeEnv: "production", adminToken: "secret-token" });

    const response = await request(app)
      .put("/api/config/watchlists")
      .send({
        watchlists: [
          {
            id: "edited",
            name: "Edited",
            pinnedSymbols: ["NVDA"],
            rows: [{ id: "core", name: "Core", expandedByDefault: true, symbols: ["NVDA"] }],
          },
        ],
      });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- server/config/configRepository.test.ts
```

Expected: fail because config repository and app options do not exist.

- [ ] **Step 3: Implement structured API errors and auth guard**

Create `server/http/apiError.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly source = "api",
    public readonly retryAfter?: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(400, "VALIDATION_ERROR", "Configuration validation failed", "config", undefined, error.issues);
  }
  if (error instanceof Error) return new ApiError(500, "INTERNAL_ERROR", error.message);
  return new ApiError(500, "INTERNAL_ERROR", "Unknown server error");
}

export function apiErrorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const apiError = toApiError(error);
  res.status(apiError.status).json({
    code: apiError.code,
    message: apiError.message,
    source: apiError.source,
    retryAfter: apiError.retryAfter,
    details: apiError.details,
  });
}
```

Create `server/http/authGuard.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./apiError";

interface AuthOptions {
  nodeEnv: string;
  adminToken?: string;
}

export function requireAdminToken(options: AuthOptions) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (options.nodeEnv !== "production") {
      next();
      return;
    }

    if (!options.adminToken) {
      next(new ApiError(500, "ADMIN_TOKEN_MISSING", "APP_ADMIN_TOKEN is required in production", "auth"));
      return;
    }

    const header = req.header("x-admin-token");
    if (header !== options.adminToken) {
      next(new ApiError(401, "UNAUTHORIZED", "Admin token is required", "auth"));
      return;
    }

    next();
  };
}
```

- [ ] **Step 4: Implement config repository and routes**

Create `server/config/configPaths.ts`:

```ts
import path from "node:path";

export function defaultConfigDir() {
  return path.resolve(process.cwd(), "config");
}
```

Create `server/config/configRepository.ts`:

```ts
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseSettingsConfig, parseWatchlistsConfig } from "../../shared/schemas";
import type { SettingsConfig, WatchlistsConfig } from "../../shared/types";

export class ConfigRepository {
  constructor(private readonly configDir: string) {}

  async readConfig(): Promise<{ watchlists: WatchlistsConfig; settings: SettingsConfig }> {
    const [watchlistsRaw, settingsRaw] = await Promise.all([
      readFile(path.join(this.configDir, "watchlists.yaml"), "utf8"),
      readFile(path.join(this.configDir, "settings.yaml"), "utf8"),
    ]);

    return {
      watchlists: parseWatchlistsConfig(YAML.parse(watchlistsRaw)),
      settings: parseSettingsConfig(YAML.parse(settingsRaw)),
    };
  }

  async writeWatchlists(input: WatchlistsConfig): Promise<WatchlistsConfig> {
    const parsed = parseWatchlistsConfig(input);
    const target = path.join(this.configDir, "watchlists.yaml");
    const backup = `${target}.bak`;
    const temp = `${target}.tmp`;
    const serialized = YAML.stringify(parsed);

    await copyFile(target, backup).catch(() => undefined);
    await writeFile(temp, serialized, "utf8");
    await rename(temp, target);

    return parsed;
  }
}
```

Create `server/routes/configRoutes.ts`:

```ts
import { Router } from "express";
import { requireAdminToken } from "../http/authGuard";
import type { ConfigRepository } from "../config/configRepository";

interface ConfigRoutesOptions {
  repo: ConfigRepository;
  nodeEnv: string;
  adminToken?: string;
}

export function createConfigRoutes(options: ConfigRoutesOptions) {
  const router = Router();
  const guard = requireAdminToken({ nodeEnv: options.nodeEnv, adminToken: options.adminToken });

  router.get("/config", async (_req, res, next) => {
    try {
      res.json(await options.repo.readConfig());
    } catch (error) {
      next(error);
    }
  });

  router.get("/watchlists", async (_req, res, next) => {
    try {
      const config = await options.repo.readConfig();
      res.json(config.watchlists);
    } catch (error) {
      next(error);
    }
  });

  router.put("/config/watchlists", guard, async (req, res, next) => {
    try {
      res.json(await options.repo.writeWatchlists(req.body));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Modify `server/app.ts`:

```ts
import express from "express";
import { ConfigRepository } from "./config/configRepository";
import { defaultConfigDir } from "./config/configPaths";
import { apiErrorHandler } from "./http/apiError";
import { createConfigRoutes } from "./routes/configRoutes";

export interface AppOptions {
  configDir?: string;
  nodeEnv?: string;
  adminToken?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const adminToken = options.adminToken ?? process.env.APP_ADMIN_TOKEN;
  const repo = new ConfigRepository(options.configDir ?? defaultConfigDir());

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "stock-workbench-api" });
  });

  app.use("/api", createConfigRoutes({ repo, nodeEnv, adminToken }));
  app.use(apiErrorHandler);

  return app;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- server/config/configRepository.test.ts server/app.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add server/config server/http server/routes/configRoutes.ts server/app.ts server/config/configRepository.test.ts
git commit -m "feat: add YAML config repository"
```

---

### Task 4: Rate Planner

**Files:**
- Create: `server/rate/ratePlanner.ts`
- Create: `server/rate/ratePlanner.test.ts`
- Create: `server/routes/rateRoutes.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing rate planner tests**

Create `server/rate/ratePlanner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateRatePlan } from "./ratePlanner";

describe("evaluateRatePlan", () => {
  it("keeps paid Stocks Starter enabled while warning about aggressive local load", () => {
    const result = evaluateRatePlan({
      plan: "paid",
      paidPlanName: "stocks-starter",
      warningThreshold: 0.75,
      hardThreshold: 0.95,
      activeSymbolCount: 75,
      intervalSeconds: 5,
      endpointCount: 1,
      cacheHitRatio: 0.2,
    });

    expect(result.status).toBe("warning");
    expect(result.message).toContain("Stocks Starter");
    expect(result.disabledIntervals).toEqual([]);
  });

  it("blocks a free-plan interval that exceeds 5 REST calls per minute", () => {
    const result = evaluateRatePlan({
      plan: "free",
      warningThreshold: 0.75,
      hardThreshold: 0.95,
      activeSymbolCount: 10,
      intervalSeconds: 10,
      endpointCount: 1,
      cacheHitRatio: 0,
    });

    expect(result.status).toBe("blocked");
    expect(result.estimatedCallsPerMinute).toBe(6);
    expect(result.disabledIntervals).toContain(10);
  });

  it("uses custom call budgets", () => {
    const result = evaluateRatePlan({
      plan: "custom",
      customCallsPerMinute: 60,
      warningThreshold: 0.75,
      hardThreshold: 0.95,
      activeSymbolCount: 20,
      intervalSeconds: 30,
      endpointCount: 2,
      cacheHitRatio: 0.25,
    });

    expect(result.status).toBe("warning");
    expect(result.estimatedCallsPerMinute).toBe(60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- server/rate/ratePlanner.test.ts
```

Expected: fail because `server/rate/ratePlanner.ts` does not exist.

- [ ] **Step 3: Implement rate planner and route**

Create `server/rate/ratePlanner.ts`:

```ts
import type { PolygonPlan, RatePlanEvaluation } from "../../shared/types";

export interface RatePlanInput {
  plan: PolygonPlan;
  paidPlanName?: string;
  customCallsPerMinute?: number;
  warningThreshold: number;
  hardThreshold: number;
  activeSymbolCount: number;
  intervalSeconds: number;
  endpointCount: number;
  cacheHitRatio: number;
}

const INTERVALS = [5, 10, 15, 30, 60, 120, 300];

function estimateCallsPerMinute(input: RatePlanInput, intervalSeconds: number) {
  const callsPerTick = Math.max(1, input.endpointCount);
  const ticksPerMinute = 60 / intervalSeconds;
  const cacheMultiplier = 1 - Math.min(Math.max(input.cacheHitRatio, 0), 0.95);
  return Math.ceil(callsPerTick * ticksPerMinute * cacheMultiplier);
}

function budgetFor(input: RatePlanInput) {
  if (input.plan === "free") return 5;
  if (input.plan === "custom") return input.customCallsPerMinute ?? 60;
  return Number.POSITIVE_INFINITY;
}

export function evaluateRatePlan(input: RatePlanInput): RatePlanEvaluation {
  const estimatedCallsPerMinute = estimateCallsPerMinute(input, input.intervalSeconds);
  const budget = budgetFor(input);
  const ratio = budget === Number.POSITIVE_INFINITY ? 0 : estimatedCallsPerMinute / budget;
  const localLoadWarning = input.plan === "paid" && input.activeSymbolCount >= 50 && input.intervalSeconds <= 10;

  const disabledIntervals =
    budget === Number.POSITIVE_INFINITY
      ? []
      : INTERVALS.filter((interval) => estimateCallsPerMinute(input, interval) / budget >= input.hardThreshold);

  if (ratio >= input.hardThreshold) {
    return {
      status: "blocked",
      plan: input.plan,
      intervalSeconds: input.intervalSeconds,
      estimatedCallsPerMinute,
      disabledIntervals,
      message: `This interval exceeds the configured ${input.plan} REST call budget.`,
    };
  }

  if (ratio >= input.warningThreshold || localLoadWarning) {
    return {
      status: "warning",
      plan: input.plan,
      intervalSeconds: input.intervalSeconds,
      estimatedCallsPerMinute,
      disabledIntervals,
      message:
        input.plan === "paid"
          ? `${input.paidPlanName ?? "paid plan"} has unlimited REST calls, but this interval is aggressive for local refresh load.`
          : "This interval is close to the configured REST call budget.",
    };
  }

  return {
    status: "ok",
    plan: input.plan,
    intervalSeconds: input.intervalSeconds,
    estimatedCallsPerMinute,
    disabledIntervals,
    message: "Refresh interval is within the configured budget.",
  };
}
```

Create `server/routes/rateRoutes.ts`:

```ts
import { Router } from "express";
import { evaluateRatePlan } from "../rate/ratePlanner";

export function createRateRoutes() {
  const router = Router();

  router.post("/rate-plan/evaluate", (req, res, next) => {
    try {
      res.json(evaluateRatePlan(req.body));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Modify `server/app.ts` to import and mount the route:

```ts
import { createRateRoutes } from "./routes/rateRoutes";

// inside createApp, before apiErrorHandler:
app.use("/api", createRateRoutes());
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- server/rate/ratePlanner.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server/rate server/routes/rateRoutes.ts server/app.ts
git commit -m "feat: add refresh rate planner"
```

---

### Task 5: Polygon Market Data Provider

**Files:**
- Create: `server/market/memoryCache.ts`
- Create: `server/market/polygonClient.ts`
- Create: `server/market/marketDataProvider.ts`
- Create: `server/market/marketDataProvider.test.ts`

- [ ] **Step 1: Write failing market provider tests**

Create `server/market/marketDataProvider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MarketDataProvider } from "./marketDataProvider";
import { PolygonClient } from "./polygonClient";

describe("MarketDataProvider", () => {
  it("maps snapshot responses to MarketSnapshot DTOs", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          tickers: [
            {
              ticker: "NVDA",
              todaysChange: 12.34,
              todaysChangePerc: 2.5,
              updated: 1716400000000,
              day: { c: 950, v: 123456 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const snapshots = await provider.getSnapshots(["NVDA"]);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/snapshot/locale/us/markets/stocks/tickers?tickers=NVDA"),
      expect.any(Object),
    );
    expect(snapshots[0]).toMatchObject({
      symbol: "NVDA",
      price: 950,
      change: 12.34,
      changePercent: 2.5,
      volume: 123456,
      timeframe: "DELAYED",
    });
  });

  it("maps aggregate bars to PriceSeries", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ticker: "AAPL",
          results: [{ t: 1716400000000, o: 190, h: 195, l: 188, c: 194, v: 1000 }],
        }),
        { status: 200 },
      ),
    );
    const provider = new MarketDataProvider(new PolygonClient("test-key", fetcher));

    const series = await provider.getHistory({ symbol: "AAPL", range: "1M" });

    expect(series.symbol).toBe("AAPL");
    expect(series.bars[0]).toMatchObject({ open: 190, high: 195, low: 188, close: 194, volume: 1000 });
  });

  it("throws a structured error when the API key is missing", async () => {
    const provider = new MarketDataProvider(new PolygonClient("", fetch));

    await expect(provider.getSnapshots(["AAPL"])).rejects.toMatchObject({
      code: "POLYGON_API_KEY_MISSING",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- server/market/marketDataProvider.test.ts
```

Expected: fail because market provider files do not exist.

- [ ] **Step 3: Implement cache, Polygon client, and provider**

Create `server/market/memoryCache.ts`:

```ts
export class MemoryCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
```

Create `server/market/polygonClient.ts`:

```ts
import { ApiError } from "../http/apiError";

type Fetcher = typeof fetch;

export class PolygonClient {
  private readonly baseUrl = "https://api.polygon.io";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async getJson<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    if (!this.apiKey) {
      throw new ApiError(503, "POLYGON_API_KEY_MISSING", "POLYGON_API_KEY is not configured", "polygon");
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("apiKey", this.apiKey);

    const response = await this.fetcher(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new ApiError(response.status, "POLYGON_REQUEST_FAILED", "Polygon request failed", "polygon");
    }
    return (await response.json()) as T;
  }
}
```

Create `server/market/marketDataProvider.ts`:

```ts
import type { MarketSnapshot, PriceSeries } from "../../shared/types";
import { MemoryCache } from "./memoryCache";
import type { PolygonClient } from "./polygonClient";

interface SnapshotResponse {
  tickers?: Array<{
    ticker?: string;
    todaysChange?: number;
    todaysChangePerc?: number;
    updated?: number;
    day?: { c?: number; v?: number };
  }>;
}

interface AggsResponse {
  ticker?: string;
  results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
}

export class MarketDataProvider {
  private readonly snapshotCache = new MemoryCache<MarketSnapshot[]>();
  private readonly historyCache = new MemoryCache<PriceSeries>();

  constructor(private readonly client: PolygonClient) {}

  async getSnapshots(symbols: string[]): Promise<MarketSnapshot[]> {
    const normalized = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort();
    const cacheKey = `snapshots:${normalized.join(",")}`;
    const cached = this.snapshotCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.client.getJson<SnapshotResponse>("/v2/snapshot/locale/us/markets/stocks/tickers", {
      tickers: normalized.join(","),
    });
    const snapshots =
      response.tickers?.map((ticker) => ({
        symbol: ticker.ticker ?? "",
        price: ticker.day?.c ?? null,
        change: ticker.todaysChange ?? null,
        changePercent: ticker.todaysChangePerc ?? null,
        volume: ticker.day?.v ?? null,
        updatedAt: ticker.updated ? new Date(ticker.updated).toISOString() : null,
        timeframe: "DELAYED" as const,
      })) ?? [];

    this.snapshotCache.set(cacheKey, snapshots, 15_000);
    return snapshots;
  }

  async getHistory(input: { symbol: string; range: PriceSeries["range"] }): Promise<PriceSeries> {
    const cacheKey = `history:${input.symbol}:${input.range}`;
    const cached = this.historyCache.get(cacheKey);
    if (cached) return cached;

    const { multiplier, timespan, from, to } = rangeToAggs(input.range);
    const response = await this.client.getJson<AggsResponse>(
      `/v2/aggs/ticker/${input.symbol.toUpperCase()}/range/${multiplier}/${timespan}/${from}/${to}`,
      { adjusted: true, sort: "asc", limit: 50000 },
    );

    const series: PriceSeries = {
      symbol: response.ticker ?? input.symbol.toUpperCase(),
      range: input.range,
      bars:
        response.results?.map((bar) => ({
          timestamp: new Date(bar.t).toISOString(),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        })) ?? [],
    };

    this.historyCache.set(cacheKey, series, 60_000);
    return series;
  }
}

function rangeToAggs(range: PriceSeries["range"]) {
  const to = new Date();
  const from = new Date(to);
  if (range === "1D") from.setDate(to.getDate() - 1);
  if (range === "5D") from.setDate(to.getDate() - 5);
  if (range === "1M") from.setMonth(to.getMonth() - 1);
  if (range === "3M") from.setMonth(to.getMonth() - 3);
  if (range === "1Y") from.setFullYear(to.getFullYear() - 1);

  return {
    multiplier: range === "1D" || range === "5D" ? 5 : 1,
    timespan: range === "1D" || range === "5D" ? "minute" : "day",
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- server/market/marketDataProvider.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server/market
git commit -m "feat: add Polygon market data provider"
```

---

### Task 6: Recommendation Service

**Files:**
- Create: `server/recommendations/recommendationService.ts`
- Create: `server/recommendations/recommendationService.test.ts`
- Create: `server/routes/recommendationRoutes.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing recommendation tests**

Create `server/recommendations/recommendationService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RecommendationService } from "./recommendationService";

describe("RecommendationService", () => {
  it("keeps pinned symbols first and limits system candidates", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return {
          symbol,
          name: `${symbol} Inc.`,
          marketCap: symbol === "NVDA" ? 2_000_000_000_000 : 100_000_000_000,
        };
      },
      async getRelatedTickers() {
        return ["NVDA", "AMD", "AVGO", "TSM"];
      },
      async searchTickers() {
        return ["NVDA", "AMD", "AVGO", "TSM"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: ["NVDA"],
      excludedSymbols: [],
      limit: 3,
    });

    expect(result.map((item) => item.symbol)).toEqual(["NVDA", "AMD", "AVGO"]);
    expect(result[0].source).toBe("pinned");
    expect(result[0].reasons).toContain("user pinned");
  });

  it("excludes symbols already in the watchlist", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return { symbol, name: symbol, marketCap: 1 };
      },
      async getRelatedTickers() {
        return ["NVDA", "AMD"];
      },
      async searchTickers() {
        return ["NVDA", "AMD"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: [],
      excludedSymbols: ["NVDA"],
      limit: 5,
    });

    expect(result.map((item) => item.symbol)).toEqual(["AMD"]);
  });

  it("discovers theme candidates when the user has no pinned seed symbol", async () => {
    const service = new RecommendationService({
      async getTickerDetails(symbol) {
        return { symbol, name: `${symbol} Semiconductor`, marketCap: 500_000_000_000 };
      },
      async getRelatedTickers() {
        return [];
      },
      async searchTickers(query) {
        expect(query).toBe("semiconductors");
        return ["TSM", "ASML", "AMAT"];
      },
    });

    const result = await service.recommend({
      theme: "semiconductors",
      pinnedSymbols: [],
      excludedSymbols: [],
      limit: 2,
    });

    expect(result.map((item) => item.symbol)).toEqual(["AMAT", "ASML"]);
    expect(result[0].reasons).toContain("matches semiconductors");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- server/recommendations/recommendationService.test.ts
```

Expected: fail because recommendation service does not exist.

- [ ] **Step 3: Implement recommendation service and route**

Create `server/recommendations/recommendationService.ts`:

```ts
import type { RecommendationCandidate } from "../../shared/types";

interface TickerDetails {
  symbol: string;
  name?: string;
  marketCap?: number;
}

interface RecommendationDataSource {
  getTickerDetails(symbol: string): Promise<TickerDetails>;
  getRelatedTickers(seed: string): Promise<string[]>;
  searchTickers(query: string): Promise<string[]>;
}

interface RecommendInput {
  theme: string;
  pinnedSymbols: string[];
  excludedSymbols: string[];
  limit: number;
}

export class RecommendationService {
  constructor(private readonly source: RecommendationDataSource) {}

  async recommend(input: RecommendInput): Promise<RecommendationCandidate[]> {
    const excluded = new Set(input.excludedSymbols.map((symbol) => symbol.toUpperCase()));
    const pinned = input.pinnedSymbols.map((symbol) => symbol.toUpperCase());
    const [related, searched] = await Promise.all([
      pinned[0] ? this.source.getRelatedTickers(pinned[0]) : Promise.resolve([]),
      this.source.searchTickers(input.theme),
    ]);
    const relatedUpper = related.map((symbol) => symbol.toUpperCase());
    const searchedUpper = searched.map((symbol) => symbol.toUpperCase());
    const symbols = [...new Set([...pinned, ...relatedUpper, ...searchedUpper])].filter((symbol) => !excluded.has(symbol));

    const candidates = await Promise.all(
      symbols.map(async (symbol) => {
        const details = await this.source.getTickerDetails(symbol);
        const isPinned = pinned.includes(symbol);
        const marketCapScore = Math.min((details.marketCap ?? 0) / 1_000_000_000_000, 2);
        const score = (isPinned ? 100 : 0) + marketCapScore * 10 + themeScore(input.theme, details);
        const reasons = [
          ...(isPinned ? ["user pinned"] : []),
          ...(details.marketCap ? ["large market capitalization"] : []),
          ...(themeScore(input.theme, details) > 0 ? [`matches ${input.theme}`] : []),
        ];

        return {
          symbol,
          name: details.name,
          score,
          reasons: reasons.length ? reasons : ["related candidate"],
          source: isPinned ? ("pinned" as const) : relatedUpper.includes(symbol) ? ("related" as const) : ("reference" as const),
        };
      }),
    );

    return candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, input.limit);
  }
}

function themeScore(theme: string, details: TickerDetails) {
  const text = `${theme} ${details.name ?? ""}`.toLowerCase();
  if (text.includes("semiconductor") || text.includes("chip")) return 8;
  if (text.includes("technology") || text.includes("software")) return 5;
  return 1;
}
```

Create `server/routes/recommendationRoutes.ts`:

```ts
import { Router } from "express";
import type { RecommendationService } from "../recommendations/recommendationService";

export function createRecommendationRoutes(service: RecommendationService) {
  const router = Router();

  router.post("/watchlists/recommendations", async (req, res, next) => {
    try {
      res.json(
        await service.recommend({
          theme: req.body.theme,
          pinnedSymbols: req.body.pinnedSymbols ?? [],
          excludedSymbols: req.body.excludedSymbols ?? [],
          limit: req.body.limit ?? 8,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Modify `server/market/marketDataProvider.ts` to add reference methods:

```ts
async getTickerDetails(symbol: string) {
  const response = await this.client.getJson<{
    results?: { ticker?: string; name?: string; market_cap?: number };
  }>(`/v3/reference/tickers/${symbol.toUpperCase()}`);
  return {
    symbol: response.results?.ticker ?? symbol.toUpperCase(),
    name: response.results?.name,
    marketCap: response.results?.market_cap,
  };
}

async getRelatedTickers(seed: string) {
  const symbol = seed.trim().toUpperCase();
  if (!/^[A-Z.]+$/.test(symbol)) return [];
  const response = await this.client.getJson<{ results?: Array<{ ticker?: string }> }>(
    `/v1/related-companies/${symbol}`,
  );
  return response.results?.flatMap((item) => (item.ticker ? [item.ticker] : [])) ?? [];
}

async searchTickers(query: string) {
  const response = await this.client.getJson<{ results?: Array<{ ticker?: string }> }>("/v3/reference/tickers", {
    market: "stocks",
    active: true,
    search: query,
    limit: 50,
  });
  return response.results?.flatMap((item) => (item.ticker ? [item.ticker] : [])) ?? [];
}
```

Modify `server/app.ts` to construct `PolygonClient`, `MarketDataProvider`, `RecommendationService`, and mount recommendation routes.

```ts
import { MarketDataProvider } from "./market/marketDataProvider";
import { PolygonClient } from "./market/polygonClient";
import { RecommendationService } from "./recommendations/recommendationService";
import { createRecommendationRoutes } from "./routes/recommendationRoutes";

const marketDataProvider = new MarketDataProvider(new PolygonClient(process.env.POLYGON_API_KEY));
const recommendationService = new RecommendationService(marketDataProvider);
app.use("/api", createRecommendationRoutes(recommendationService));
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- server/recommendations/recommendationService.test.ts server/market/marketDataProvider.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server/recommendations server/routes/recommendationRoutes.ts server/market/marketDataProvider.ts server/app.ts
git commit -m "feat: add watchlist recommendations"
```

---

### Task 7: Market API Routes

**Files:**
- Create: `server/routes/marketRoutes.ts`
- Create: `server/routes/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing market route tests**

Create `server/routes/routes.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("market routes", () => {
  it("returns a structured missing-key error for snapshots", async () => {
    const app = createApp({ polygonApiKey: "" });

    const response = await request(app).post("/api/market/snapshots").send({ symbols: ["AAPL"] });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("POLYGON_API_KEY_MISSING");
    expect(JSON.stringify(response.body)).not.toContain("apiKey=");
  });

  it("validates snapshot request symbols", async () => {
    const app = createApp({ polygonApiKey: "test" });

    const response = await request(app).post("/api/market/snapshots").send({ symbols: [] });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- server/routes/routes.test.ts
```

Expected: fail because `polygonApiKey` app option and market routes do not exist.

- [ ] **Step 3: Implement market routes and app dependency injection**

Create `server/routes/marketRoutes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import type { MarketDataProvider } from "../market/marketDataProvider";

const snapshotsRequestSchema = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(250),
});

const historyQuerySchema = z.object({
  symbol: z.string().min(1),
  range: z.enum(["1D", "5D", "1M", "3M", "1Y"]),
});

export function createMarketRoutes(provider: MarketDataProvider) {
  const router = Router();

  router.post("/market/snapshots", async (req, res, next) => {
    try {
      const input = snapshotsRequestSchema.parse(req.body);
      res.json(await provider.getSnapshots(input.symbols));
    } catch (error) {
      next(error);
    }
  });

  router.get("/market/history", async (req, res, next) => {
    try {
      const input = historyQuerySchema.parse(req.query);
      res.json(await provider.getHistory(input));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Modify `server/app.ts` options:

```ts
export interface AppOptions {
  configDir?: string;
  nodeEnv?: string;
  adminToken?: string;
  polygonApiKey?: string;
}

const polygonApiKey = options.polygonApiKey ?? process.env.POLYGON_API_KEY;
const marketDataProvider = new MarketDataProvider(new PolygonClient(polygonApiKey));
app.use("/api", createMarketRoutes(marketDataProvider));
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- server/routes/routes.test.ts server/app.test.ts
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/marketRoutes.ts server/routes/routes.test.ts server/app.ts
git commit -m "feat: expose market data routes"
```

---

### Task 8: Frontend API Client And Workbench Polling State

**Files:**
- Create: `src/shared/apiClient.ts`
- Create: `src/features/workbench/Workbench.tsx`
- Create: `src/features/workbench/Workbench.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing workbench tests**

Create `src/features/workbench/Workbench.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Workbench } from "./Workbench";

describe("Workbench", () => {
  it("polls only expanded row symbols", async () => {
    const fetchSnapshots = vi.fn(async () => []);
    render(
      <Workbench
        api={{
          getConfig: async () => ({
            settings: { polygon: { plan: "paid", paidPlanName: "stocks-starter", warningThreshold: 0.75, hardThreshold: 0.95 } },
            watchlists: {
              watchlists: [
                {
                  id: "semis",
                  name: "Semis",
                  pinnedSymbols: ["NVDA"],
                  rows: [
                    { id: "leaders", name: "Leaders", expandedByDefault: true, symbols: ["NVDA", "AMD"] },
                    { id: "equipment", name: "Equipment", expandedByDefault: false, symbols: ["ASML"] },
                  ],
                },
              ],
            },
          }),
          fetchSnapshots,
          getHistory: async () => ({ symbol: "NVDA", range: "1M", bars: [] }),
          evaluateRatePlan: async () => ({ status: "ok", plan: "paid", intervalSeconds: 30, estimatedCallsPerMinute: 2, message: "ok", disabledIntervals: [] }),
        }}
      />,
    );

    await waitFor(() => expect(fetchSnapshots).toHaveBeenCalledWith(["NVDA", "AMD"]));
    expect(fetchSnapshots).not.toHaveBeenCalledWith(["ASML"]);

    await userEvent.click(screen.getByRole("button", { name: /equipment/i }));
    await waitFor(() => expect(fetchSnapshots).toHaveBeenLastCalledWith(["NVDA", "AMD", "ASML"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/workbench/Workbench.test.tsx
```

Expected: fail because `Workbench.tsx` does not exist.

- [ ] **Step 3: Implement API client and workbench state**

Create `src/shared/apiClient.ts`:

```ts
import type { MarketSnapshot, PriceSeries, RatePlanEvaluation, SettingsConfig, WatchlistsConfig } from "../../shared/types";

export interface WorkbenchConfig {
  settings: SettingsConfig;
  watchlists: WatchlistsConfig;
}

export interface WorkbenchApi {
  getConfig(): Promise<WorkbenchConfig>;
  fetchSnapshots(symbols: string[]): Promise<MarketSnapshot[]>;
  getHistory(symbol: string, range: PriceSeries["range"]): Promise<PriceSeries>;
  evaluateRatePlan(input: unknown): Promise<RatePlanEvaluation>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export const apiClient: WorkbenchApi = {
  getConfig: () => requestJson<WorkbenchConfig>("/api/config"),
  fetchSnapshots: (symbols) =>
    requestJson<MarketSnapshot[]>("/api/market/snapshots", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
  getHistory: (symbol, range) => requestJson<PriceSeries>(`/api/market/history?symbol=${symbol}&range=${range}`),
  evaluateRatePlan: (input) =>
    requestJson<RatePlanEvaluation>("/api/rate-plan/evaluate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
```

Create `src/features/workbench/Workbench.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { Watchlist } from "../../../shared/types";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

export function Workbench({ api }: { api: WorkbenchApi }) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const watchlist: Watchlist | undefined = config?.watchlists.watchlists[0];

  useEffect(() => {
    void api.getConfig().then((loaded) => {
      setConfig(loaded);
      const initial: Record<string, boolean> = {};
      for (const row of loaded.watchlists.watchlists[0]?.rows ?? []) {
        initial[row.id] = row.expandedByDefault;
      }
      setExpandedRows(initial);
    });
  }, [api]);

  const activeSymbols = useMemo(() => {
    if (!watchlist) return [];
    return [
      ...new Set(
        watchlist.rows
          .filter((row) => expandedRows[row.id])
          .flatMap((row) => row.symbols)
          .map((symbol) => symbol.toUpperCase()),
      ),
    ];
  }, [expandedRows, watchlist]);

  useEffect(() => {
    if (activeSymbols.length) void api.fetchSnapshots(activeSymbols);
  }, [api, activeSymbols]);

  if (!config || !watchlist) return <main className="workbench">Loading watchlists...</main>;

  return (
    <main className="workbench">
      <aside className="watchlist-rail">
        <h1>Stock Workbench</h1>
        <button type="button">{watchlist.name}</button>
      </aside>
      <section className="watchlist-main">
        {watchlist.rows.map((row) => (
          <section className="watchlist-row" key={row.id}>
            <button
              type="button"
              aria-expanded={expandedRows[row.id]}
              onClick={() => setExpandedRows((current) => ({ ...current, [row.id]: !current[row.id] }))}
            >
              {row.name}
            </button>
            {expandedRows[row.id] ? (
              <table>
                <tbody>
                  {row.symbols.map((symbol) => (
                    <tr key={symbol}>
                      <td>{symbol}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>Sync paused</p>
            )}
          </section>
        ))}
      </section>
    </main>
  );
}
```

Modify `src/App.tsx`:

```tsx
import { Workbench } from "./features/workbench/Workbench";
import { apiClient } from "./shared/apiClient";

export function App() {
  return <Workbench api={apiClient} />;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/workbench/Workbench.test.tsx
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/apiClient.ts src/features/workbench src/App.tsx
git commit -m "feat: add watchlist workbench state"
```

---

### Task 9: Refresh Controls And Status UI

**Files:**
- Create: `src/features/settings/RefreshControls.tsx`
- Create: `src/features/settings/RefreshControls.test.tsx`
- Modify: `src/features/workbench/Workbench.tsx`

- [ ] **Step 1: Write failing refresh control tests**

Create `src/features/settings/RefreshControls.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefreshControls } from "./RefreshControls";

describe("RefreshControls", () => {
  it("disables blocked intervals and labels warning state", () => {
    render(
      <RefreshControls
        intervalSeconds={30}
        disabledIntervals={[5, 10]}
        status="warning"
        message="Stocks Starter has unlimited REST calls, but this interval is aggressive."
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "5s" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("aggressive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/settings/RefreshControls.test.tsx
```

Expected: fail because `RefreshControls.tsx` does not exist.

- [ ] **Step 3: Implement refresh controls**

Create `src/features/settings/RefreshControls.tsx`:

```tsx
import clsx from "clsx";

const INTERVALS = [5, 10, 15, 30, 60, 120, 300];

interface RefreshControlsProps {
  intervalSeconds: number;
  disabledIntervals: number[];
  status: "ok" | "warning" | "blocked";
  message: string;
  onChange(intervalSeconds: number): void;
}

export function RefreshControls(props: RefreshControlsProps) {
  return (
    <section className="refresh-controls" aria-label="Refresh frequency">
      <div className="segmented-control">
        {INTERVALS.map((interval) => (
          <button
            key={interval}
            type="button"
            className={clsx("segment", props.intervalSeconds === interval && "selected")}
            disabled={props.disabledIntervals.includes(interval)}
            onClick={() => props.onChange(interval)}
          >
            {interval < 60 ? `${interval}s` : `${interval / 60}m`}
          </button>
        ))}
      </div>
      <p role="status" className={clsx("rate-status", props.status)}>
        {props.message}
      </p>
    </section>
  );
}
```

Modify `src/features/workbench/Workbench.tsx` to render `RefreshControls` in the top bar and call `api.evaluateRatePlan` whenever `activeSymbols` or interval changes:

```tsx
const [intervalSeconds, setIntervalSeconds] = useState(30);
const [ratePlan, setRatePlan] = useState<RatePlanEvaluation>({
  status: "ok",
  plan: "paid",
  intervalSeconds: 30,
  estimatedCallsPerMinute: 0,
  message: "Refresh interval is within the configured budget.",
  disabledIntervals: [],
});

useEffect(() => {
  if (!config) return;
  void api
    .evaluateRatePlan({
      ...config.settings.polygon,
      activeSymbolCount: activeSymbols.length,
      intervalSeconds,
      endpointCount: 1,
      cacheHitRatio: 0.3,
    })
    .then(setRatePlan);
}, [api, activeSymbols.length, config, intervalSeconds]);
```

Render:

```tsx
<RefreshControls
  intervalSeconds={intervalSeconds}
  disabledIntervals={ratePlan.disabledIntervals}
  status={ratePlan.status}
  message={ratePlan.message}
  onChange={setIntervalSeconds}
/>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/settings/RefreshControls.test.tsx src/features/workbench/Workbench.test.tsx
npm run lint
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings src/features/workbench/Workbench.tsx
git commit -m "feat: add refresh budget controls"
```

---

### Task 10: Symbol Chart

**Files:**
- Create: `src/test/lightweightChartsMock.ts`
- Create: `src/features/charts/SymbolChart.tsx`
- Create: `src/features/charts/SymbolChart.test.tsx`
- Modify: `vitest.config.ts`
- Modify: `src/features/workbench/Workbench.tsx`

- [ ] **Step 1: Write failing chart tests**

Create `src/features/charts/SymbolChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SymbolChart } from "./SymbolChart";

describe("SymbolChart", () => {
  it("switches between trend and candle modes", async () => {
    render(
      <SymbolChart
        symbol="NVDA"
        series={{
          symbol: "NVDA",
          range: "1M",
          bars: [{ timestamp: "2026-05-22T13:30:00.000Z", open: 10, high: 12, low: 9, close: 11, volume: 100 }],
        }}
        range="1M"
        onRangeChange={() => undefined}
      />,
    );

    expect(screen.getByText("NVDA")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /candles/i }));
    expect(screen.getByRole("button", { name: /candles/i })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/charts/SymbolChart.test.tsx
```

Expected: fail because `SymbolChart.tsx` does not exist.

- [ ] **Step 3: Mock chart library and implement chart component**

Create `src/test/lightweightChartsMock.ts`:

```ts
export function createChart() {
  return {
    addLineSeries: () => ({ setData: () => undefined }),
    addCandlestickSeries: () => ({ setData: () => undefined }),
    addHistogramSeries: () => ({ setData: () => undefined }),
    remove: () => undefined,
    timeScale: () => ({ fitContent: () => undefined }),
  };
}
```

Modify `vitest.config.ts`:

```ts
resolve: {
  alias: {
    "lightweight-charts": "/src/test/lightweightChartsMock.ts",
  },
},
```

Create `src/features/charts/SymbolChart.tsx`:

```tsx
import { createChart } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { PriceSeries } from "../../../shared/types";

const RANGES: PriceSeries["range"][] = ["1D", "5D", "1M", "3M", "1Y"];

interface SymbolChartProps {
  symbol: string;
  series: PriceSeries;
  range: PriceSeries["range"];
  onRangeChange(range: PriceSeries["range"]): void;
}

export function SymbolChart({ symbol, series, range, onRangeChange }: SymbolChartProps) {
  const [mode, setMode] = useState<"trend" | "candles">("trend");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, { height: 300 });
    if (mode === "trend") {
      const line = chart.addLineSeries();
      line.setData(series.bars.map((bar) => ({ time: bar.timestamp.slice(0, 10), value: bar.close })));
    } else {
      const candles = chart.addCandlestickSeries();
      candles.setData(
        series.bars.map((bar) => ({
          time: bar.timestamp.slice(0, 10),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
      );
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [mode, series]);

  return (
    <section className="symbol-chart" aria-label={`${symbol} chart`}>
      <header>
        <strong>{symbol}</strong>
        <div className="segmented-control">
          <button type="button" aria-pressed={mode === "trend"} onClick={() => setMode("trend")}>
            Trend
          </button>
          <button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>
            Candles
          </button>
        </div>
        <div className="segmented-control">
          {RANGES.map((item) => (
            <button key={item} type="button" aria-pressed={range === item} onClick={() => onRangeChange(item)}>
              {item}
            </button>
          ))}
        </div>
      </header>
      <div ref={containerRef} className="chart-canvas" />
    </section>
  );
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/charts/SymbolChart.test.tsx
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/test/lightweightChartsMock.ts src/features/charts vitest.config.ts src/features/workbench/Workbench.tsx
git commit -m "feat: add symbol chart"
```

---

### Task 11: Watchlist Editor And Recommendation Flow

**Files:**
- Create: `src/features/watchlists/WatchlistEditor.tsx`
- Create: `src/features/watchlists/WatchlistEditor.test.tsx`
- Modify: `src/shared/apiClient.ts`
- Modify: `src/features/workbench/Workbench.tsx`

- [ ] **Step 1: Write failing editor tests**

Create `src/features/watchlists/WatchlistEditor.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WatchlistEditor } from "./WatchlistEditor";

describe("WatchlistEditor", () => {
  it("requests recommendations and lets the user confirm candidates", async () => {
    const onSave = vi.fn();
    render(
      <WatchlistEditor
        open
        onClose={() => undefined}
        onSave={onSave}
        recommend={async () => [
          { symbol: "NVDA", score: 120, reasons: ["user pinned"], source: "pinned" },
          { symbol: "AMD", score: 20, reasons: ["matches semiconductors"], source: "related" },
        ]}
      />,
    );

    await userEvent.type(screen.getByLabelText(/name/i), "AI Chips");
    await userEvent.type(screen.getByLabelText(/theme/i), "semiconductors");
    await userEvent.type(screen.getByLabelText(/pinned/i), "NVDA");
    await userEvent.click(screen.getByRole("button", { name: /recommend/i }));
    await userEvent.click(await screen.findByLabelText(/AMD/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "AI Chips" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/watchlists/WatchlistEditor.test.tsx
```

Expected: fail because `WatchlistEditor.tsx` does not exist.

- [ ] **Step 3: Implement editor and API methods**

Modify `src/shared/apiClient.ts` with methods:

```ts
saveWatchlists: (watchlists) =>
  requestJson<WatchlistsConfig>("/api/config/watchlists", {
    method: "PUT",
    body: JSON.stringify(watchlists),
  }),
recommendWatchlist: (input) =>
  requestJson<RecommendationCandidate[]>("/api/watchlists/recommendations", {
    method: "POST",
    body: JSON.stringify(input),
  }),
```

Create `src/features/watchlists/WatchlistEditor.tsx`:

```tsx
import { useState } from "react";
import type { RecommendationCandidate, Watchlist } from "../../../shared/types";

interface WatchlistEditorProps {
  open: boolean;
  onClose(): void;
  onSave(watchlist: Watchlist): void;
  recommend(input: {
    theme: string;
    pinnedSymbols: string[];
    excludedSymbols: string[];
    limit: number;
  }): Promise<RecommendationCandidate[]>;
}

export function WatchlistEditor({ open, onClose, onSave, recommend }: WatchlistEditorProps) {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("");
  const [pinned, setPinned] = useState("");
  const [candidates, setCandidates] = useState<RecommendationCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const pinnedSymbols = pinned
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  return (
    <section role="dialog" aria-label="Watchlist editor" className="watchlist-editor">
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Theme
        <input value={theme} onChange={(event) => setTheme(event.target.value)} />
      </label>
      <label>
        Pinned symbols
        <input value={pinned} onChange={(event) => setPinned(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={async () => {
          const next = await recommend({ theme, pinnedSymbols, excludedSymbols: [], limit: 8 });
          setCandidates(next);
          setSelected(Object.fromEntries(next.map((candidate) => [candidate.symbol, candidate.source === "pinned"])));
        }}
      >
        Recommend
      </button>
      {candidates.map((candidate) => (
        <label key={candidate.symbol}>
          <input
            aria-label={candidate.symbol}
            type="checkbox"
            checked={Boolean(selected[candidate.symbol])}
            onChange={(event) => setSelected((current) => ({ ...current, [candidate.symbol]: event.target.checked }))}
          />
          {candidate.symbol} {candidate.reasons.join(", ")}
        </label>
      ))}
      <button
        type="button"
        onClick={() => {
          const symbols = candidates.filter((candidate) => selected[candidate.symbol]).map((candidate) => candidate.symbol);
          onSave({
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            name,
            theme,
            pinnedSymbols,
            rows: [{ id: "recommended", name: "Recommended", expandedByDefault: true, symbols }],
          });
        }}
      >
        Save
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/watchlists/WatchlistEditor.test.tsx
npm run lint
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/watchlists src/shared/apiClient.ts src/features/workbench/Workbench.tsx
git commit -m "feat: add watchlist editor"
```

---

### Task 12: Integrated Workbench UI And Styling

**Files:**
- Modify: `src/features/workbench/Workbench.tsx`
- Modify: `src/styles.css`
- Modify: `src/features/workbench/Workbench.test.tsx`

- [ ] **Step 1: Extend workbench test for stale row copy and selected symbol**

Modify `src/features/workbench/Workbench.test.tsx` with this additional test:

```tsx
it("marks collapsed rows as paused and selects a symbol", async () => {
  const fetchSnapshots = vi.fn(async () => [
    { symbol: "NVDA", price: 100, change: 1, changePercent: 1, volume: 1000, updatedAt: "2026-05-23T14:00:00.000Z", timeframe: "DELAYED" },
  ]);

  render(<Workbench api={makeMockApi({ fetchSnapshots })} />);

  expect(await screen.findByText("Sync paused")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "NVDA" }));
  expect(screen.getByLabelText(/NVDA chart/i)).toBeInTheDocument();
});
```

Add a local `makeMockApi` helper at the bottom of the test file:

```tsx
function makeMockApi(overrides = {}) {
  return {
    getConfig: async () => ({
      settings: { polygon: { plan: "paid", paidPlanName: "stocks-starter", warningThreshold: 0.75, hardThreshold: 0.95 } },
      watchlists: {
        watchlists: [
          {
            id: "semis",
            name: "Semis",
            pinnedSymbols: ["NVDA"],
            rows: [
              { id: "leaders", name: "Leaders", expandedByDefault: true, symbols: ["NVDA", "AMD"] },
              { id: "equipment", name: "Equipment", expandedByDefault: false, symbols: ["ASML"] },
            ],
          },
        ],
      },
    }),
    fetchSnapshots: async () => [],
    getHistory: async () => ({ symbol: "NVDA", range: "1M", bars: [] }),
    evaluateRatePlan: async () => ({ status: "ok", plan: "paid", intervalSeconds: 30, estimatedCallsPerMinute: 2, message: "ok", disabledIntervals: [] }),
    ...overrides,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/features/workbench/Workbench.test.tsx
```

Expected: fail because selected chart rendering is not wired into the workbench.

- [ ] **Step 3: Integrate table, selection, chart, editor trigger, and styling**

Modify `src/features/workbench/Workbench.tsx` so each visible symbol is a button, selected symbol loads history through `api.getHistory`, and `SymbolChart` renders in a detail pane.

Use this table row shape:

```tsx
<tr key={symbol}>
  <td>
    <button type="button" onClick={() => setSelectedSymbol(symbol)}>
      {symbol}
    </button>
  </td>
  <td>{snapshot?.price ?? "..."}</td>
  <td>{snapshot?.changePercent === null || snapshot?.changePercent === undefined ? "..." : `${snapshot.changePercent.toFixed(2)}%`}</td>
  <td>{snapshot?.volume ?? "..."}</td>
  <td>{snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : "stale"}</td>
</tr>
```

Modify `src/styles.css` with compact workbench styling:

```css
.workbench {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100vh;
  background: #f4f6f8;
  color: #1b252e;
}

.watchlist-rail {
  border-right: 1px solid #d7dde3;
  background: #ffffff;
  padding: 16px;
}

.watchlist-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
}

.top-bar,
.watchlist-row,
.symbol-chart,
.watchlist-editor {
  border: 1px solid #d7dde3;
  border-radius: 8px;
  background: #ffffff;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
}

.watchlist-row header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e6ebef;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

td,
th {
  padding: 8px 10px;
  border-bottom: 1px solid #edf1f4;
  text-align: left;
}

.segmented-control {
  display: inline-flex;
  gap: 2px;
}

.segment,
.segmented-control button {
  min-width: 44px;
  height: 32px;
  border: 1px solid #cbd3dc;
  background: #ffffff;
}

.selected,
[aria-pressed="true"] {
  background: #1f6feb;
  color: #ffffff;
}

.rate-status.warning {
  color: #8a5a00;
}

.rate-status.blocked {
  color: #b42318;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- src/features/workbench/Workbench.test.tsx src/features/charts/SymbolChart.test.tsx src/features/settings/RefreshControls.test.tsx
npm run lint
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/workbench src/styles.css
git commit -m "feat: integrate stock workbench UI"
```

---

### Task 13: Playwright E2E And Documentation

**Files:**
- Create: `tests/e2e/workbench.spec.ts`
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-05-23-stock-workbench-mvp.md`

- [ ] **Step 1: Write Playwright smoke test**

Create `tests/e2e/workbench.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("loads workbench, toggles rows, and opens a chart", async ({ page }) => {
  await page.route("**/api/market/snapshots", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { symbol: "NVDA", price: 100, change: 1, changePercent: 1, volume: 1000, updatedAt: "2026-05-23T14:00:00.000Z", timeframe: "DELAYED" },
      ]),
    });
  });
  await page.route("**/api/market/history?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        symbol: "NVDA",
        range: "1M",
        bars: [{ timestamp: "2026-05-22T13:30:00.000Z", open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stock Workbench" })).toBeVisible();
  await page.getByRole("button", { name: "Equipment" }).click();
  await expect(page.getByText("ASML")).toBeVisible();
  await page.getByRole("button", { name: "NVDA" }).click();
  await expect(page.getByLabel(/NVDA chart/)).toBeVisible();
  await page.getByRole("button", { name: "Candles" }).click();
  await expect(page.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Create README**

Create `README.md`:

```md
# Stock Workbench

Local stock watchlist workbench built with Vite React and Express.

## Setup

```bash
npm install
export POLYGON_API_KEY="$POLYGON_API_KEY"
npm run dev
```

Open `http://127.0.0.1:5173`.

## Configuration

- `config/watchlists.yaml` stores watchlists, rows, pinned symbols, and row defaults.
- `config/settings.yaml` defaults to `paid / stocks-starter`.

`POLYGON_API_KEY` is read only by the Express API. Do not commit it, print it, or add it to frontend code.

In production, set `APP_ADMIN_TOKEN`; config write routes require `x-admin-token`.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
```

Tests mock Polygon responses and should not consume real API capacity.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

Expected: all commands pass. If Playwright browsers are missing, run `npx playwright install chromium` once and re-run `npm run test:e2e`.

- [ ] **Step 4: Commit**

```bash
git add tests README.md docs/superpowers/plans/2026-05-23-stock-workbench-mvp.md
git commit -m "test: add workbench e2e coverage"
```

---

## Final Verification Checklist

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run test:e2e` passes with Playwright.
- [ ] `npm run build` passes.
- [ ] `POLYGON_API_KEY` appears only in server-side code, docs, and `.env` guidance.
- [ ] No real API key appears in logs, test fixtures, docs, or committed files.
- [ ] `config/settings.yaml` defaults to `paid` and `stocks-starter`.
- [ ] Collapsing a row removes that row's symbols from the active snapshot request.
- [ ] Watchlist edits write through `PUT /api/config/watchlists`.
- [ ] Production config writes require `APP_ADMIN_TOKEN`.
- [ ] Wave-theory analysis remains documented as follow-up planning and is not implemented in MVP code.

## Plan Self-Review Notes

- Spec coverage: the tasks cover React/Express scaffolding, YAML config, Polygon proxy, row collapse polling, table/chart UI, recommendation service, paid Starter defaults, secure writes, structured errors, and Playwright testing.
- Intentional exclusions: deployment, `finance.nphunter.net`, `nphunter-site`, WebSocket streaming, durable persistence, and wave-theory implementation stay out of the MVP.
- Type consistency: shared DTOs are introduced before server and client modules consume them; route names match the approved design.

## Execution Note

- Task 13 adds mocked Playwright workbench coverage and README setup documentation on `feature/stock-workbench-mvp`; wave-theory analysis and deployment remain follow-up work documented in the spec.
