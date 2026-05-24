import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketSnapshot, PriceSeries, RatePlanEvaluation, Watchlist } from "../../../shared/types";
import { SymbolChart } from "../charts/SymbolChart";
import { RefreshControls } from "../settings/RefreshControls";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

interface WorkbenchProps {
  api: WorkbenchApi;
}

type SortMode = "config" | "size" | "heat" | "volume" | "changePercent" | "price" | "updated";
interface SpanMetric {
  change: number | null;
  changePercent: number | null;
}

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_RANGE: PriceSeries["range"] = "1h";
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const TIME_SPAN_OPTIONS: Array<{ label: string; value: PriceSeries["range"] }> = [
  { label: "1h", value: "1h" },
  { label: "1d", value: "1d" },
  { label: "5d", value: "5d" },
  { label: "30d", value: "30d" },
  { label: "3months", value: "3month" },
  { label: "1y", value: "1y" },
  { label: "5y", value: "5y" },
];
const SORT_OPTIONS: Array<{ id: SortMode; label: string }> = [
  { id: "config", label: "Config order" },
  { id: "size", label: "Size" },
  { id: "heat", label: "Heat" },
  { id: "volume", label: "Volume" },
  { id: "changePercent", label: "Session Chg %" },
  { id: "price", label: "Price" },
  { id: "updated", label: "Updated" },
];

