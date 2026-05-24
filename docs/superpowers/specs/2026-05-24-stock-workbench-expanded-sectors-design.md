# Stock Workbench Expanded Sectors Design

Date: 2026-05-24
Status: Approved design, pending implementation plan

## Context

The current Stock Workbench loads watchlists from `config/watchlists.yaml`, lets the user create new watchlists through the frontend, polls expanded rows, and reserves a fixed right-side symbol detail panel. The next iteration changes the product shape from editable watchlists to a file-driven sector dashboard.

Follow-up refinement: refresh cadence and chart time span are separate controls. Refresh cadence controls polling; time span controls the history window used when opening symbol detail. API usage stats use visible session request counters rather than symbol-refresh estimates so batched quote requests are not inflated by the number of symbols.

## Goals

1. Remove the new-watchlist flow from the user interface.
2. Treat watchlists as file-generated configuration from `config/watchlists.yaml`.
3. Expand sector coverage beyond semiconductors with ten additional popular market sectors or themes.
4. Show all symbols for the selected sector in a sortable, paginated table.
5. Default pagination to 20 symbols per page.
6. Replace the fixed right detail column with a right-side off-canvas detail panel opened by clicking a symbol.
7. Let the main dashboard use the available width when the detail panel is closed.
8. Keep refresh choices compact and separate from chart time span.
9. Add a compact workbench stats table before sector selection showing quote requests this session, total tracked symbols, history requests this session, and a session REST request total.
10. Add useful quote table columns beyond price, change, and volume.

## Non-Goals

- Reintroducing UI-based watchlist creation or editing.
- Building a database-backed symbol catalog.
- Guaranteeing every listed ticker is a current index constituent.
- Adding investment recommendations, scoring advice, or trading actions.
- Replacing Polygon as the market data backend.
- Persisting exact API call telemetry across process restarts.

## Sector Set

The workbench will include the existing `Semiconductors` sector plus these ten additional sectors/themes:

1. `Consumer Staples`
2. `Mega-Cap Tech`
3. `AI Cloud & Infrastructure`
4. `Healthcare & Biotech`
5. `Financials`
6. `Energy`
7. `Consumer Discretionary`
8. `Communication & Media`
9. `Industrials & Defense`
10. `Utilities & Power`

This mix combines standard GICS-style sector coverage with high-attention technology themes that users commonly track separately. Each sector will be represented in `config/watchlists.yaml` as one watchlist with one or more rows for human organization. The UI will flatten the selected watchlist's rows into one de-duplicated symbol list for table display.

## Watchlist Source

The frontend will keep loading watchlists from `GET /api/config`. It will no longer expose:

- The `New Watchlist` button.
- The `WatchlistEditor` dialog.
- Client-side calls to `POST /api/watchlists/recommendations`.
- Client-side calls to `PUT /api/config/watchlists`.

Backend write and recommendation routes are removed so the product surface and API both treat watchlists as file-backed configuration.

## Layout

The app layout becomes a two-column workbench:

- Left rail: title, compact stats table, sector buttons.
- Main dashboard: one top toolbar, selected sector table, pagination controls.

The fixed `.symbol-detail` grid column will be removed from normal layout. Clicking a symbol opens an off-canvas panel from the right. The panel contains the selected symbol, selected time range, chart mode controls, chart range controls, loading/error states, and a close button. A backdrop or close button will dismiss it. The dashboard keeps its full width while the panel overlays the page.

On narrow screens, the rail stacks above the main dashboard and the off-canvas panel uses nearly full viewport width.

## Refresh And Time Span

Refresh interval options are:

- `10s`
- `1m`
- `5m`
- `30m`
- `1h`
- `1d`

The default refresh interval is `1m`.

The chart time span options are:

- `1h`
- `1d`
- `5d`
- `30d`
- `3months`
- `1y`
- `5y`

The backend maps time span to Polygon aggregate requests:

- `1h`: minute aggregates over a wider calendar window, then trimmed to the last hour ending at the latest returned bar.
- `1d`, `5d`: 5-minute aggregates with a wider calendar window to handle weekends and market holidays.
- `30d`, `3months`, `1y`, `5y`: daily aggregates, trimmed to the requested window ending at the latest returned bar.

The default selected time span is `1h`.

## Sorting

The selected sector table supports these sort modes:

- `Config order`: preserves the de-duplicated order from `config/watchlists.yaml`.
- `Size`: sorts largest first by configured weight when present, then dollar volume, then volume.
- `Heat`: sorts by absolute percentage move, highest first.
- `Volume`: sorts by reported volume, highest first.
- `Change %`: sorts by percentage change, highest first.
- `Price`: sorts by price, highest first.
- `Updated`: sorts by latest update timestamp first.

Missing numeric values sort after present values. Sorting resets the page to page 1.

## Pagination

The main table shows 20 rows by default. Pagination controls show:

- Current page.
- Total pages.
- Previous and next buttons.
- A page-size selector with 20, 50, and 100.

Changing sector, sort mode, or page size keeps the UI in bounds and resets to the first page when that is the least surprising behavior.

## Quote Table Columns

The table will include:

- Symbol
- Company name
- Price
- Change
- Change %
- Volume
- Dollar volume, calculated as `price * volume` when both are present
- Timeframe
- Updated

The current `MarketSnapshot` type already contains name, price, change, change percent, volume, updated timestamp, and timeframe. Dollar volume can be derived client-side.

## Stats Table

The left rail includes a compact stats table before sector buttons:

- `Quote requests this session`: actual browser-to-workbench snapshot refresh requests made since this page session loaded. Each snapshot refresh is counted once because symbols are batched.
- `Tracked symbols`: unique symbols across all configured watchlists.
- `History requests this session`: actual browser-to-workbench history requests made for span metrics and the active symbol chart.
- `REST requests this session`: quote requests plus history requests for a clear local session total.

This is visible workbench-session telemetry, not billing-grade Polygon telemetry. It is intended to make frontend request behavior understandable without adding persistent storage.

## Data Flow

1. Frontend loads config.
2. Frontend flattens all rows in the selected watchlist into a de-duplicated symbol list.
3. Frontend requests snapshots for the selected sector's full symbol list.
4. User selects sort mode and pagination locally.
5. User clicks a symbol.
6. Off-canvas opens and requests history for the selected symbol and selected range.
7. User changes chart range; the same history route is called with the new shared range label.

Unlike the previous row-expansion model, collapsed rows no longer control polling. The selected sector is the active polling unit.

## Testing

Unit tests should cover:

- `RefreshControls` labels and seconds mapping for the new long-range options.
- Workbench removal of `New Watchlist`.
- Flattened selected sector polling.
- Sort modes and pagination behavior.
- Off-canvas chart opening and closing.
- Added quote table columns.
- API stats table values.
- Backend validation of the expanded history range enum.
- Polygon aggregate mapping for hourly, daily, month, year, and five-year ranges.

E2E tests should update the existing workbench flow to cover sector selection, sorting, pagination, symbol detail off-canvas, and absence of watchlist creation.

## References

- S&P Dow Jones Indices describes GICS as an 11-sector classification structure.
- Sector ETF holdings and common large-cap lists informed initial representative tickers for popular sectors and themes.
