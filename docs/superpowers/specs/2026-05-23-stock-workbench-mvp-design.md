# Stock Workbench MVP Design

Date: 2026-05-23
Status: Draft for user review

## Context

This project starts from `DRAFT.md` and builds the first usable slice of a live-updating stock tracking website. The MVP is intentionally scoped to the stock workbench experience:

- A Vite React frontend.
- A Node/Express API backend.
- Watchlists loaded from and written back to local YAML configuration.
- Polygon.io/Massive market data through a backend-only API key.
- A Grafana-inspired row model where collapsed rows stop syncing.
- Table and chart views for quick scanning and deeper inspection.
- Dynamic sector/watchlist candidate recommendations.

Deployment, Pulumi, GitHub Actions, `finance.nphunter.net`, the `nphunter-site` homepage entry, WebSocket streaming, and wave-theory analysis are follow-up phases, not MVP implementation work.

## Goals

1. Provide a local, usable stock workbench that can load and edit watchlists.
2. Keep `POLYGON_API_KEY` server-side only, read from the shell environment.
3. Let users organize watchlists into rows, collapse rows, and pause data sync for collapsed rows.
4. Show compact quote tables for scanning and richer charts for selected symbols.
5. Default Polygon settings to the user's paid Stocks Starter plan.
6. Make refresh-frequency controls aware of the active plan, visible rows, symbol count, and cache behavior.
7. Support dynamic sector candidate recommendations without crowding the watchlist.
8. Keep boundaries clean enough for later WebSocket, deployment, and wave-theory modules.

## Non-Goals For MVP

- Production deployment infrastructure.
- Domain wiring for `finance.nphunter.net`.
- Homepage changes in `~/projects/nphunter-site`.
- Full real-time WebSocket streaming.
- Multi-user accounts or roles.
- Redis, database-backed persistence, or durable job queues.
- Elliott wave analysis implementation.
- Trading advice, automated trading, or buy/sell recommendations.

## Product Shape

The first screen is the actual workbench, not a marketing page. The layout is dense, professional, and optimized for repeated use.

- Left rail: watchlist navigation and create/edit actions.
- Top bar: data source status, Polygon plan, refresh budget, selected refresh interval, and global errors.
- Main area: selected watchlist, grouped into collapsible rows.
- Row content: compact quote table for row symbols.
- Detail area: selected symbol chart and metadata.

Each row has an expanded/collapsed state. Expanded rows are part of the active sync set; collapsed rows are removed from polling. Collapsed rows may still show stale data with a clear last-updated timestamp.

## Watchlist And Row Model

Watchlists are loaded from `config/watchlists.yaml` and can be edited from the UI. The backend writes changes back to the same file after schema validation.

Each watchlist contains:

- Stable id.
- Display name.
- Optional description.
- Optional sector/theme metadata.
- Rows.
- User-pinned symbols.

Each row contains:

- Stable id.
- Display name.
- Expanded-by-default flag.
- Symbols.
- Optional sync settings.
- Optional panel preferences.

Symbols can be marked as user-pinned. User-pinned symbols always sort ahead of system-recommended symbols in the UI and in recommendation merging.

## Watchlist Creation And Editing

The create/edit flow is a drawer or modal. It supports two paths:

1. Manual watchlist creation: name, description, rows, symbols, pinned symbols.
2. Sector/theme watchlist creation: user enters a sector/theme and pinned symbols, then requests recommendations.

The recommendation flow returns candidates, not final watchlist content. The user confirms which candidates to include before the config file is written.

System recommendations should be limited by default so the resulting watchlist does not become bloated. Pinned symbols remain visibly distinct from recommended symbols.

## Dynamic Recommendation Model

MVP includes dynamic sector candidate discovery as a backend service. It uses a balanced score:

1. User-pinned status.
2. Sector or theme relevance.
3. Market cap, dollar volume, or liquidity proxy.
4. Volume anomaly and price movement.

The exact Polygon endpoints may evolve during implementation, but the service boundary is fixed:

- Input: theme/sector text, pinned symbols, desired candidate count, excluded symbols.
- Output: scored candidates with explanation fields.

