import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PriceSeries } from "../../../shared/types";
import type { WorkbenchApi } from "../../shared/apiClient";
import { MetricHelp, type MetricExplanation } from "../../shared/MetricHelp";
import { useLocale } from "../../shared/locale";
import { activityExplanations } from "./metrics";
import { calculateMetrics } from "./calculateMetrics";
import { etfs, groups, type EtfGroup } from "./catalog";

export function SectorAnalytics({
  api,
  onHistoryRequests,
}: {
  api: WorkbenchApi;
  onHistoryRequests: Dispatch<SetStateAction<number>>;
}) {
  const { locale, t } = useLocale();
  const [group, setGroup] = useState<EtfGroup>("industry");
  const [symbol, setSymbol] = useState("SOXX");
  const [records, setRecords] = useState<Record<string, PriceSeries>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const cache = useRef<Record<string, PriceSeries>>({});
  const members = useMemo(
    () => etfs.filter((etf) => etf.group === group),
    [group],
  );
  const explanations = activityExplanations(locale);
  useEffect(() => {
    cache.current = {};
    setRecords({});
  }, [api]);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    setErrors([]);
    setRecords({ ...cache.current });
    const pending = [
      ...new Set(["SPY", ...members.map((etf) => etf.symbol)]),
    ].filter((ticker) => !cache.current[ticker]);
    async function worker() {
      while (pending.length && !stale) {
        const ticker = pending.shift()!;
        onHistoryRequests((count) => count + 1);
        try {
          const series = await api.getHistory(ticker, "1y");
          if (stale) return;
          cache.current[ticker] = series;
          setRecords((current) => ({ ...current, [ticker]: series }));
        } catch {
          if (!stale) setErrors((current) => [...current, ticker]);
        }
      }
    }
    void Promise.all([worker(), worker(), worker()]).then(() => {
      if (!stale) setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [api, members, reload, onHistoryRequests]);
  const metrics = useMemo(
    () =>
      Object.fromEntries(
        members.map((etf) => [
          etf.symbol,
          calculateMetrics(
            records[etf.symbol]?.bars ?? [],
            records.SPY?.bars ?? [],
          ),
        ]),
      ),
    [members, records],
  );
  const selected = etfs.find((etf) => etf.symbol === symbol)!;
  const current = metrics[symbol];
  const format = (value: number | null | undefined, suffix = "%") =>
    value == null
      ? "—"
      : `${value > 0 && suffix !== "×" ? "+" : ""}${value.toFixed(2)}${suffix}`;
  const available = Object.values(metrics).filter(
    (metric) => metric.return20 !== null,
  ).length;
  function metricCard(
    metric: MetricExplanation,
    value: number | null | undefined,
    suffix = "%",
  ) {
    return (
      <article className="analytics-metric">
        <div className="metric-label">
          <h4>{metric.title}</h4>
          <MetricHelp metric={metric} />
        </div>
        <p
          className={`activity-value ${suffix !== "×" && value != null && value > 0 ? "positive-change" : suffix !== "×" && value != null && value < 0 ? "negative-change" : ""}`}
        >
          {format(value, suffix)}
        </p>
      </article>
    );
  }
  return (
    <section
      className="sector-analytics"
      aria-label={t("Sector and ETF activity", "板块与 ETF 活跃度")}
    >
      <div className="analytics-intro">
        <div>
          <p className="eyebrow">{t("PRICE & VOLUME", "价格与成交量")}</p>
          <h3>
            {t("See rotation at every level", "从大板块到细分行业，观察轮动")}
          </h3>
          <p>
            {t(
              "23 ETFs across sectors, industries, themes and index benchmarks.",
              "23 只 ETF，覆盖标准板块、行业细分、主题和指数基准。",
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            cache.current = {};
            setReload((n) => n + 1);
          }}
        >
          {loading ? t("Loading…", "加载中…") : t("Refresh data", "刷新数据")}
        </button>
      </div>
      <div className="analytics-source-note" role="note">
        {t(
          "Calculated from existing daily price and volume data. No additional data subscription. These are activity indicators, not actual net fund flows or trading advice. Prices exclude reinvested dividends.",
          "使用现有日线价格和成交量计算，无需额外数据订阅。这些是活跃度指标，不是实际资金净流入或买卖建议；价格不含分红再投资。",
        )}
      </div>
      <div
        className="analytics-group-controls"
        aria-label={t("ETF groups", "ETF 分组")}
      >
        {groups.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={group === item.id}
            onClick={() => {
              if (group === item.id) return;
              setLoading(true);
              setGroup(item.id);
              setSymbol(etfs.find((etf) => etf.group === item.id)!.symbol);
            }}
          >
            {item[locale]}{" "}
            <span>{etfs.filter((etf) => etf.group === item.id).length}</span>
          </button>
        ))}
      </div>
      <p className="analytics-group-note">
        {group === "sector"
          ? t(
              "The 11 S&P 500 sectors provide a top-level view.",
              "11 个标普 500 标准板块，提供市场的一级视角。",
            )
          : group === "industry"
            ? t(
                "Industries reveal differences hidden inside broad sectors. SOXX and SMH both track semiconductors with different portfolios.",
                "行业细分揭示大板块内部的差异。SOXX 和 SMH 都观察半导体，但持仓与权重不同。",
              )
            : group === "theme"
              ? t(
                  "Themes can span multiple industries and overlap with sector ETFs.",
                  "主题可以跨越多个行业，并与板块 ETF 持仓重叠。",
                )
              : t(
                  "QQQ tracks the Nasdaq-100: large Nasdaq-listed non-financial companies, not a pure technology sector.",
                  "QQQ 跟踪纳斯达克 100：纳斯达克上市的大型非金融企业，并非纯科技板块。",
                )}
      </p>
      {errors.length > 0 && (
        <p className="workbench-error" role="alert">
          {t("Unable to load", "无法加载")} {errors.join(", ")}
          {t(". ", "。")}
          {t(
            "Other results remain available. Retry with Refresh data.",
            "其他结果仍可查看，可点击刷新数据重试。",
          )}
        </p>
      )}
      <p className="analytics-data-status" role="status">
        {loading
          ? t("Loading daily history…", "正在加载日线历史…")
          : t(
              `${available} / ${members.length} ETFs have a complete 20-session price window.`,
              `${available} / ${members.length} 只 ETF 具备完整的 20 日价格窗口。`,
            )}{" "}
        {t(
          "As-of dates are shown per ETF. — means missing or insufficient data.",
          "各 ETF 分别显示截至日期；— 表示数据缺失或不足。",
        )}
      </p>
      <p className="mobile-table-hint">
        {t(
          "Swipe the table to see all metrics →",
          "横向滑动表格，查看其余指标 →",
        )}
      </p>
      <div
        className="activity-table-scroll"
        role="region"
        aria-label={t("Scrollable ETF comparison", "可横向滚动的 ETF 对比")}
        tabIndex={0}
      >
        <table
          className="activity-table"
          aria-label={t("ETF comparison", "ETF 对比")}
        >
          <thead>
            <tr>
              <th>{t("ETF / exposure", "ETF / 观察范围")}</th>
              {[
                explanations.priceReturn(20),
                explanations.relative,
                explanations.rvol,
                explanations.cmf,
              ].map((metric) => (
                <th key={metric.title}>
                  <span className="metric-label">
                    {metric.title}
                    <MetricHelp metric={metric} />
                  </span>
                </th>
              ))}
              <th>{t("As of", "截至日期")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((etf) => {
              const m = metrics[etf.symbol];
              return (
                <tr
                  key={etf.symbol}
                  className={symbol === etf.symbol ? "selected-row" : undefined}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="symbol-button"
                      aria-label={etf.symbol}
                      aria-pressed={symbol === etf.symbol}
                      onClick={() => setSymbol(etf.symbol)}
                    >
                      <span>{etf.symbol}</span>
                      <small>{etf[locale]}</small>
                    </button>
                  </th>
                  <td>{format(m?.return20)}</td>
                  <td>{format(m?.relative20, t(" pp", " 个百分点"))}</td>
                  <td>{m?.rvol == null ? "—" : `${m.rvol.toFixed(2)}×`}</td>
                  <td>{format(m?.cmf, "")}</td>
                  <td>{m?.asOf ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="analytics-selection">
        <h3>
          {symbol} · {selected[locale]}
        </h3>
        <a href={selected.source} target="_blank" rel="noreferrer">
          {t("Issuer details", "发行商资料")}
        </a>
      </div>
      <div className="analytics-metrics">
        {metricCard(explanations.priceReturn(5), current?.return5)}
        {metricCard(explanations.priceReturn(20), current?.return20)}
        {metricCard(explanations.priceReturn(60), current?.return60)}
      </div>
      <div className="analytics-secondary">
        {metricCard(
          explanations.relative,
          current?.relative20,
          t(" pp", " 个百分点"),
        )}
        {metricCard(explanations.rvol, current?.rvol, "×")}
        {metricCard(explanations.cmf, current?.cmf, "")}
      </div>
      <p className="analytics-footnote">
        {t(
          "Holdings overlap across these groups, so ETF volumes are not added into a market-wide capital-flow total. Daily metrics exclude the current New York calendar date; check as-of dates for stale data. Click ⓘ for formulas and examples.",
          "这些分组的持仓可能重叠，因此不将成交量相加冒充全市场资金流。日线指标排除纽约当日数据；请留意截至日期，识别过期数据。点击 ⓘ 查看公式与例子。",
        )}
      </p>
    </section>
  );
}
