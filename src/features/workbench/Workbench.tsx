import { useEffect, useMemo, useState } from "react";
import type { Watchlist } from "../../../shared/types";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

interface WorkbenchProps {
  api: WorkbenchApi;
}

export function Workbench({ api }: WorkbenchProps) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const watchlist: Watchlist | undefined = config?.watchlists.watchlists[0];

  useEffect(() => {
    let isMounted = true;

    void api.getConfig().then((loadedConfig) => {
      if (!isMounted) {
        return;
      }

      setConfig(loadedConfig);
      setExpandedRows(initialExpandedRows(loadedConfig.watchlists.watchlists[0]));
    });

    return () => {
      isMounted = false;
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

    void api.fetchSnapshots(activeSymbols);
  }, [api, activeSymbols]);

  if (!config || !watchlist) {
    return (
      <main className="workbench" aria-busy="true">
        <p className="loading-copy">Loading watchlists...</p>
      </main>
    );
  }

  return (
    <main className="workbench">
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