Candidate explanations must be short and concrete, such as "high liquidity", "large semiconductor name", or "volume spike". The UI should make it clear that these are watchlist candidates, not investment recommendations.

## Frontend Architecture

The frontend uses Vite React. Suggested internal boundaries:

- `features/workbench`: layout, active watchlist, row expansion, selected symbol.
- `features/watchlists`: create/edit drawer, form state, config save.
- `features/market-data`: polling hooks, snapshot state, history state.
- `features/charts`: trend chart and candlestick chart.
- `features/recommendations`: sector candidate UI and candidate confirmation.
- `features/settings`: Polygon plan and refresh-frequency controls.
- `shared/api`: typed API client.
- `shared/types`: DTOs shared with backend where practical.

The UI should avoid oversized marketing composition. It should feel like a compact stock tool: tables, segmented chart controls, icon buttons, clear status indicators, and stable dimensions for rows, toolbar buttons, and charts.

## Charting

MVP charting is dual-mode:

- Default scan mode: line or area trend chart.
- Detail mode: candlestick/OHLC chart with volume.

Supported time ranges:

- `1D`
- `5D`
- `1M`
- `3M`
- `1Y`

Chart requests go through the backend. The frontend asks for a symbol, range, and chart mode; the backend maps that to Polygon aggregate/history requests and returns normalized `PriceSeries` data.

## Backend Architecture

The backend is a Node/Express API. It is the only layer that reads `POLYGON_API_KEY`.

Core modules:

- `ConfigRepository`: reads and writes YAML config, validates schemas, writes atomically, and keeps a simple backup before overwriting.
- `PolygonProvider`: wraps Polygon/Massive REST calls and maps provider responses to local DTOs.
- `MarketDataProvider`: interface that allows the MVP polling provider to be replaced or supplemented by a WebSocket provider later.
- `RatePlanner`: calculates refresh-frequency status based on plan, expanded rows, active symbols, endpoints, and cache assumptions.
- `WatchlistRecommendationService`: generates and explains sector/theme candidate symbols.
- `AuthGuard`: requires `APP_ADMIN_TOKEN` for config writes and management operations in production.
- `ApiRoutes`: exposes the local API to the React app.

Suggested API routes:

- `GET /api/config`
- `PUT /api/config/watchlists`
- `GET /api/watchlists`
- `POST /api/watchlists/recommendations`
- `POST /api/market/snapshots`
- `GET /api/market/history`
- `POST /api/rate-plan/evaluate`
- `GET /api/health`

## Data Flow

The frontend does not call Polygon directly. It sends active sync intent to the backend:

1. User expands or collapses rows.
2. Frontend builds the active symbol set from expanded rows.
3. Frontend polling hook requests snapshots for the active symbol set at the selected interval.
4. Backend de-duplicates symbols, uses cache where possible, calls Polygon through `PolygonProvider`, and returns normalized snapshots.
5. Frontend updates visible rows and keeps collapsed rows stale.

History and chart data use symbol + range + timespan requests. Backend responses are normalized so future wave-theory modules can consume the same historical OHLC data.

## Caching

MVP uses in-process caching.

- Snapshot cache: short TTL, enough to prevent duplicate calls across rows and quick UI refreshes.
- Reference data cache: longer TTL for ticker metadata and recommendation inputs.
- History cache: symbol + range + timespan key with a longer TTL.

The cache boundary should be replaceable later by Redis, SQLite, or another persistent store without changing frontend APIs.

## Polygon Plan And Refresh Budget

The default settings assume the user's paid Stocks Starter plan:

```yaml
polygon:
  plan: paid
  paidPlanName: stocks-starter
  warningThreshold: 0.75
  hardThreshold: 0.95
```

The app still supports:

- `free`: conservative mode based on Polygon's public free REST limit of 5 calls/min.
- `paid`: unlimited REST calls with monitored usage messaging.
- `custom`: user-specified call budget for testing or future plan changes.

Stocks Starter should not be represented as real-time data. Current Polygon/Massive documentation indicates Starter supports unlimited REST API calls and 15-minute delayed stock data for relevant WebSocket feeds, while Advanced is the individual plan tier that provides real-time stock data.

