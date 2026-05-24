# Stock Workbench Expanded Sectors Design

Date: 2026-05-24
Status: Approved design, pending implementation plan

## Context

The current Stock Workbench loads watchlists from `config/watchlists.yaml`, lets the user create new watchlists through the frontend, polls expanded rows, and reserves a fixed right-side symbol detail panel. The next iteration changes the product shape from editable watchlists to a file-driven sector dashboard.

The user confirmed that the time options `1h`, `3h`, `6h`, `1d`, `5d`, `30d`, `2month`, `3month`, `6month`, `1y`, and `5y` should be used for both automatic refresh cadence and the symbol history chart range.

## Goals

1. Remove the new-watchlist flow from the user interface.
2. Treat watchlists as file-generated configuration from `config/watchlists.yaml`.
3. Expand sector coverage beyond semiconductors with ten additional popular market sectors or themes.
4. Show all symbols for the selected sector in a sortable, paginated table.
5. Default pagination to 20 symbols per page.
6. Replace the fixed right detail column with a right-side off-canvas detail panel opened by clicking a symbol.
7. Let the main dashboard use the available width when the detail panel is closed.
8. Replace short refresh choices with the shared long-range options.
9. Add a compact workbench stats table before sector selection showing estimated today's API calls, total tracked symbols, and estimated historical API calls.
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

Backend write and recommendation routes may remain for future admin tooling, but they will not be reachable from the workbench surface.

## Layout

The app layout becomes a two-column workbench:

- Left rail: title, compact stats table, sector buttons.
- Main dashboard: top bar, sort/pagination controls, selected sector table.

The fixed `.symbol-detail` grid column will be removed from normal layout. Clicking a symbol opens an off-canvas panel from the right. The panel contains the selected symbol, selected time range, chart mode controls, chart range controls, loading/error states, and a close button. A backdrop or close button will dismiss it. The dashboard keeps its full width while the panel overlays the page.

On narrow screens, the rail stacks above the main dashboard and the off-canvas panel uses nearly full viewport width.

## Time Options

The shared time options are:

- `1h`
- `3h`
- `6h`
- `1d`
- `5d`
- `30d`
- `2month`
- `3month`
- `6month`
- `1y`
- `5y`

The frontend label set is reused by refresh controls and chart range controls. Internally, refresh options map to seconds:

- `1h`: 3,600
- `3h`: 10,800
- `6h`: 21,600
- `1d`: 86,400
- `5d`: 432,000
- `30d`: 2,592,000
- `2month`: 5,184,000
- `3month`: 7,776,000
- `6month`: 15,552,000
- `1y`: 31,536,000
- `5y`: 157,680,000

Chart history ranges use the same labels in the API. The backend maps the range to Polygon aggregate requests:

- `1h`, `3h`, `6h`: minute aggregates over the requested number of hours.
- `1d`, `5d`: 5-minute aggregates with a wider calendar window to handle weekends and market holidays.
- `30d`, `2month`, `3month`, `6month`, `1y`, `5y`: daily aggregates.

The default selected option is `1h` for both refresh cadence and symbol chart range.

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

- `Today's API calls`: estimated from current active symbol count, selected refresh cadence, and elapsed time since local midnight.
- `Tracked symbols`: unique symbols across all configured watchlists.
- `Historical API calls`: estimated as the number of symbol history requests made in this session, plus the active selected symbol request when present.

This is a dashboard estimate, not billing-grade telemetry. It is intended to make API usage visible without adding persistent storage.

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
