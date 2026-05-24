# Workbench Quote Change Design

## Goal

Make the quote table read like a market tool instead of a raw API dump: names should be populated, the primary change column should compare the displayed price with the prior regular-session close, and the selected time span should provide a separate interval move for heat sorting.

## Current Behavior

`/api/market/snapshots` maps the legacy stock snapshot response directly. The response usually includes ticker, day, previous day, and change values, but it does not reliably include company names. When the market is closed and `day.c` is empty, the provider falls back to `prevDay.c` for price while still keeping the API-provided `todaysChange`, which can be `0`. This makes a previous close look unchanged even when it moved versus the prior session.

## Target Behavior

Snapshots should expose:

- `name`: populated from reference ticker metadata when the snapshot does not provide a name.
- `price`: the best displayed price from current day data, then previous close fallback.
- `sessionChange` and `sessionChangePercent`: displayed price minus the reference close that belongs to the prior regular session for that displayed price.
- `spanChange` and `spanChangePercent`: optional table-side metric based on the active time span, computed from the selected history series once that data has been fetched.
- `timeframe`: a displayable state such as `DELAYED` or `PREVIOUS_CLOSE`, with the UI free to label it more softly.

For a previous-close fallback, the provider should use recent daily aggregate bars to find the close before `prevDay.c`. For a live/delayed current price, the provider can keep using snapshot `todaysChange` because that is already defined against the previous day.

## UI Design

Rename table headers:

- `Change` becomes `Session Chg`.
- `Change %` becomes `Session Chg %`.
- Add `Span Chg` and `Span Chg %` after session change columns.

Sorting:

- `Heat` should prefer absolute `spanChangePercent` when available.
- If span data is not available yet, fall back to absolute `sessionChangePercent`.
- Existing volume, price, and updated sorts remain.

Data loading:

- Snapshot refresh remains independent from selected time span.
- History for `Span Chg` can be requested for the visible page only, so the table stays responsive and avoids hundreds of history calls per refresh.
- Off-canvas history uses the same cached series when possible.

## Testing

Add provider tests for reference-name enrichment and previous-close fallback change. Add workbench tests for `Session Chg` headers, span columns, and heat sorting by span move when available.
