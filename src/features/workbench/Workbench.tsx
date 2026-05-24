import { useEffect, useMemo, useState } from "react";
import type { RatePlanEvaluation, Watchlist } from "../../../shared/types";
import { RefreshControls } from "../settings/RefreshControls";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

interface WorkbenchProps {
  api: WorkbenchApi;
}

export function Workbench({ api }: WorkbenchProps) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [ratePlan, setRatePlan] = useState<RatePlanEvaluation>({
    status: "ok",
    plan: "paid",
    intervalSeconds: 30,
    estimatedCallsPerMinute: 0,
    message: "Refresh interval is within the configured budget.",
    disabledIntervals: [],
  });

  const watchlist: Watchlist | undefined = config?.watchlists.watchlists[0];

  useEffect(() => {
    let isStale = false;

    setConfig(null);
    setErrorMessage(null);
    setExpandedRows({});

    void api
      .getConfig()
      .then((loadedConfig) => {
        if (isStale) {
          return;
        }

        setConfig(loadedConfig);
        setErrorMessage(null);
        setExpandedRows(initialExpandedRows(loadedConfig.watchlists.watchlists[0]));
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setConfig(null);
        setExpandedRows({});
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
      .filter((row) => expandedRows[row.id])
      .flatMap((row) => row.symbols)
      .map((symbol) => symbol.toUpperCase());

    return [...new Set(symbols)];
  }, [expandedRows, watchlist]);

  useEffect(() => {
    if (activeSymbols.length === 0) {
      return;
    }

    let isStale = false;

    setErrorMessage(null);

    void api
      .fetchSnapshots(activeSymbols)
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setErrorMessage(formatErrorMessage(error, "Unable to refresh market snapshots."));
      });

    return () => {
      isStale = true;
    };
  }, [api, activeSymbols]);

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
        <p className="selected-watchlist">{watchlist.name}</p>
      </aside>

      <section className="watchlist-main" aria-label={`${watchlist.name} rows`}>
        {watchlist.rows.map((row) => {
          const isExpanded = expandedRows[row.id] ?? false;

          return (
            <section className="watchlist-row" key={row.id}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpandedRows((current) => ({
                    ...current,
                    [row.id]: !(current[row.id] ?? false),
                  }))
                }
              >
                {row.name}
              </button>

              {isExpanded ? (
                <table>
                  <tbody>
                    {row.symbols.map((symbol, index) => (
                      <tr key={`${symbol}-${index}`}>
                        <td>{symbol.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Sync paused</p>
              )}
            </section>
          );
        })}
      </section>
    </main>
  );
}

function initialExpandedRows(watchlist?: Watchlist): Record<string, boolean> {
  return Object.fromEntries(watchlist?.rows.map((row) => [row.id, row.expandedByDefault]) ?? []);
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
