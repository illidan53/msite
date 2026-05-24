import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketSnapshot, PriceSeries, RatePlanEvaluation, Watchlist } from "../../../shared/types";
import { SymbolChart } from "../charts/SymbolChart";
import { RefreshControls } from "../settings/RefreshControls";
import { WatchlistEditor } from "../watchlists/WatchlistEditor";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

interface WorkbenchProps {
  api: WorkbenchApi;
}

export function Workbench({ api }: WorkbenchProps) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<PriceSeries["range"]>("1M");
  const [historySeries, setHistorySeries] = useState<PriceSeries | null>(null);
  const [snapshotsBySymbol, setSnapshotsBySymbol] = useState<Record<string, MarketSnapshot>>({});
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [ratePlan, setRatePlan] = useState<RatePlanEvaluation>({
    status: "ok",
    plan: "paid",
    intervalSeconds: 30,
    estimatedCallsPerMinute: 0,
    message: "Refresh interval is within the configured budget.",
    disabledIntervals: [],
  });
  const configRef = useRef<WorkbenchConfig | null>(null);
  const editorSessionIdRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const watchlists = config?.watchlists.watchlists ?? [];
  const watchlist: Watchlist | undefined =
    watchlists.find((candidate) => candidate.id === selectedWatchlistId) ?? watchlists[0];

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    let isStale = false;

    setConfig(null);
    configRef.current = null;
    setErrorMessage(null);
    setExpandedRows({});
    setSnapshotsBySymbol({});
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
        setExpandedRows(initialExpandedRows(loadedConfig.watchlists.watchlists));
        setSelectedWatchlistId(loadedConfig.watchlists.watchlists[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setConfig(null);
        configRef.current = null;
        setExpandedRows({});
        setSelectedWatchlistId(null);
        setErrorMessage(formatErrorMessage(error, "Unable to load workbench configuration."));
      });

    return () => {
      isStale = true;
    };
  }, [api]);

  const activeSymbols = useMemo(() => {
    if (!watchlist) {
      return [];
    }

    const symbols = watchlist.rows
      .filter((row) => expandedRows[rowExpansionKey(watchlist.id, row.id)])
      .flatMap((row) => row.symbols);

    return uniqueUppercaseSymbols(symbols);
  }, [expandedRows, watchlist]);

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
    if (!selectedSymbol) {
      setHistorySeries(null);
      setHistoryErrorMessage(null);
      return;
    }

    let isStale = false;

    setHistorySeries(null);
    setHistoryErrorMessage(null);

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
  }

  function handleEditorOpen() {
    editorSessionIdRef.current += 1;
    setIsEditorOpen(true);
  }

  function handleEditorClose() {
    editorSessionIdRef.current += 1;
    setIsEditorOpen(false);
  }

  function handleSaveWatchlist(savedWatchlist: Watchlist) {
    const saveSessionId = editorSessionIdRef.current;

    const savePromise = saveQueueRef.current.then(async () => {
      const currentConfig = configRef.current;

      if (!currentConfig) {
        throw new Error("Workbench configuration is not loaded.");
      }

      const existingWatchlists = currentConfig.watchlists.watchlists;
      const nextWatchlists = existingWatchlists.some((watchlistItem) => watchlistItem.id === savedWatchlist.id)
        ? existingWatchlists.map((watchlistItem) =>
            watchlistItem.id === savedWatchlist.id ? savedWatchlist : watchlistItem,
          )
        : [...existingWatchlists, savedWatchlist];
      const savedWatchlists = await api.saveWatchlists({
        ...currentConfig.watchlists,
        watchlists: nextWatchlists,
      });
      const nextConfig = { ...currentConfig, watchlists: savedWatchlists };

      configRef.current = nextConfig;
      setConfig(nextConfig);
      setExpandedRows(initialExpandedRows(savedWatchlists.watchlists));
      setSelectedWatchlistId(savedWatchlist.id);
      setSelectedSymbol(null);
      setHistorySeries(null);
      setHistoryErrorMessage(null);

      if (editorSessionIdRef.current === saveSessionId) {
        setIsEditorOpen(false);
      }
    });

    saveQueueRef.current = savePromise.catch(() => undefined);

    return savePromise;
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

      <header className="workbench-topbar">
        <div>
          <p className="workbench-kicker">Live workspace</p>
          <p className="workbench-title">{watchlist.name}</p>
        </div>
        <RefreshControls
          intervalSeconds={intervalSeconds}
          disabledIntervals={ratePlan.disabledIntervals}
          status={ratePlan.status}
          message={ratePlan.message}
          onChange={setIntervalSeconds}
        />
      </header>

      <aside className="watchlist-rail" aria-label="Watchlists">
        <h1>Stock Workbench</h1>
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
        <button type="button" className="new-watchlist-button" onClick={handleEditorOpen}>
          New Watchlist
        </button>
      </aside>

      <section className="watchlist-main" aria-label={`${watchlist.name} rows`}>
        {watchlist.rows.map((row) => {
          const rowKey = rowExpansionKey(watchlist.id, row.id);
          const isExpanded = expandedRows[rowKey] ?? false;
          const rowSymbols = uniqueUppercaseSymbols(row.symbols);

          return (
            <section className="watchlist-row" key={row.id}>
              <header className="watchlist-row-header">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedRows((current) => ({
                      ...current,
                      [rowKey]: !(current[rowKey] ?? false),
                    }))
                  }
                >
                  {row.name}
                </button>
                <span>{rowSymbols.length} symbols</span>
              </header>

              {isExpanded ? (
                <table className="quote-table">
                  <thead>
                    <tr>
                      <th scope="col">Symbol</th>
                      <th scope="col">Price</th>
                      <th scope="col">Change %</th>
                      <th scope="col">Volume</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowSymbols.map((symbol) => {
                      const snapshot = snapshotsBySymbol[symbol];

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
                          <td>{formatPrice(snapshot?.price)}</td>
                          <td className={formatChangeClass(snapshot?.changePercent)}>
                            {formatChangePercent(snapshot?.changePercent)}
                          </td>
                          <td>{formatVolume(snapshot?.volume)}</td>
                          <td>{formatUpdatedAt(snapshot?.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="row-paused-state">
                  <span>Sync paused</span>
                  <span>Stale until expanded</span>
                </p>
              )}
            </section>
          );
        })}
      </section>

      <section className="symbol-detail" aria-label="Symbol detail">
        <header className="symbol-detail-header">
          <h2>{selectedSymbol ?? "No symbol selected"}</h2>
          {selectedSymbol ? <span>{selectedRange}</span> : null}
        </header>

        {historyErrorMessage ? <ErrorAlert message={historyErrorMessage} /> : null}
        {selectedSymbol && historySeries ? (
          <SymbolChart
            symbol={selectedSymbol}
            series={historySeries}
            range={selectedRange}
            onRangeChange={setSelectedRange}
          />
        ) : null}
        {selectedSymbol && !historySeries && !historyErrorMessage ? (
          <p className="loading-copy">Loading chart...</p>
        ) : null}
      </section>

      <WatchlistEditor
        open={isEditorOpen}
        onClose={handleEditorClose}
        onSave={handleSaveWatchlist}
        recommend={api.recommendWatchlist}
      />
    </main>
  );
}

function initialExpandedRows(watchlists: Watchlist[] = []): Record<string, boolean> {
  return Object.fromEntries(
    watchlists.flatMap((watchlist) =>
      watchlist.rows.map((row) => [rowExpansionKey(watchlist.id, row.id), row.expandedByDefault]),
    ),
  );
}

function rowExpansionKey(watchlistId: string, rowId: string): string {
  return `${watchlistId}:${rowId}`;
}

function uniqueUppercaseSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
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

  if (volume >= 1_000_000_000) {
    return `${formatCompactNumber(volume / 1_000_000_000)}B`;
  }

  if (volume >= 1_000_000) {
    return `${formatCompactNumber(volume / 1_000_000)}M`;
  }

  if (volume >= 1_000) {
    return `${formatCompactNumber(volume / 1_000)}K`;
  }

  return volume.toLocaleString("en-US");
}

function formatCompactNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: value < 10 ? 1 : 0 });
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

function formatChangeClass(changePercent: MarketSnapshot["changePercent"] | undefined): string | undefined {
  if (changePercent === undefined || changePercent === null || changePercent === 0) {
    return undefined;
  }

  return changePercent > 0 ? "positive-change" : "negative-change";
}
