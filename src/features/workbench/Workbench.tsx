import {
  LocaleProvider,
  LanguageSwitcher,
  useLocale,
} from "../../shared/locale";
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  Layers,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MarketSnapshot,
  PriceSeries,
  RatePlanEvaluation,
  Watchlist,
} from "../../../shared/types";
import { SymbolChart } from "../charts/SymbolChart";
import { RefreshControls } from "../settings/RefreshControls";
import type { WorkbenchApi, WorkbenchConfig } from "../../shared/apiClient";

import { SectorAnalytics } from "../analytics/SectorAnalytics";
import { MetricHelp } from "../../shared/MetricHelp";
import {
  watchlistPerformances,
  type WatchlistPerformance,
} from "./watchlistPerformance";
import { activityExplanations } from "../analytics/metrics";

interface WorkbenchProps {
  api: WorkbenchApi;
}

type SortMode =
  | "config"
  | "size"
  | "heat"
  | "volume"
  | "changePercent"
  | "price"
  | "updated";
interface SpanMetric {
  change: number | null;
  changePercent: number | null;
}

interface DetailRow {
  label: string;
  value: string;
  className?: string;
}

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_RANGE: PriceSeries["range"] = "1h";
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const TIME_SPAN_OPTIONS: Array<{ label: string; value: PriceSeries["range"] }> =
  [
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

export function Workbench(props: WorkbenchProps) {
  return (
    <LocaleProvider>
      <WorkbenchContent {...props} />
    </LocaleProvider>
  );
}

function WorkbenchContent({ api }: WorkbenchProps) {
  const { locale, t } = useLocale();
  const { span: spanChange, dollarVolume: dollarVolumeHelp } =
    activityExplanations(locale);
  const [activePage, setActivePage] = useState<"watchlist" | "analytics">(
    "watchlist",
  );
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(
    null,
  );
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(
    null,
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] =
    useState<PriceSeries["range"]>(DEFAULT_RANGE);
  const [historySeries, setHistorySeries] = useState<PriceSeries | null>(null);
  const [historyRequestCount, setHistoryRequestCount] = useState(0);
  const [quoteRequestCount, setQuoteRequestCount] = useState(0);
  const [snapshotRefreshFailed, setSnapshotRefreshFailed] = useState(false);
  const [lastQuoteRefreshAt, setLastQuoteRefreshAt] = useState<string | null>(
    null,
  );
  const [snapshotsBySymbol, setSnapshotsBySymbol] = useState<
    Record<string, MarketSnapshot>
  >({});
  const [spanMetricsByKey, setSpanMetricsByKey] = useState<
    Record<string, SpanMetric>
  >({});
  const [intervalSeconds, setIntervalSeconds] = useState(
    DEFAULT_INTERVAL_SECONDS,
  );
  const [sortMode, setSortMode] = useState<SortMode>("config");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedColumns, setExpandedColumns] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ratePlan, setRatePlan] = useState<RatePlanEvaluation>({
    status: "ok" as const,
    plan: "paid" as const,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    estimatedCallsPerMinute: 0,
    message: "Refresh interval is within the configured budget.",
    disabledIntervals: [] as number[],
  });
  const detailRef = useRef<HTMLElement | null>(null);
  const configRef = useRef<WorkbenchConfig | null>(null);

  const watchlists = config?.watchlists.watchlists ?? [];
  const watchlist: Watchlist | undefined =
    watchlists.find((candidate) => candidate.id === selectedWatchlistId) ??
    watchlists[0];
  const symbolDescriptions = watchlist?.symbolDescriptions ?? {};

  const activeSymbols = useMemo(
    () => (watchlist ? flattenWatchlistSymbols(watchlist) : []),
    [watchlist],
  );
  const allTrackedSymbols = useMemo(
    () =>
      uniqueUppercaseSymbols(
        watchlists.flatMap((item) => item.rows.flatMap((row) => row.symbols)),
      ),
    [watchlists],
  );
  const performanceByWatchlist = useMemo(
    () => watchlistPerformances(watchlists, snapshotsBySymbol),
    [watchlists, snapshotsBySymbol],
  );
  const shouldPollSnapshots = activePage === "watchlist" || watchlistOpen;
  const spanMetricsBySymbol = useMemo(
    () =>
      mapSpanMetricsForRange(activeSymbols, spanMetricsByKey, selectedRange),
    [activeSymbols, selectedRange, spanMetricsByKey],
  );
  const sortedSymbols = useMemo(
    () =>
      sortSymbols(
        activeSymbols,
        snapshotsBySymbol,
        spanMetricsBySymbol,
        sortMode,
      ),
    [activeSymbols, snapshotsBySymbol, sortMode, spanMetricsBySymbol],
  );
  const totalPages = Math.max(1, Math.ceil(sortedSymbols.length / pageSize));
  const boundedPage = Math.min(currentPage, totalPages);
  const pageSymbols = useMemo(
    () =>
      sortedSymbols.slice((boundedPage - 1) * pageSize, boundedPage * pageSize),
    [boundedPage, pageSize, sortedSymbols],
  );
  const spanSymbolsForHistory = useMemo(
    () => (sortMode === "heat" ? activeSymbols : pageSymbols),
    [activeSymbols, pageSymbols, sortMode],
  );
  const spanSymbolsForHistoryKey = spanSymbolsForHistory.join("|");
  const totalWorkbenchRequestCount = quoteRequestCount + historyRequestCount;
  const selectedSnapshot = selectedSymbol
    ? snapshotsBySymbol[selectedSymbol]
    : undefined;
  const selectedBusinessDescription = selectedSymbol
    ? symbolDescriptions[selectedSymbol]
    : undefined;
  const selectedSpanMetric = useMemo(() => {
    if (!selectedSymbol) {
      return undefined;
    }

    return (
      spanMetricsBySymbol[selectedSymbol] ??
      (historySeries ? spanMetricFromSeries(historySeries) : undefined)
    );
  }, [historySeries, selectedSymbol, spanMetricsBySymbol]);
  const selectedDetailRows = useMemo(
    () =>
      buildSymbolDetailRows(
        selectedSymbol,
        selectedSnapshot,
        selectedBusinessDescription,
        selectedSpanMetric,
        historySeries,
        selectedRange,
      ),
    [
      historySeries,
      selectedBusinessDescription,
      selectedRange,
      selectedSnapshot,
      selectedSpanMetric,
      selectedSymbol,
    ],
  );

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    let isStale = false;

    setConfig(null);
    configRef.current = null;
    setErrorMessage(null);
    setSnapshotsBySymbol({});
    setSnapshotRefreshFailed(false);
    setLastQuoteRefreshAt(null);
    setSpanMetricsByKey({});
    setQuoteRequestCount(0);
    setHistoryRequestCount(0);
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
        setSelectedWatchlistId(
          loadedConfig.watchlists.watchlists[0]?.id ?? null,
        );
      })
      .catch((error: unknown) => {
        if (isStale) {
          return;
        }

        setConfig(null);
        configRef.current = null;
        setSelectedWatchlistId(null);
        setErrorMessage(
          formatErrorMessage(error, "Unable to load workbench configuration."),
        );
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
    if (!shouldPollSnapshots || allTrackedSymbols.length === 0) return;
    let isStale = false;
    let refreshing = false;
    const batches: string[][] = [];
    for (let i = 0; i < allTrackedSymbols.length; i += 250)
      batches.push(allTrackedSymbols.slice(i, i + 250));

    async function refreshSnapshots() {
      if (refreshing) return;
      refreshing = true;
      setErrorMessage(null);
      setQuoteRequestCount((current) => current + batches.length);
      const results = await Promise.allSettled(
        batches.map((symbols) => api.fetchSnapshots(symbols)),
      );
      refreshing = false;
      if (isStale) return;
      setSnapshotsBySymbol((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          // An omitted quote is missing, not the previous refresh's value.
          for (const symbol of batches[index]) delete next[symbol];
          for (const snapshot of result.value) {
            const symbol = snapshot.symbol.toUpperCase();
            if (batches[index].includes(symbol)) next[symbol] = snapshot;
          }
        });
        return next;
      });
      const failure = results.find((result) => result.status === "rejected");
      setSnapshotRefreshFailed(Boolean(failure));
      if (failure?.status === "rejected")
        setErrorMessage(
          formatErrorMessage(
            failure.reason,
            "Unable to refresh market snapshots.",
          ),
        );
      if (results.some((result) => result.status === "fulfilled"))
        setLastQuoteRefreshAt(new Date().toISOString());
    }
    void refreshSnapshots();
    const intervalId = window.setInterval(
      () => void refreshSnapshots(),
      intervalSeconds * 1000,
    );
    return () => {
      isStale = true;
      window.clearInterval(intervalId);
    };
  }, [api, allTrackedSymbols, intervalSeconds, shouldPollSnapshots]);

  useEffect(() => {
    if (
      activePage !== "watchlist" ||
      !config ||
      spanSymbolsForHistory.length === 0
    ) {
      return;
    }

    const missingSymbols = spanSymbolsForHistory.filter(
      (symbol) =>
        spanMetricsByKey[spanMetricKey(symbol, selectedRange)] === undefined,
    );
    if (missingSymbols.length === 0) {
      return;
    }

    let isStale = false;

    setHistoryRequestCount((current) => current + missingSymbols.length);

    void Promise.all(
      missingSymbols.map(async (symbol) => {
        const series = await api.getHistory(symbol, selectedRange);
        return [
          spanMetricKey(symbol, selectedRange),
          spanMetricFromSeries(series),
        ] as const;
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

        setErrorMessage(
          formatErrorMessage(
            error,
            "Unable to load selected time span movement.",
          ),
        );
      });

    return () => {
      isStale = true;
    };
  }, [
    api,
    config,
    selectedRange,
    spanMetricsByKey,
    spanSymbolsForHistory,
    spanSymbolsForHistoryKey,
    activePage,
  ]);

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
        setHistoryErrorMessage(
          formatErrorMessage(error, "Unable to load price history."),
        );
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
        activeSymbolCount: allTrackedSymbols.length,
        cacheHitRatio: 0.3,
        endpointCount: Math.max(1, Math.ceil(allTrackedSymbols.length / 250)),
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
          message: formatErrorMessage(
            error,
            "Unable to evaluate refresh budget.",
          ),
        }));
      });

    return () => {
      isStale = true;
    };
  }, [api, allTrackedSymbols.length, config, intervalSeconds]);

  useEffect(() => {
    if (selectedSymbol && window.matchMedia?.("(max-width: 1100px)").matches) {
      detailRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, [selectedSymbol]);

  function handleWatchlistSelect(nextWatchlistId: string) {
    setActivePage("watchlist");
    setSelectedWatchlistId(nextWatchlistId);
    setSelectedSymbol(null);
    setHistorySeries(null);
    setHistoryErrorMessage(null);
  }

  function handleSymbolSelect(symbol: string) {
    if (selectedSymbol === symbol.toUpperCase()) return;
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
        <BrandBar />
        <ErrorAlert message={errorMessage} />
      </main>
    );
  }

  if (!config || !watchlist) {
    return (
      <main className="workbench" aria-busy="true">
        <BrandBar />
        <p className="loading-copy">{t("Loading watchlists...")}</p>
      </main>
    );
  }

  return (
    <main
      className={`workbench ${activePage === "analytics" ? "analytics-workbench" : selectedSymbol ? "has-selection" : ""}`}
    >
      <BrandBar />
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            {activePage === "analytics"
              ? t("ANALYTICS / SECTORS")
              : t("WATCHLIST / MARKET OVERVIEW")}
          </p>
          <div className="watchlist-heading-line">
            <h2>
              {activePage === "analytics"
                ? t("Sectors & ETFs")
                : t(watchlist.name)}
            </h2>
            {activePage === "watchlist" && (
              <>
                <PerformanceBadge
                  performance={performanceByWatchlist[watchlist.id]}
                  stale={snapshotRefreshFailed}
                />
                <MetricHelp
                  metric={{
                    title: t("Watchlist daily change", "列表日涨跌幅"),
                    meaning: t(
                      "An equal-weight view of the stocks in this watchlist for the latest available trading session.",
                      "用列表内股票的等权平均日涨跌幅，观察最近可用交易日的整体表现。",
                    ),
                    formula: t(
                      "Sum of valid daily percentage changes ÷ number of valid symbols on the same date. Symbols are deduplicated; each receives equal weight. Missing or older-session quotes are excluded, not counted as zero.",
                      "同一交易日有效标的的日涨跌幅之和 ÷ 有效标的数量。重复代码只算一次，每只股票权重相同；缺失或较旧日期的行情不计入，也不当作零。",
                    ),
                    example: t(
                      "Three stocks move +3%, −1%, +1%: the watchlist shows +1%. If only two are available, coverage is shown as 2/3 with an asterisk.",
                      "三只股票分别涨 +3%、−1%、+1%，列表显示 +1%。若仅两只数据有效，则显示覆盖 2/3，并加星号提示。",
                    ),
                    caveat: t(
                      "Uses the provider's daily change, with previous-session data outside the active session. The displayed date is authoritative. This is not your portfolio return and is unaffected by the chart range. Green means up, red means down; * flags incomplete coverage or a failed refresh.",
                      "采用接口日涨跌幅；非交易时段可使用上一交易日数据，以展示日期为准。这不是个人持仓收益，也不随图表区间变化。绿色为涨、红色为跌；* 表示数据覆盖不全或刷新失败。",
                    ),
                  }}
                />
              </>
            )}
          </div>
          {activePage === "watchlist" && (
            <p className="watchlist-performance-caption">
              {performanceDescription(
                performanceByWatchlist[watchlist.id],
                snapshotRefreshFailed,
                t,
              )}
            </p>
          )}
          {activePage === "analytics" ? (
            <p>
              {t(
                "23 ETFs · Daily price and volume",
                "23 只 ETF · 日线价格与成交量",
              )}
            </p>
          ) : (
            <p>
              {t(
                `${activeSymbols.length} symbols`,
                `${activeSymbols.length} 只标的`,
              )}{" "}
              <span aria-hidden="true">·</span> {t("USD")}{" "}
              <span aria-hidden="true">·</span> {t(watchlist.description ?? "")}
            </p>
          )}
        </div>
        <span className="market-note">
          {t("Source timing shown per symbol")}
        </span>
      </div>
      {activePage === "watchlist" && (
        <header
          className="workbench-topbar"
          role="toolbar"
          aria-label={t("Table controls")}
        >
          <span className="quote-refresh-status" aria-live="polite">
            {lastQuoteRefreshAt
              ? t(
                  `Last refreshed ${formatUpdatedAt(lastQuoteRefreshAt)}`,
                  `上次刷新 ${formatUpdatedAt(lastQuoteRefreshAt)}`,
                )
              : t("Refresh pending")}
          </span>

          <div className="control-field">
            <label htmlFor="time-span">{t("Time span")}</label>
            <select
              id="time-span"
              value={selectedRange}
              onChange={(event) =>
                setSelectedRange(event.target.value as PriceSeries["range"])
              }
            >
              {TIME_SPAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="control-field">
            <RefreshControls
              intervalSeconds={intervalSeconds}
              disabledIntervals={ratePlan.disabledIntervals}
              onChange={setIntervalSeconds}
            />
          </div>
          <div className="control-field">
            <label htmlFor="sort-mode">{t("Sort by")}</label>
            <select
              id="sort-mode"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="control-field">
            <label htmlFor="page-size">{t("Rows")}</label>
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
          </div>
          <button
            className="columns-toggle"
            type="button"
            aria-pressed={expandedColumns}
            onClick={() => setExpandedColumns(!expandedColumns)}
          >
            {t(expandedColumns ? "Essential columns" : "All columns")}
          </button>
        </header>
      )}

      <aside
        className="watchlist-rail"
        aria-label={t("Workspace sidebar", "工作区侧栏")}
      >
        <nav aria-label={t("Workspace navigation")}>
          <button
            type="button"
            className="rail-menu-toggle"
            aria-expanded={watchlistOpen}
            aria-controls="watchlist-menu"
            onClick={() => setWatchlistOpen(!watchlistOpen)}
          >
            <Layers size={17} aria-hidden="true" />
            <span>{t("Watchlist")}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div
            id="watchlist-menu"
            className="rail-submenu"
            hidden={!watchlistOpen}
          >
            <label className="mobile-watchlist" htmlFor="mobile-watchlist">
              {t("Watchlist")}
              <select
                id="mobile-watchlist"
                aria-label={t("Watchlist")}
                value={activePage === "watchlist" ? watchlist.id : ""}
                onChange={(event) => handleWatchlistSelect(event.target.value)}
              >
                <option value="" disabled>
                  {t("Choose a watchlist")}
                </option>
                {watchlists.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.name)} ·{" "}
                    {performanceLabel(
                      performanceByWatchlist[item.id],
                      snapshotRefreshFailed,
                    )}
                  </option>
                ))}
              </select>
            </label>
            {activePage === "watchlist" && (
              <div className="mobile-watchlist-performance">
                <span>{t("Daily change", "日涨跌")}</span>
                <PerformanceBadge
                  performance={performanceByWatchlist[watchlist.id]}
                  stale={snapshotRefreshFailed}
                />
              </div>
            )}
            <div className="watchlist-buttons">
              {watchlists.map((watchlistOption) => (
                <button
                  key={watchlistOption.id}
                  type="button"
                  aria-pressed={
                    activePage === "watchlist" &&
                    watchlistOption.id === watchlist.id
                  }
                  className="watchlist-button watchlist-performance-button"
                  aria-label={t(watchlistOption.name)}
                  aria-description={performanceDescription(
                    performanceByWatchlist[watchlistOption.id],
                    snapshotRefreshFailed,
                    t,
                  )}
                  onClick={() => handleWatchlistSelect(watchlistOption.id)}
                >
                  <span>{t(watchlistOption.name)}</span>
                  <PerformanceBadge
                    performance={performanceByWatchlist[watchlistOption.id]}
                    stale={snapshotRefreshFailed}
                  />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="rail-menu-toggle"
            aria-expanded={analyticsOpen}
            aria-controls="analytics-menu"
            onClick={() => setAnalyticsOpen(!analyticsOpen)}
          >
            <ChartNoAxesCombined size={17} aria-hidden="true" />
            <span>{t("Analytics")}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <div
            id="analytics-menu"
            className="rail-submenu"
            hidden={!analyticsOpen}
          >
            <button
              type="button"
              className="watchlist-button"
              aria-pressed={activePage === "analytics"}
              onClick={() => {
                setActivePage("analytics");
                handleCloseDetails();
              }}
            >
              {t("Sectors & ETFs")}
            </button>
          </div>
        </nav>
        <details className="connection-details">
          <summary>{t("Data connection")}</summary>
          <table className="usage-table" aria-label={t("API usage summary")}>
            <tbody>
              <tr>
                <th scope="row">{t("Quote requests this session")}</th>
                <td>{formatInteger(quoteRequestCount)}</td>
              </tr>
              <tr>
                <th scope="row">{t("Tracked symbols")}</th>
                <td>{formatInteger(allTrackedSymbols.length)}</td>
              </tr>
              <tr>
                <th scope="row">{t("History requests this session")}</th>
                <td>{formatInteger(historyRequestCount)}</td>
              </tr>
              <tr>
                <th scope="row">{t("REST requests this session")}</th>
                <td>{formatInteger(totalWorkbenchRequestCount)}</td>
              </tr>
            </tbody>
          </table>
          <p role="status" className={`rate-status ${ratePlan.status}`}>
            {locale === "en"
              ? ratePlan.message
              : localizedRateMessage(ratePlan)}
          </p>
        </details>
      </aside>

      {activePage === "analytics" ? (
        <SectorAnalytics api={api} onHistoryRequests={setHistoryRequestCount} />
      ) : (
        <>
          <section
            className="watchlist-main"
            aria-label={`${t(watchlist.name)} dashboard`}
          >
            {errorMessage ? <ErrorAlert message={errorMessage} /> : null}
            <section
              className={`watchlist-row sector-table-panel ${expandedColumns ? "expanded-columns" : "essential-columns"}`}
            >
              <table
                className="quote-table sector-table"
                aria-label={t(
                  `${watchlist.name} quotes`,
                  `${t(watchlist.name)}行情`,
                )}
              >
                <thead>
                  <tr>
                    <th scope="col">{t("Symbol")}</th>
                    <th scope="col">{t("Name")}</th>
                    <th scope="col">{t("Business")}</th>
                    <th scope="col">{t("Price")}</th>
                    <th scope="col">{t("Session Chg")}</th>
                    <th scope="col">{t("Session Chg %")}</th>
                    <th scope="col">{t("Span Chg")}</th>
                    <th scope="col" aria-label={t("Span Chg %")}>
                      <span className="metric-label">
                        {t("Span Chg %")}
                        <MetricHelp metric={spanChange} />
                      </span>
                    </th>
                    <th scope="col">{t("Volume")}</th>
                    <th scope="col" aria-label={t("Dollar Volume")}>
                      <span className="metric-label">
                        {t("Dollar Volume")}
                        <MetricHelp metric={dollarVolumeHelp} />
                      </span>
                    </th>
                    <th scope="col">{t("Timeframe")}</th>
                    <th scope="col">{t("Updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSymbols.map((symbol) => {
                    const snapshot = snapshotsBySymbol[symbol];
                    const spanMetric = spanMetricsBySymbol[symbol];
                    const sessionChange =
                      snapshot?.sessionChange ?? snapshot?.change;
                    const sessionChangePercent =
                      snapshot?.sessionChangePercent ?? snapshot?.changePercent;

                    return (
                      <tr
                        key={symbol}
                        className={
                          selectedSymbol === symbol ? "selected-row" : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="symbol-button"
                            aria-label={symbol}
                            aria-pressed={selectedSymbol === symbol}
                            onClick={() => handleSymbolSelect(symbol)}
                          >
                            <span>{symbol}</span>
                            {!expandedColumns ? (
                              <small>
                                {snapshot?.name ?? t("Quote unavailable")}
                              </small>
                            ) : null}
                          </button>
                        </td>
                        <td>{snapshot?.name ?? "--"}</td>
                        <td>{t(symbolDescriptions[symbol] ?? "--")}</td>
                        <td>
                          {formatPrice(snapshot?.price)}
                          {!expandedColumns ? (
                            <small className="quote-timing">
                              {t(snapshot?.timeframe ?? "Pending")}
                            </small>
                          ) : null}
                        </td>
                        <td className={formatChangeClass(sessionChange)}>
                          {formatChange(sessionChange)}
                        </td>
                        <td className={formatChangeClass(sessionChangePercent)}>
                          {formatChangePercent(sessionChangePercent)}
                        </td>
                        <td className={formatChangeClass(spanMetric?.change)}>
                          {formatChange(spanMetric?.change)}
                        </td>
                        <td
                          className={formatChangeClass(
                            spanMetric?.changePercent,
                          )}
                        >
                          {formatChangePercent(spanMetric?.changePercent)}
                        </td>
                        <td>{formatVolume(snapshot?.volume)}</td>
                        <td>{formatDollarVolume(snapshot)}</td>
                        <td>{t(snapshot?.timeframe ?? "--")}</td>
                        <td>{formatUpdatedAt(snapshot?.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <nav
              className="pagination-controls"
              aria-label={t("Table pagination")}
            >
              <button
                type="button"
                disabled={boundedPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                {t("Previous page")}
              </button>
              <span>
                {t(
                  `Page ${boundedPage} of ${totalPages}`,
                  `第 ${boundedPage} / ${totalPages} 页`,
                )}
              </span>
              <button
                type="button"
                disabled={boundedPage >= totalPages}
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                {t("Next page")}
              </button>
            </nav>
          </section>

          {selectedSymbol ? (
            <aside
              ref={detailRef}
              role="complementary"
              aria-label={t(
                `${selectedSymbol} details`,
                `${selectedSymbol} 详情`,
              )}
              className="symbol-detail-drawer"
            >
              <header className="symbol-detail-header">
                <div>
                  <h2>{selectedSymbol}</h2>
                  <span>{selectedSnapshot?.name ?? selectedSymbol}</span>
                </div>
                <button type="button" onClick={handleCloseDetails}>
                  {t("Close details")}
                </button>
              </header>

              <div className="detail-price">
                <strong>{formatPrice(selectedSnapshot?.price)}</strong>
                <span
                  className={formatChangeClass(
                    selectedSnapshot?.sessionChangePercent ??
                      selectedSnapshot?.changePercent,
                  )}
                >
                  {formatChangePercent(
                    selectedSnapshot?.sessionChangePercent ??
                      selectedSnapshot?.changePercent,
                  )}{" "}
                  <small>{t("session")}</small>
                </span>
                <p>
                  {t(selectedSnapshot?.timeframe ?? "Timing unavailable")} ·{" "}
                  {t("Quote as of", "行情截至")}{" "}
                  {formatUpdatedAt(selectedSnapshot?.updatedAt)}
                </p>
              </div>
              <div className="chart-region">
                {historyErrorMessage ? (
                  <ErrorAlert message={historyErrorMessage} />
                ) : null}
                {historySeries ? (
                  <SymbolChart
                    symbol={selectedSymbol}
                    series={historySeries}
                    range={selectedRange}
                    onRangeChange={setSelectedRange}
                  />
                ) : null}
                {!historySeries && !historyErrorMessage ? (
                  <p className="loading-copy">{t("Loading chart...")}</p>
                ) : null}
              </div>
              {selectedDetailRows.length > 0 ? (
                <section
                  className="symbol-detail-summary"
                  aria-label={t(
                    `${selectedSymbol} summary`,
                    `${selectedSymbol} 摘要`,
                  )}
                >
                  <details>
                    <summary>{t("Quote & range details")}</summary>
                    <table
                      className="detail-summary-table"
                      aria-label={t(
                        `${selectedSymbol} detail summary`,
                        `${selectedSymbol} 详情摘要`,
                      )}
                    >
                      <tbody>
                        {selectedDetailRows.map((row) => (
                          <tr key={row.label}>
                            <th scope="row">{t(row.label)}</th>
                            <td className={row.className}>{t(row.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </section>
              ) : null}
            </aside>
          ) : (
            <aside
              className="symbol-detail-drawer detail-empty"
              aria-label={t("Stock analysis")}
            >
              <ChartNoAxesCombined size={36} aria-hidden="true" />
              <p className="eyebrow">{t("FOCUS VIEW")}</p>
              <h2>{t("A closer look.")}</h2>
              <p>
                {t(
                  "Select a symbol to explore its price history and quote details alongside your watchlist.",
                )}
              </p>
              <button
                type="button"
                disabled={!pageSymbols[0]}
                onClick={() => handleSymbolSelect(pageSymbols[0])}
              >
                {t("Explore", "查看")} {pageSymbols[0] ?? t("a symbol")}
              </button>
            </aside>
          )}
        </>
      )}
    </main>
  );
}

function flattenWatchlistSymbols(watchlist: Watchlist): string[] {
  return uniqueUppercaseSymbols(watchlist.rows.flatMap((row) => row.symbols));
}

function uniqueUppercaseSymbols(symbols: string[]): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  ];
}

function mapSpanMetricsForRange(
  symbols: string[],
  spanMetricsByKey: Record<string, SpanMetric>,
  range: PriceSeries["range"],
): Record<string, SpanMetric | undefined> {
  return Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      spanMetricsByKey[spanMetricKey(symbol, range)],
    ]),
  );
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
    const leftValue = sortValue(
      leftSnapshot,
      spanMetricsBySymbol[left],
      sortMode,
    );
    const rightValue = sortValue(
      rightSnapshot,
      spanMetricsBySymbol[right],
      sortMode,
    );

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
      const heatValue =
        spanMetric?.changePercent ??
        snapshot.sessionChangePercent ??
        snapshot.changePercent;
      return heatValue === null || heatValue === undefined
        ? null
        : Math.abs(heatValue);
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

function ErrorAlert({ message }: { message: string }) {
  const { locale } = useLocale();
  return (
    <section className="workbench-error" role="alert">
      <p>{locale === "en" ? message : "数据加载失败，请稍后重试。"}</p>
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

function formatChangePercent(
  changePercent: MarketSnapshot["changePercent"] | undefined,
): string {
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

function buildSymbolDetailRows(
  selectedSymbol: string | null,
  snapshot: MarketSnapshot | undefined,
  businessDescription: string | undefined,
  spanMetric: SpanMetric | undefined,
  historySeries: PriceSeries | null,
  selectedRange: PriceSeries["range"],
): DetailRow[] {
  if (!selectedSymbol) {
    return [];
  }

  const sessionChange = snapshot?.sessionChange ?? snapshot?.change;
  const sessionChangePercent =
    snapshot?.sessionChangePercent ?? snapshot?.changePercent;
  const rows: DetailRow[] = [
    { label: "Symbol", value: selectedSymbol },
    { label: "Name", value: snapshot?.name ?? "--" },
    { label: "Business", value: businessDescription ?? "--" },
    { label: "Price", value: formatPrice(snapshot?.price) },
    {
      label: "Session Chg",
      value: formatChange(sessionChange),
      className: formatChangeClass(sessionChange),
    },
    {
      label: "Session Chg %",
      value: formatChangePercent(sessionChangePercent),
      className: formatChangeClass(sessionChangePercent),
    },
    {
      label: "Span Chg",
      value: formatChange(spanMetric?.change),
      className: formatChangeClass(spanMetric?.change),
    },
    {
      label: "Span Chg %",
      value: formatChangePercent(spanMetric?.changePercent),
      className: formatChangeClass(spanMetric?.changePercent),
    },
    { label: "Volume", value: formatVolume(snapshot?.volume) },
    { label: "Dollar Volume", value: formatDollarVolume(snapshot) },
    { label: "Timeframe", value: snapshot?.timeframe ?? "--" },
    { label: "Updated", value: formatUpdatedAt(snapshot?.updatedAt) },
    { label: "Time Span", value: formatRangeLabel(selectedRange) },
  ];

  const seriesSummary = summarizeSeries(historySeries);
  if (!seriesSummary) {
    return rows;
  }

  return [
    ...rows,
    { label: "Range Open", value: formatPrice(seriesSummary.open) },
    { label: "Range High", value: formatPrice(seriesSummary.high) },
    { label: "Range Low", value: formatPrice(seriesSummary.low) },
    { label: "Range Close", value: formatPrice(seriesSummary.close) },
    { label: "Range Volume", value: formatVolume(seriesSummary.volume) },
    { label: "Bars", value: formatInteger(seriesSummary.bars) },
    {
      label: "First Bar",
      value: formatUpdatedAt(seriesSummary.firstTimestamp),
    },
    { label: "Last Bar", value: formatUpdatedAt(seriesSummary.lastTimestamp) },
  ];
}

function summarizeSeries(series: PriceSeries | null) {
  if (!series || series.bars.length === 0) {
    return null;
  }

  const firstBar = series.bars[0];
  const lastBar = series.bars[series.bars.length - 1];

  return {
    open: firstBar.open,
    high: Math.max(...series.bars.map((bar) => bar.high)),
    low: Math.min(...series.bars.map((bar) => bar.low)),
    close: lastBar.close,
    volume: series.bars.reduce((total, bar) => total + bar.volume, 0),
    bars: series.bars.length,
    firstTimestamp: firstBar.timestamp,
    lastTimestamp: lastBar.timestamp,
  };
}

function formatRangeLabel(range: PriceSeries["range"]): string {
  return (
    TIME_SPAN_OPTIONS.find((option) => option.value === range)?.label ?? range
  );
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
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value < 10 ? 1 : 0,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatUpdatedAt(
  updatedAt: MarketSnapshot["updatedAt"] | undefined,
): string {
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

function formatChangeClass(
  value: number | null | undefined,
): string | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }

  return value > 0 ? "positive-change" : "negative-change";
}

function BrandBar() {
  const { t } = useLocale();
  return (
    <header className="brand-bar">
      <div className="brand">
        <span className="brand-mark">
          <Activity size={20} aria-hidden="true" />
        </span>
        <h1>{t("Stock Workbench")}</h1>
      </div>
      <div className="brand-actions">
        <span className="brand-caption">
          {t("MARKET OBSERVATORY / US EQUITIES")}
        </span>
        <LanguageSwitcher />
      </div>
    </header>
  );
}

function localizedRateMessage(plan: RatePlanEvaluation): string {
  if (plan.message.includes("Unable") || plan.message.includes("failed"))
    return "暂时无法评估刷新预算。";
  if (plan.plan === "paid")
    return plan.status === "ok"
      ? "当前套餐在刷新预算模型中不限制接口调用次数。"
      : "刷新频率较高，可能增加本地负载。";
  return `预计每分钟 ${plan.estimatedCallsPerMinute} 次请求，${plan.status === "ok" ? "在配置预算内" : plan.status === "blocked" ? "已超出配置预算" : "接近配置预算"}。`;
}

function performanceLabel(
  performance: WatchlistPerformance | undefined,
  stale: boolean,
): string {
  return `${formatChangePercent(performance?.changePercent)}${performance?.changePercent != null && (stale || performance.covered < performance.total) ? "*" : ""}`;
}

function performanceDescription(
  performance: WatchlistPerformance | undefined,
  stale: boolean,
  t: (en: string, zh?: string) => string,
): string {
  return t(
    `Equal-weight daily change · ${performance?.sessionDate ?? "Date unavailable"} · ${performance?.covered ?? 0}/${performance?.total ?? 0} symbols${stale ? " · Refresh failed; last available data" : ""}`,
    `等权日涨跌 · ${performance?.sessionDate ?? "日期待更新"} · 覆盖 ${performance?.covered ?? 0}/${performance?.total ?? 0} 只${stale ? " · 刷新失败，显示上次可用数据" : ""}`,
  );
}

function PerformanceBadge({
  performance,
  stale,
}: {
  performance: WatchlistPerformance | undefined;
  stale: boolean;
}) {
  const { t } = useLocale();
  return (
    <span
      className={`watchlist-performance ${formatChangeClass(performance?.changePercent) ?? "neutral-change"}`}
      title={performanceDescription(performance, stale, t)}
      aria-label={`${t("Daily change", "日涨跌")} ${performanceLabel(performance, stale)}`}
    >
      {performanceLabel(performance, stale)}
    </span>
  );
}
