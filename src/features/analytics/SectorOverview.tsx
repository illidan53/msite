import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceSeries } from "../../../shared/types";
import { useLocale } from "../../shared/locale";
import { MetricHelp } from "../../shared/MetricHelp";
import { activityExplanations } from "./metrics";
import { etfs, groups, type EtfGroup } from "./catalog";
import {
  buildOverview,
  linePath,
  type OverviewMetric,
  type OverviewData,
} from "./overviewData";
import "./overview.css";

const colors = ["#5652b5", "#167479", "#a45d10", "#b44279", "#556273"];
const dashes = [undefined, "8 3", "3 3", "10 3 2 3", "5 5"];
const format = (value: number | null | undefined, suffix = "%") =>
  value == null
    ? "—"
    : `${value > 0 && suffix !== "×" ? "+" : ""}${value.toFixed(2)}${suffix}`;

export function SectorOverview({
  records,
  loading,
  onExplore,
}: {
  records: Record<string, PriceSeries>;
  loading: boolean;
  onExplore: (group: EtfGroup, symbol: string) => void;
}) {
  const { locale, t } = useLocale();
  const [sessions, setSessions] = useState(60);
  const [metric, setMetric] = useState<OverviewMetric>("relative20");
  const [compared, setCompared] = useState(["SOXX", "IGV", "QQQ", "XLK"]);
  const data = useMemo(
    () => buildOverview(records, sessions),
    [records, sessions],
  );
  const explanations = activityExplanations(locale);
  const options = [
    {
      id: "relative20",
      help: explanations.relative,
      unit: t(" pp", " 个百分点"),
      scale: 10,
    },
    { id: "return5", help: explanations.priceReturn(5), unit: "%", scale: 10 },
    {
      id: "return20",
      help: explanations.priceReturn(20),
      unit: "%",
      scale: 20,
    },
    {
      id: "return60",
      help: explanations.priceReturn(60),
      unit: "%",
      scale: 30,
    },
    { id: "rvol", help: explanations.rvol, unit: "×", scale: 2 },
    { id: "cmf", help: explanations.cmf, unit: "", scale: 1 },
  ] as const;
  const active = options.find((option) => option.id === metric)!;
  const lastDate = data.dates.at(-1);
  const heatColor = (value: number | null | undefined) => {
    if (value == null) return undefined;
    if (metric === "rvol")
      return `rgb(86 82 181 / ${Math.min(value / 2, 1) * 0.23})`;
    return `rgb(${value >= 0 ? "22 116 121" : "174 93 25"} / ${Math.min(Math.abs(value) / active.scale, 1) * 0.25})`;
  };
  return (
    <div className="rotation-overview">
      <div className="overview-toolbar">
        <div>
          <p className="eyebrow">{t("THE BIG PICTURE", "市场全景")}</p>
          <h3>{t("Rotation overview", "板块轮动总览")}</h3>
        </div>
        <label>
          {t("Lookback", "观察区间")}
          <select
            aria-label={t("Lookback", "观察区间")}
            value={sessions}
            onChange={(event) => setSessions(Number(event.target.value))}
          >
            <option value={60}>
              {t("60 trading sessions", "60 个交易日")}
            </option>
            <option value={120}>
              {t("120 trading sessions", "120 个交易日")}
            </option>
          </select>
        </label>
      </div>
      <p className="overview-caption">
        {t("Shared calendar: SPY", "统一交易日历：SPY")} ·{" "}
        {data.dates[0] ?? "—"} → {lastDate ?? "—"} ·{" "}
        {Math.max(0, data.dates.length - 1)}{" "}
        {t("sessions available", "个可用交易日区间")}
      </p>
      {!lastDate && (
        <p role="status" className="overview-empty">
          {loading
            ? t(
                "Waiting for the shared trading calendar…",
                "正在加载统一交易日历…",
              )
            : t(
                "SPY history is unavailable. Refresh data to build comparable charts.",
                "SPY 历史不可用，请刷新数据以生成同日期对比图。",
              )}
        </p>
      )}
      <section
        className="overview-panel"
        aria-label={t("Price paths", "价格走势对比")}
      >
        <div className="overview-panel-heading">
          <div>
            <p className="eyebrow">01 / {t("COMPARE", "走势对比")}</p>
            <h4>
              {t(
                "One starting point. Different paths.",
                "同一起点，看走势分化",
              )}
            </h4>
          </div>
          <MetricHelp
            metric={{
              title: t("Rebased price paths", "同起点价格走势"),
              meaning: t(
                "Compare cumulative price changes from the same date, regardless of ETF share price.",
                "把不同价格的 ETF 放到同一起点，比较此后的累计涨跌。",
              ),
              formula: t(
                "(Daily close ÷ close on the shared first date − 1) × 100%. SPY uses the same formula. The baseline is 0%.",
                "（每日收盘价 ÷ 统一起始日收盘价 − 1）× 100%。SPY 也采用同一公式，起点为 0%。",
              ),
              example: t(
                "An ETF moves $100 → $110, SPY $200 → $210: the lines end at +10% and +5%.",
                "ETF 从 100 涨到 110，SPY 从 200 涨到 210：两条线分别到达 +10% 和 +5%。",
              ),
              caveat: t(
                "Prices exclude reinvested dividends. Missing dates break the line; a missing starting price leaves the entire series blank. Use the date slider for exact values. At most four ETFs plus SPY are plotted.",
                "不含分红再投资。缺失日期处断线，缺少起始日价格则整条线留空。拖动日期滑块可读精确数值；最多同时对比 4 只 ETF 与 SPY。",
              ),
            }}
          />
        </div>
        <p className="overview-caption">
          {t(
            "Choose up to 4 ETFs; SPY stays as the benchmark. Use the date slider to inspect changes.",
            "选择最多 4 只 ETF，与固定基准 SPY 对比。拖动日期滑块查看每日变化。",
          )}
        </p>
        <details className="overview-picker">
          <summary>
            {t("Choose ETFs", "选择对比 ETF")}{" "}
            <span>{compared.join(" · ")} · SPY</span>
          </summary>
          {groups.map((group) => (
            <fieldset key={group.id}>
              <legend>{group[locale]}</legend>
              <div>
                {etfs
                  .filter(
                    (etf) => etf.group === group.id && etf.symbol !== "SPY",
                  )
                  .map((etf) => (
                    <label key={etf.symbol}>
                      <input
                        type="checkbox"
                        checked={compared.includes(etf.symbol)}
                        disabled={
                          !compared.includes(etf.symbol) && compared.length >= 4
                        }
                        onChange={() =>
                          setCompared((current) =>
                            current.includes(etf.symbol)
                              ? current.filter(
                                  (symbol) => symbol !== etf.symbol,
                                )
                              : [...current, etf.symbol],
                          )
                        }
                      />
                      <span>
                        <strong>{etf.symbol}</strong> {etf[locale]}
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
        </details>
        <PricePaths data={data} symbols={[...compared, "SPY"]} />
      </section>
      <section
        className="overview-panel overview-heat-panel"
        aria-label={t("Rotation heatmap", "轮动热力图")}
      >
        <div className="overview-panel-heading">
          <div>
            <p className="eyebrow">
              02 / {t("SCAN ALL 23", "扫描全部 23 只 ETF")}
            </p>
            <h4>
              {t("See where the pattern changes", "沿时间观察，强弱如何切换")}
            </h4>
          </div>
          <div className="overview-metric-select">
            <label>
              {t("Heatmap metric", "热力图指标")}
              <select
                aria-label={t("Heatmap metric", "热力图指标")}
                value={metric}
                onChange={(event) =>
                  setMetric(event.target.value as OverviewMetric)
                }
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.help.title}
                  </option>
                ))}
              </select>
            </label>
            <MetricHelp metric={active.help} />
          </div>
        </div>
        <p className="overview-caption">
          {t(
            "Each column is a historical snapshot, sampled every 5 trading sessions. Each cell uses only data available through its date. Click an ETF to open its details.",
            "每列为一个历史时点，间隔 5 个交易日；每格只使用截至该日的数据计算。点击 ETF 可进入所属分组查看详情。",
          )}
        </p>
        <div
          className="heatmap-legend"
          aria-label={t("Color scale", "色阶说明")}
        >
          {(metric === "rvol"
            ? [0, 1, 2]
            : [-active.scale, 0, active.scale]
          ).map((value, index) => (
            <span key={value}>
              <i style={{ background: heatColor(value) }} />
              {index === 2
                ? "≥ "
                : index === 0 && metric !== "rvol"
                  ? "≤ "
                  : ""}
              {format(value, active.unit)}
            </span>
          ))}
          <span>
            <i className="heatmap-missing" />
            {t("Missing", "缺失")}
          </span>
        </div>
        <p className="overview-caption">
          {metric === "rvol"
            ? t(
                "Darker purple = higher trading activity, not an inflow direction. 1× is the earlier volume baseline.",
                "紫色越深表示成交更活跃，不代表资金流入方向；1 倍为此前成交量基准。",
              )
            : metric === "cmf"
              ? t(
                  "Teal = closes skew higher in the daily range; amber = lower. The color does not measure capital flows.",
                  "青色表示收盘位置偏高，琥珀色表示偏低；颜色不表示真实资金流。",
                )
              : t(
                  "Teal = positive; amber = negative. Relative outperformance can still accompany a price loss. Colors saturate at the legend limits; numbers remain exact to 2 decimals.",
                  "青色为正，琥珀色为负。相对跑赢仍可能伴随价格下跌。超出色阶端点后颜色不再加深，数值仍保留两位小数。",
                )}
        </p>
        <p className="mobile-table-hint">
          {t(
            "Scroll horizontally to follow the full timeline →",
            "横向滑动，查看完整时间轴 →",
          )}
        </p>
        <div
          className="overview-heat-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Scrollable rotation history", "可横向滚动的轮动历史")}
        >
          <table
            className="overview-heatmap"
            aria-label={`${t("Rotation history", "轮动历史")} · ${active.help.title}`}
          >
            <thead>
              <tr>
                <th scope="col">{t("ETF / exposure", "ETF / 观察范围")}</th>
                {data.sampleIndices.map((index) => (
                  <th key={index} scope="col">
                    <time dateTime={data.dates[index]}>
                      {data.dates[index].slice(5)}
                    </time>
                  </th>
                ))}
                <th scope="col">{t("5-session change", "近 5 日变化")}</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.id}>
                <tr className="heatmap-group">
                  <th colSpan={data.sampleIndices.length + 2} scope="rowgroup">
                    {group[locale]}
                  </th>
                </tr>
                {etfs
                  .filter((etf) => etf.group === group.id)
                  .map((etf) => {
                    const points = data.series[etf.symbol] ?? [];
                    const current = points.at(-1)?.metrics?.[metric];
                    const previous = points.at(-6)?.metrics?.[metric];
                    const delta =
                      current != null && previous != null
                        ? current - previous
                        : null;
                    return (
                      <tr key={etf.symbol}>
                        <th scope="row">
                          <button
                            type="button"
                            className="heatmap-symbol"
                            aria-label={t(
                              `Explore ${etf.symbol}`,
                              `查看 ${etf.symbol}`,
                            )}
                            onClick={() => onExplore(etf.group, etf.symbol)}
                          >
                            <strong>{etf.symbol}</strong>
                            <small>{etf[locale]}</small>
                          </button>
                          {data.asOf[etf.symbol] !== lastDate && (
                            <small className="heatmap-stale">
                              {t("As of", "截至")}{" "}
                              {data.asOf[etf.symbol] ?? "—"}
                            </small>
                          )}
                        </th>
                        {data.sampleIndices.map((index) => {
                          const value = points[index]?.metrics?.[metric];
                          return (
                            <td
                              key={index}
                              className={
                                value == null ? "heatmap-missing" : undefined
                              }
                              style={{ backgroundColor: heatColor(value) }}
                              title={`${etf.symbol} · ${data.dates[index]} · ${active.help.title}: ${format(value, active.unit)}`}
                            >
                              {metric === "rvol" && value != null
                                ? value.toFixed(2)
                                : format(value, "")}
                            </td>
                          );
                        })}
                        <td className="heatmap-delta">
                          {format(
                            delta,
                            metric === "rvol"
                              ? "×"
                              : metric === "cmf"
                                ? ""
                                : t(" pp", " 个百分点"),
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </div>
        <p className="overview-caption heatmap-footer">
          {t(
            `Cell unit: ${active.unit || "unitless"}. 5-session change = latest metric − its value 5 sessions earlier; return changes use percentage points. Row dates mark missing or stale history. The scale stays fixed when the lookback changes.`,
            `单元格单位：${active.unit || "无量纲"}。近 5 日变化 = 最新指标 − 5 个交易日前的指标；涨跌幅的变化以百分点计。行内日期提示缺失或过期历史；切换观察区间时色阶保持固定。`,
          )}
        </p>
      </section>
    </div>
  );
}

function PricePaths({
  data,
  symbols,
}: {
  data: OverviewData;
  symbols: string[];
}) {
  const { t } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [inspection, setInspection] = useState<{
    date: string;
    index: number;
  } | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(300, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const values = symbols.flatMap((symbol) =>
    (data.series[symbol] ?? []).flatMap((point) =>
      point.priceChange == null ? [] : [point.priceChange],
    ),
  );
  const lower = Math.min(0, ...values),
    upper = Math.max(0, ...values);
  const padding = Math.max(1, (upper - lower) * 0.1);
  const min = lower - padding,
    max = upper + padding;
  const x = (index: number) =>
    52 + (index / Math.max(1, data.dates.length - 1)) * (width - 72);
  const y = (value: number) => 24 + ((max - value) / (max - min)) * 216;
  const index =
    inspection && inspection.date === data.dates[0]
      ? Math.min(inspection.index, data.dates.length - 1)
      : data.dates.length - 1;
  const date = data.dates[index];
  return (
    <div ref={container} className="price-paths">
      <svg
        viewBox={`0 0 ${width} 278`}
        role="img"
        aria-label={t("Cumulative price change chart", "累计价格涨跌幅图")}
      >
        <title>
          {t(
            "Cumulative price change (%) from the shared first date. Exact values are available below using the date slider.",
            "从统一起始日计算的累计价格涨跌幅（%）。使用下方日期滑块可读取精确数值。",
          )}
        </title>
        {[min, 0, max].map((value) => (
          <g key={value}>
            <line
              x1={52}
              x2={width - 20}
              y1={y(value)}
              y2={y(value)}
              className="chart-grid"
            />
            <text x={44} y={y(value) + 4} textAnchor="end">
              {value.toFixed(1)}%
            </text>
          </g>
        ))}
        <line
          x1={52}
          x2={width - 20}
          y1={y(0)}
          y2={y(0)}
          className="chart-zero"
        />
        {symbols.map((symbol, i) => (
          <path
            key={symbol}
            d={linePath(
              (data.series[symbol] ?? []).map((point) => point.priceChange),
              x,
              y,
            )}
            fill="none"
            stroke={colors[symbol === "SPY" ? 4 : i]}
            strokeWidth={2.3}
            strokeDasharray={dashes[symbol === "SPY" ? 4 : i]}
          />
        ))}
        {date && (
          <line
            x1={x(index)}
            x2={x(index)}
            y1={20}
            y2={244}
            className="chart-cursor"
          />
        )}
        {[0, Math.floor((data.dates.length - 1) / 2), data.dates.length - 1]
          .filter((i, n, all) => i >= 0 && all.indexOf(i) === n)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={266}
              textAnchor={
                i === 0
                  ? "start"
                  : i === data.dates.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {data.dates[i]?.slice(5)}
            </text>
          ))}
      </svg>
      {values.length === 0 && (
        <p className="overview-empty">
          {t(
            "No comparable price paths available yet.",
            "暂无可对比的价格走势。",
          )}
        </p>
      )}
      <label className="chart-date-control">
        <span>
          {t("Inspect date", "查看日期")} <strong>{date ?? "—"}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, data.dates.length - 1)}
          value={Math.max(0, index)}
          disabled={data.dates.length < 2}
          aria-valuetext={date ?? "—"}
          onChange={(event) =>
            setInspection({
              date: data.dates[0],
              index: Number(event.target.value),
            })
          }
        />
      </label>
      <ul
        className="price-path-legend"
        aria-label={t("Price changes on selected date", "所选日期价格涨跌幅")}
      >
        {symbols.map((symbol, i) => (
          <li key={symbol}>
            <svg width="28" height="14" aria-hidden="true">
              <line
                x1="0"
                x2="28"
                y1="7"
                y2="7"
                stroke={colors[symbol === "SPY" ? 4 : i]}
                strokeWidth="3"
                strokeDasharray={dashes[symbol === "SPY" ? 4 : i]}
              />
            </svg>
            <strong>{symbol}</strong>
            <span>{format(data.series[symbol]?.[index]?.priceChange)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
