# Focus watchlist selection

Reviewed 2026-09-20. These are manually curated observation universes, not investment recommendations, market-cap rankings or ETF replicas.

## Navigation

Four primary lists: Semiconductors (30), Consumer Staples (22), Mega-Cap Tech (10), Software & SaaS (26). All nine remaining existing lists retain their constituents and IDs under the collapsible Other folder, including the user's close-watch list. Other has no combined return: its lists have different exposures and overlapping holdings.

## Selection rules

1. Business relevance and coverage of distinct industry segments come first. Use SOXX, XLP and IGV issuer material as sector/exposure references, not mechanical constituent or weight copies.
2. Keep liquid US-listed observation instruments. On the review date all 84 unique focus symbols had 20 available daily bars ending 2026-09-18, and estimated mean daily traded value above $20 million. Estimate = mean(daily close × daily share volume) for the last 20 completed daily bars; it is not exact trade-by-trade turnover. The observed minimum exceeded $123 million. No new paid data source was introduced.
3. One share class per company within a list: use GOOGL rather than including both GOOGL and GOOG. Cross-list overlap (for example NVDA or MSFT) is intentional and does not imply additional market-wide capital flow.
4. Preserve explicit user focus: LITE, NOK, CRDO and ALAB remain in Semiconductors. NOK is adjacent optical-network equipment exposure. This broader supply-chain watchlist is not a pure semiconductor index.
5. Software covers enterprise applications, security, data/cloud operations, development and engineering software; not all constituents are pure SaaS. IGV is a reference, not another constituent in the equal-weight stock average.
6. Mega-Cap Tech is a compact cross-sector leadership watchlist, including consumer/media exposure. It is not a verified top-ten ranking by capitalization.

Coverage groups and exact constituents are maintained in `config/watchlists.yaml` and exposed in the UI's expandable Selection criteria & coverage panel. The daily badge remains the equal-weight average of valid same-session stock changes. Missing quotes reduce coverage and display an asterisk. Changes in membership change this average; it is not a historical backtested portfolio return.

## Review practice

Revisit after material listings/delistings, acquisitions or business changes. Recheck liquidity and data availability when changing constituents. No automatic monthly screen or scheduled job is configured.

## Primary references

- SOXX: https://www.ishares.com/us/products/239705/ishares-semiconductor-etf
- XLP: https://www.ssga.com/us/en/individual/etfs/state-street-consumer-staples-select-sector-spdr-etf-xlp
- IGV: https://www.ishares.com/us/products/239771/ishares-expanded-tech-software-sector-etf
- Lumentum: https://www.lumentum.com/en/solutions/ai-infrastructure
- Nokia: https://www.nokia.com/optical-networks/data-center-interconnect/
- Credo: https://credosemi.com/products/
- Astera Labs: https://www.asteralabs.com/about/