export function Workbench({ api }: WorkbenchProps) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<PriceSeries["range"]>(DEFAULT_RANGE);
  const [historySeries, setHistorySeries] = useState<PriceSeries | null>(null);
  const [historyRequestCount, setHistoryRequestCount] = useState(0);
  const [snapshotsBySymbol, setSnapshotsBySymbol] = useState<Record<string, MarketSnapshot>>({});
  const [spanMetricsByKey, setSpanMetricsByKey] = useState<Record<string, SpanMetric>>({});
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_SECONDS);
  const [sortMode, setSortMode] = useState<SortMode>("config");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ratePlan, setRatePlan] = useState<RatePlanEvaluation>({
    status: "ok" as const,
    plan: "paid" as const,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    estimatedCallsPerMinute: 0,
    message: "Refresh interval is within the configured budget.",
    disabledIntervals: [] as number[],
  });
  const configRef = useRef<WorkbenchConfig | null>(null);

  const watchlists = config?.watchlists.watchlists ?? [];
  const watchlist: Watchlist | undefined =
    watchlists.find((candidate) => candidate.id === selectedWatchlistId) ?? watchlists[0];

  const activeSymbols = useMemo(() => (watchlist ? flattenWatchlistSymbols(watchlist) : []), [watchlist]);
  const allTrackedSymbols = useMemo(
    () => uniqueUppercaseSymbols(watchlists.flatMap((item) => item.rows.flatMap((row) => row.symbols))),
    [watchlists],
  );
  const spanMetricsBySymbol = useMemo(
    () => mapSpanMetricsForRange(activeSymbols, spanMetricsByKey, selectedRange),
    [activeSymbols, selectedRange, spanMetricsByKey],
  );
  const sortedSymbols = useMemo(
    () => sortSymbols(activeSymbols, snapshotsBySymbol, spanMetricsBySymbol, sortMode),
    [activeSymbols, snapshotsBySymbol, sortMode, spanMetricsBySymbol],
  );
  const totalPages = Math.max(1, Math.ceil(sortedSymbols.length / pageSize));
  const boundedPage = Math.min(currentPage, totalPages);
  const pageSymbols = useMemo(
    () => sortedSymbols.slice((boundedPage - 1) * pageSize, boundedPage * pageSize),
    [boundedPage, pageSize, sortedSymbols],
  );
  const spanSymbolsForHistory = useMemo(
    () => (sortMode === "heat" ? activeSymbols : pageSymbols),
    [activeSymbols, pageSymbols, sortMode],
  );
  const spanSymbolsForHistoryKey = spanSymbolsForHistory.join("|");
  const todayApiCalls = estimateTodayApiCalls(activeSymbols.length, intervalSeconds);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    let isStale = false;

    setConfig(null);
    configRef.current = null;
    setErrorMessage(null);
    setSnapshotsBySymbol({});
    setSpanMetricsByKey({});
    setSelectedWatchlistId(null);
    setSelectedSymbol(null);
    setHistorySeries(null);
    setHistoryErrorMessage(null);

    void api
      .getConfig()
      .then((loadedConfig) => {
        if (isStale) {
          return;
        }

        setConfig(loadedConfig);
        configRef.current = loadedConfig;
        setErrorMessage(null);
        setSelectedWatchlistId(loadedConfig.watchlists.watchlists[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setConfig(null);
        configRef.current = null;
        setSelectedWatchlistId(null);
        setErrorMessage(formatErrorMessage(error, "Unable to load workbench configuration."));
      });

    return () => {
      isStale = true;
    };
  }, [api]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, selectedWatchlistId, sortMode]);

  useEffect(() => {
    if (currentPage !== boundedPage) {
      setCurrentPage(boundedPage);
    }
  }, [boundedPage, currentPage]);

  useEffect(() => {
    if (activeSymbols.length === 0) {
      return;
    }

    let isStale = false;
    const pollingSymbols = [...activeSymbols];

    function refreshSnapshots() {
      setErrorMessage(null);

      void api
        .fetchSnapshots(pollingSymbols)
        .then((snapshots) => {
          if (isStale) {
            return;
          }

          setSnapshotsBySymbol((current) => ({
            ...current,
            ...Object.fromEntries(snapshots.map((snapshot) => [snapshot.symbol.toUpperCase(), snapshot])),
          }));
        })
        .catch((error: unknown) => {
          if (isStale) {
            return;
          }

          setErrorMessage(formatErrorMessage(error, "Unable to refresh market snapshots."));
        });
    }

    refreshSnapshots();

    const intervalId = window.setInterval(refreshSnapshots, intervalSeconds * 1000);

    return () => {
      isStale = true;
      window.clearInterval(intervalId);
    };
  }, [api, activeSymbols, intervalSeconds]);

  useEffect(() => {
    if (!config || spanSymbolsForHistory.length === 0) {
      return;
    }

    const missingSymbols = spanSymbolsForHistory.filter(
      (symbol) => spanMetricsByKey[spanMetricKey(symbol, selectedRange)] === undefined,
    );
    if (missingSymbols.length === 0) {
      return;
    }

    let isStale = false;

    setHistoryRequestCount((current) => current + missingSymbols.length);

    void Promise.all(
      missingSymbols.map(async (symbol) => {
        const series = await api.getHistory(symbol, selectedRange);
        return [spanMetricKey(symbol, selectedRange), spanMetricFromSeries(series)] as const;
      }),
    )
      .then((entries) => {
        if (isStale) {
          return;
        }

        setSpanMetricsByKey((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setErrorMessage(formatErrorMessage(error, "Unable to load selected time span movement."));
      });

    return () => {
      isStale = true;
    };
  }, [api, config, selectedRange, spanMetricsByKey, spanSymbolsForHistory, spanSymbolsForHistoryKey]);

  useEffect(() => {
    if (!selectedSymbol) {
      setHistorySeries(null);
      setHistoryErrorMessage(null);
      return;
    }

    let isStale = false;

    setHistorySeries(null);
    setHistoryErrorMessage(null);
    setHistoryRequestCount((current) => current + 1);

    void api
      .getHistory(selectedSymbol, selectedRange)
      .then((series) => {
        if (isStale) {
          return;
        }

        setHistorySeries(series);
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setHistorySeries(null);
        setHistoryErrorMessage(formatErrorMessage(error, "Unable to load price history."));
      });

    return () => {
      isStale = true;
    };
  }, [api, selectedRange, selectedSymbol]);

  useEffect(() => {
    if (!config) {
      return;
    }

    let isStale = false;

    void api
      .evaluateRatePlan({
        ...config.settings.polygon,
        activeSymbolCount: activeSymbols.length,
        cacheHitRatio: 0.3,
        endpointCount: 1,
        intervalSeconds,
      })
      .then((evaluation) => {
        if (isStale) {
          return;
        }

        setRatePlan(evaluation);
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setRatePlan((current) => ({
          ...current,
          status: "warning",
          message: formatErrorMessage(error, "Unable to evaluate refresh budget."),
        }));
      });

    return () => {
      isStale = true;
    };
  }, [api, activeSymbols.length, config, intervalSeconds]);

  function handleWatchlistSelect(nextWatchlistId: string) {
    setSelectedWatchlistId(nextWatchlistId);
    setSelectedSymbol(null);
    setHistorySeries(null);
    setHistoryErrorMessage(null);
  }

  function handleSymbolSelect(symbol: string) {
    setSelectedSymbol(symbol.toUpperCase());
    setHistorySeries(null);
    setHistoryErrorMessage(null);
  }

  function handleCloseDetails() {
    setSelectedSymbol(null);
    setHistorySeries(null);
    setHistoryErrorMessage(null);
  }

  if (errorMessage && !config) {
    return (
      <main className="workbench">
        <ErrorAlert message={errorMessage} />
      </main>
    );
  }

  if (!config || !watchlist) {
    return (
      <main className="workbench" aria-busy="true">
        <p className="loading-copy">Loading watchlists...</p>
      </main>
    );
  }

  return (
    <main className="workbench">
      {errorMessage ? <ErrorAlert message={errorMessage} /> : null}

      <header className="workbench-topbar" role="toolbar" aria-label="Table controls">
        <label htmlFor="time-span">Time span</label>
        <select
          id="time-span"
          value={selectedRange}
          onChange={(event) => setSelectedRange(event.target.value as PriceSeries["range"])}
        >
          {TIME_SPAN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <RefreshControls
          intervalSeconds={intervalSeconds}
          disabledIntervals={ratePlan.disabledIntervals}
          onChange={setIntervalSeconds}
        />

        <label htmlFor="sort-mode">Sort by</label>
        <select id="sort-mode" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <label htmlFor="page-size">Rows</label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </header>

      <aside className="watchlist-rail" aria-label="Watchlists">
        <h1>Stock Workbench</h1>
        <table className="usage-table" aria-label="API usage summary">
          <tbody>
            <tr>
              <th scope="row">Today's API calls</th>
              <td>{formatInteger(todayApiCalls)}</td>
            </tr>
            <tr>
              <th scope="row">Tracked symbols</th>
              <td>{formatInteger(allTrackedSymbols.length)}</td>
            </tr>
            <tr>
              <th scope="row">Historical API calls</th>
              <td>{formatInteger(historyRequestCount)}</td>
            </tr>
          </tbody>
        </table>
        <p role="status" className={`rate-status ${ratePlan.status}`}>
          {ratePlan.message}
        </p>
        <div className="watchlist-buttons">
          {watchlists.map((watchlistOption) => (
            <button
              key={watchlistOption.id}
              type="button"
              aria-pressed={watchlistOption.id === watchlist.id}
              className="watchlist-button"
              onClick={() => handleWatchlistSelect(watchlistOption.id)}
            >
              {watchlistOption.name}
            </button>
          ))}
        </div>
      </aside>

      <section className="watchlist-main" aria-label={`${watchlist.name} dashboard`}>
        <section className="watchlist-row sector-table-panel">
          <table className="quote-table sector-table" aria-label={`${watchlist.name} quotes`}>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Name</th>
                <th scope="col">Price</th>
                <th scope="col">Session Chg</th>
                <th scope="col">Session Chg %</th>
                <th scope="col">Span Chg</th>
                <th scope="col">Span Chg %</th>
                <th scope="col">Volume</th>
                <th scope="col">Dollar Volume</th>
                <th scope="col">Timeframe</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {pageSymbols.map((symbol) => {
                const snapshot = snapshotsBySymbol[symbol];
                const spanMetric = spanMetricsBySymbol[symbol];
                const sessionChange = snapshot?.sessionChange ?? snapshot?.change;
                const sessionChangePercent = snapshot?.sessionChangePercent ?? snapshot?.changePercent;

                return (
                  <tr key={symbol}>
                    <td>
                      <button
                        type="button"
                        className="symbol-button"
                        aria-pressed={selectedSymbol === symbol}
                        onClick={() => handleSymbolSelect(symbol)}
                      >
                        {symbol}
                      </button>
                    </td>
                    <td>{snapshot?.name ?? "--"}</td>
                    <td>{formatPrice(snapshot?.price)}</td>
                    <td className={formatChangeClass(sessionChange)}>{formatChange(sessionChange)}</td>
                    <td className={formatChangeClass(sessionChangePercent)}>
                      {formatChangePercent(sessionChangePercent)}
                    </td>
                    <td className={formatChangeClass(spanMetric?.change)}>{formatChange(spanMetric?.change)}</td>
                    <td className={formatChangeClass(spanMetric?.changePercent)}>
                      {formatChangePercent(spanMetric?.changePercent)}
                    </td>
                    <td>{formatVolume(snapshot?.volume)}</td>
                    <td>{formatDollarVolume(snapshot)}</td>
                    <td>{snapshot?.timeframe ?? "--"}</td>
                    <td>{formatUpdatedAt(snapshot?.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <nav className="pagination-controls" aria-label="Table pagination">
          <button type="button" disabled={boundedPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
            Previous page
          </button>
          <span>{`Page ${boundedPage} of ${totalPages}`}</span>
          <button
            type="button"
            disabled={boundedPage >= totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          >
            Next page
          </button>
        </nav>
      </section>

      {selectedSymbol ? (
        <div className="detail-overlay" onClick={handleCloseDetails}>
          <aside
            role="dialog"
            aria-label={`${selectedSymbol} details`}
            className="symbol-detail-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="symbol-detail-header">
              <div>
                <h2>{selectedSymbol}</h2>
                <span>{selectedRange}</span>
              </div>
              <button type="button" onClick={handleCloseDetails}>
                Close details
              </button>
            </header>

            {historyErrorMessage ? <ErrorAlert message={historyErrorMessage} /> : null}
            {historySeries ? (
              <SymbolChart
                symbol={selectedSymbol}
                series={historySeries}
                range={selectedRange}
                onRangeChange={setSelectedRange}
              />
            ) : null}
            {!historySeries && !historyErrorMessage ? <p className="loading-copy">Loading chart...</p> : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function flattenWatchlistSymbols(watchlist: Watchlist): string[] {
  return uniqueUppercaseSymbols(watchlist.rows.flatMap((row) => row.symbols));
}

function uniqueUppercaseSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function mapSpanMetricsForRange(
  symbols: string[],
  spanMetricsByKey: Record<string, SpanMetric>,
  range: PriceSeries["range"],
): Record<string, SpanMetric | undefined> {
  return Object.fromEntries(symbols.map((symbol) => [symbol, spanMetricsByKey[spanMetricKey(symbol, range)]]));
}

function spanMetricKey(symbol: string, range: PriceSeries["range"]): string {
  return `${symbol.toUpperCase()}:${range}`;
}

function spanMetricFromSeries(series: PriceSeries): SpanMetric {
  if (series.bars.length < 2) {
    return { change: null, changePercent: null };
  }

  const firstClose = series.bars[0]?.close;
  const lastClose = series.bars[series.bars.length - 1]?.close;
  if (!Number.isFinite(firstClose) || !Number.isFinite(lastClose)) {
    return { change: null, changePercent: null };
  }

  const change = lastClose - firstClose;
  return {
    change,
    changePercent: firstClose === 0 ? null : (change / firstClose) * 100,
  };
}

function sortSymbols(
  symbols: string[],
  snapshotsBySymbol: Record<string, MarketSnapshot>,
  spanMetricsBySymbol: Record<string, SpanMetric | undefined>,
  sortMode: SortMode,
): string[] {
  if (sortMode === "config") {
    return symbols;
  }

  return [...symbols].sort((left, right) => {
    const leftSnapshot = snapshotsBySymbol[left];
    const rightSnapshot = snapshotsBySymbol[right];
    const leftValue = sortValue(leftSnapshot, spanMetricsBySymbol[left], sortMode);
    const rightValue = sortValue(rightSnapshot, spanMetricsBySymbol[right], sortMode);

    if (leftValue === null && rightValue === null) {
      return symbols.indexOf(left) - symbols.indexOf(right);
    }

    if (leftValue === null) {
      return 1;
    }

    if (rightValue === null) {
      return -1;
    }

    if (rightValue === leftValue) {
      return symbols.indexOf(left) - symbols.indexOf(right);
    }

    return rightValue - leftValue;
  });
}

function sortValue(
  snapshot: MarketSnapshot | undefined,
  spanMetric: SpanMetric | undefined,
  sortMode: SortMode,
): number | null {
  if (!snapshot) {
    return null;
  }

  switch (sortMode) {
    case "size":
      return dollarVolume(snapshot) ?? snapshot.volume;
    case "heat": {
      const heatValue = spanMetric?.changePercent ?? snapshot.sessionChangePercent ?? snapshot.changePercent;
      return heatValue === null || heatValue === undefined ? null : Math.abs(heatValue);
    }
    case "volume":
      return snapshot.volume;
    case "changePercent":
      return snapshot.sessionChangePercent ?? snapshot.changePercent;
    case "price":
      return snapshot.price;
    case "updated": {
      if (!snapshot.updatedAt) {
        return null;
      }

      const timestamp = Date.parse(snapshot.updatedAt);
      return Number.isNaN(timestamp) ? null : timestamp;
    }
    case "config":
      return null;
  }
}

function dollarVolume(snapshot: MarketSnapshot | undefined): number | null {
  if (!snapshot || snapshot.price === null || snapshot.volume === null) {
    return null;
  }

  return snapshot.price * snapshot.volume;
}

function estimateTodayApiCalls(activeSymbolCount: number, intervalSeconds: number): number {
  if (activeSymbolCount === 0) {
    return 0;
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const elapsedMilliseconds = Math.max(0, now.getTime() - startOfDay.getTime());
  const intervalMilliseconds = intervalSeconds * 1000;
  const refreshes = Math.max(1, Math.ceil(elapsedMilliseconds / intervalMilliseconds));

  return refreshes * activeSymbolCount;
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <section className="workbench-error" role="alert">
      <p>{message}</p>
    </section>
  );
}

function formatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatPrice(price: MarketSnapshot["price"] | undefined): string {
  if (price === undefined || price === null) {
    return "--";
  }

  return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatChange(change: MarketSnapshot["change"] | undefined): string {
  if (change === undefined || change === null) {
    return "--";
  }

  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatChangePercent(changePercent: MarketSnapshot["changePercent"] | undefined): string {
  if (changePercent === undefined || changePercent === null) {
    return "--";
  }

  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

function formatVolume(volume: MarketSnapshot["volume"] | undefined): string {
  if (volume === undefined || volume === null) {
    return "--";
  }

  return formatCompactNumber(volume);
}

function formatDollarVolume(snapshot: MarketSnapshot | undefined): string {
  const value = dollarVolume(snapshot);

  if (value === null) {
    return "--";
  }

  return `$${formatCompactNumber(value)}`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${formatCompactDecimal(value / 1_000_000_000)}B`;
  }

  if (value >= 1_000_000) {
    return `${formatCompactDecimal(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${formatCompactDecimal(value / 1_000)}K`;
  }

  return value.toLocaleString("en-US");
}

function formatCompactDecimal(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: value < 10 ? 1 : 0 });
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatUpdatedAt(updatedAt: MarketSnapshot["updatedAt"] | undefined): string {
  if (!updatedAt) {
    return "--";
  }

  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return `${date.getUTCFullYear()}-${padTime(date.getUTCMonth() + 1)}-${padTime(date.getUTCDate())} ${padTime(
    date.getUTCHours(),
  )}:${padTime(date.getUTCMinutes())} UTC`;
}

function padTime(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatChangeClass(value: number | null | undefined): string | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }

  return value > 0 ? "positive-change" : "negative-change";
}