The refresh-frequency UI should:

- Use paid mode by default.
- Warn when a selected interval creates aggressive local load or excessive provider usage.
- Disable impossible choices in free/custom modes.
- Explain which expanded rows and symbol counts drive warnings.

References checked during design:

- https://polygon.io/pricing/
- https://polygon.io/knowledge-base/article/what-is-the-request-limit-for-polygons-restful-apis
- https://polygon.io/docs/websocket/stocks/aggregates-per-second

## Security

`POLYGON_API_KEY` is read from the server process environment. It must never be sent to the frontend, written to config, printed in logs, or included in model-visible output.

If the app later copies secrets into GitHub Actions, it should copy from environment to environment without printing the plaintext value.

Local development:

- Config reads and writes are allowed without auth.
- API should default to `localhost`.

Production:

- Config writes and management operations require `APP_ADMIN_TOKEN`.
- Missing `APP_ADMIN_TOKEN` should fail closed for write operations.
- Logs must redact token-like values.

## Error Handling

Backend errors use structured responses:

- `code`
- `message`
- `source`
- `retryAfter`
- optional `details`

Expected cases:

- Missing `POLYGON_API_KEY`.
- Polygon network failure.
- Polygon rate limiting.
- Unsupported plan or endpoint.
- Invalid ticker.
- Config validation failure.
- Config write failure.

Row-level data errors should not crash the whole workbench. The UI should show row-specific warnings while keeping other rows usable.

## Testing Strategy

Backend:

- Unit tests for config schema validation and atomic save behavior.
- Unit tests for rate-planner decisions in paid, free, and custom modes.
- Unit tests for recommendation scoring and candidate limiting.
- Unit tests for Polygon adapter error mapping.

Frontend:

- Component tests for row expansion/collapse behavior.
- Component tests for refresh-frequency disabled/warning states.
- Component tests for watchlist create/edit flows.
- Component tests for chart mode and time range controls.

End-to-end:

- Playwright opens the local app.
- Verifies watchlists load from config.
- Creates or edits a watchlist through the UI.
- Confirms collapsed rows stop participating in snapshot requests.
- Switches between trend and candlestick chart modes.
- Exercises warning/disabled refresh-frequency states with mocked plan responses.

Tests should mock Polygon by default so they do not consume real API capacity.

## Follow-Up Planning

### Wave-Theory Analysis

The MVP should leave historical OHLC retrieval and cache boundaries clean enough for later Elliott wave analysis.

Future module:

- `WaveAnalysisService`: consumes normalized historical OHLC data.
- Scans all available data for candidate major wave intervals.
- Presents candidate "wave one" major ranges one at a time.
- If the user rejects a candidate, proceeds to the next plausible interval.
- If the user accepts a major range, asks whether that range has ended.
- Then asks whether to inspect smaller waves within the accepted range.
- Continues until the scan reaches the latest data or a user-selected cutoff time.
- Produces candidate explanations and possible future wave ranges.

This future module should be interactive and confirmatory. It should not make automatic trading decisions, and it should not present predictions as certainty.

### Deployment

After MVP validation, add containerization, Pulumi, GitHub Actions, and Route53 deployment for `finance.nphunter.net`. The deployment design should reference patterns from `~/projects/cgame`.

### Nphunter Site Entry

After deployment is defined, update `~/projects/nphunter-site` so the homepage links to the finance workbench.

### Data Streaming

Add a WebSocket implementation behind `MarketDataProvider`. The existing polling implementation should stay available as fallback.

### Durable Persistence

Consider SQLite or Redis once local in-process cache becomes limiting. Keep the frontend API unchanged.

## Open Decisions For Implementation Planning

- Exact charting library.
- Exact Polygon endpoints for snapshot, aggregates, ticker metadata, and recommendation inputs.
- YAML schema details for watchlists and settings.
- Whether backend and frontend share TypeScript types from one package or duplicate DTO schemas with generated validation.

These are implementation-plan decisions, not product-design blockers.
