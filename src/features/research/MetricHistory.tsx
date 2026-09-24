import { ChartInspection } from "../../shared/ChartInspection";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type {
  ResearchMetric,
  ResearchReport,
  ResearchMetricHistory,
} from "../../../shared/research";
import { useLocale } from "../../shared/locale";
import { metricAssessment, researchMetricGuide } from "./metricGuides";

export function MetricHistory({
  metric,
  report,
  canRun,
  onLoaded,
  onClose,
}: {
  metric: ResearchMetric;
  report: ResearchReport;
  canRun: boolean;
  onLoaded: (report: ResearchReport) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const loadedCallback = useRef(onLoaded);
  loadedCallback.current = onLoaded;
  const [history, setHistory] = useState(report.metricHistory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState(252);
  const fundamental = metric.group === "fundamentals";
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => trigger?.focus();
  }, []);
  useEffect(() => {
    if (
      fundamental ||
      history ||
      !canRun ||
      report.status === "running" ||
      !report.sections.quant.asOf
    )
      return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/research/${report.id}/history`, {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as ResearchReport;
      })
      .then((next) => {
        if (!next.metricHistory) throw new Error("422");
        setLoading(false);
        setHistory(next.metricHistory);
        loadedCallback.current(next);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "unknown");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The dialog is keyed by report/metric. Retries are explicit; successful
    // data is returned to its parent so other cards use the same snapshot.
  }, [
    attempt,
    canRun,
    fundamental,
    history,
    report.id,
    report.sections.quant.asOf,
    report.status,
  ]);
  const guide = researchMetricGuide(metric, locale);
  return createPortal(
    <dialog
      ref={dialog}
      className="metric-help-dialog research-history-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const b = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < b.left ||
          event.clientX > b.right ||
          event.clientY < b.top ||
          event.clientY > b.bottom
        )
          dialog.current?.close();
      }}
    >
      <header className="metric-help-heading">
        <div>
          <p className="eyebrow">
            {report.symbol} / {report.benchmark} ·{" "}
            {t("Metric history", "指标历史")}
          </p>
          <h2 id={`${id}-title`}>{metric[locale]}</h2>
        </div>
        <button
          type="button"
          className="metric-info-button"
          aria-label={t("Close metric history", "关闭指标历史")}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <p className="research-history-intro">{guide.meaning}</p>
      {fundamental ? (
        <div className="research-history-notice">
          <strong>
            {t("Historical series not available", "尚无可靠历史序列")}
          </strong>
          <p>
            {t(
              "This report contains a fundamentals snapshot, not a dated history. Historical valuation requires prices, shares and financials known on each date; filings must enter only after publication. Current figures cannot be backfilled into past dates. ETF NAV and holdings also require dated feeds.",
              "这份报告保存的是基本面快照，不是历史序列。历史估值需要当时的股价、股数及当时已公开的财务数据；财报只能从披露后生效，不能把今天的数字倒填到过去。ETF 净值与持仓同样需要带日期的数据源。",
            )}
          </p>
          <p>
            {t("Snapshot period", "快照期间")}：
            {report.financialPeriod ??
              report.sections.fundamentals.asOf ??
              t("Not supplied", "未提供")}{" "}
            · {t("Filing date", "申报日期")}：
            {report.filingDate ?? t("Not supplied", "未提供")}
          </p>
        </div>
      ) : loading ? (
        <p role="status">
          {t(
            "Reconstructing daily history up to this report’s cutoff… No AI call is made.",
            "正在重建截至报告日期的每日指标……此操作不调用 AI。",
          )}
        </p>
      ) : error ? (
        <div role="alert">
          <p>
            {error === "403"
              ? t(
                  "Only an allowed IP can generate missing history.",
                  "仅白名单 IP 可以生成缺失历史。",
                )
              : error === "429"
                ? t(
                    "History capacity reached. Please retry later.",
                    "历史生成次数或并发已达上限，请稍后重试。",
                  )
                : t(
                    "Historical data could not be loaded. Coverage may not include this report’s date.",
                    "历史数据暂时无法加载，数据覆盖可能不包含这份报告的日期。",
                  )}
          </p>
          <button
            className="metric-help-done"
            type="button"
            onClick={() => setAttempt((v) => v + 1)}
          >
            {t("Retry", "重试")}
          </button>
        </div>
      ) : history ? (
        <>
          <div
            className="research-history-ranges"
            role="group"
            aria-label={t("Chart range", "图表范围")}
          >
            {[
              [21, "1M", "1 月"],
              [63, "3M", "3 月"],
              [126, "6M", "6 月"],
              [252, "1Y", "1 年"],
            ].map(([n, en, zh]) => (
              <button
                key={n}
                type="button"
                aria-pressed={range === n}
                onClick={() => setRange(Number(n))}
              >
                {t(String(en), String(zh))}
              </button>
            ))}
          </div>
          <HistoryChart
            key={`${metric.id}-${range}`}
            metric={metric}
            history={history}
            range={range}
          />
          <p className="research-history-method">
            {t(
              `Each date uses only prices through that date. Warm-up starts ${history.dataStart}; display range does not reset calculations. Benchmark: ${report.benchmark}.`,
              `每个日期只使用截至当天的价格。计算历史从 ${history.dataStart} 开始；切换显示范围不会重置计算。对比基准：${report.benchmark}。`,
            )}
          </p>
          <p className="research-history-method">
            {t(
              "Trailing windows move with each date; drawdowns, longest recovery and CAGR expand from the available-history start. Zero risk-free/target rate is retained for the risk ratios.",
              "滚动窗口随日期向前移动；回撤、最长回撤持续时间和年化收益从可用历史起点累计。风险比率继续采用无风险/目标收益为 0 的口径。",
            )}
          </p>
          <p className="research-history-method">
            {history.basis === "reconstructed"
              ? t(
                  "Reconstructed from currently available adjusted prices, capped at the report date. Data revisions or changed coverage can differ from the original card. This is not an archived point-in-time market feed.",
                  "使用当前可获取的复权行情重建，并截断到报告日期。行情修订或覆盖范围变化可能导致结果与原卡片不同；这不是当时行情版本的存档。",
                )
              : t(
                  "Uses the same adjusted-price snapshot as this report. Provider revisions and corporate-action adjustments can change later snapshots.",
                  "使用与本报告相同的复权行情快照。数据源修订和公司行动调整可能改变之后生成的报告。",
                )}
          </p>
        </>
      ) : (
        <p className="research-history-notice">
          {t(
            "This saved report has no metric history yet. An allowed IP can generate it when a completed quantitative snapshot is available.",
            "这份报告尚未保存指标历史。有完整量化快照时，白名单 IP 可生成历史曲线。",
          )}
        </p>
      )}
      <details className="research-history-formula">
        <summary>
          {t("Calculation and interpretation", "计算与解读口径")}
        </summary>
        <p>{guide.formula}</p>
        <p>{guide.caveat}</p>
      </details>
      <button
        type="button"
        className="metric-help-done"
        onClick={() => dialog.current?.close()}
      >
        {t("Done", "完成")}
      </button>
    </dialog>,
    document.body,
  );
}

function HistoryChart({
  metric,
  history,
  range,
}: {
  metric: ResearchMetric;
  history: ResearchMetricHistory;
  range: number;
}) {
  const { locale, t } = useLocale();
  const points = history.dates
    .map((date, i) => ({ date, value: history.values[metric.id]?.[i] ?? null }))
    .slice(-range);
  const [selected, setSelected] = useState(points.length - 1);
  const valid = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const format = (value: number | null) =>
    value === null
      ? t("Unavailable", "暂无数据")
      : new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
          maximumFractionDigits: 2,
          notation: Math.abs(value) >= 1e6 ? "compact" : "standard",
        }).format(value) +
        (metric.id === "excess"
          ? t(" pp", " 个百分点")
          : metric.unit === "percent"
            ? "%"
            : metric.unit === "usd"
              ? " USD"
              : metric.unit === "days"
                ? t(" sessions", " 交易日")
                : "");
  if (!valid.length)
    return (
      <p className="research-history-notice">
        {t(
          "No valid observations in this range. The lookback window, benchmark data or denominator is insufficient; missing observations are not zeros.",
          "此范围内没有有效读数：可能是计算窗口、基准数据或分母不足。缺失值不会当作零值。",
        )}
      </p>
    );
  const refs =
    metric.id === "rsi"
      ? [30, 70]
      : ["drawdown", "maxDrawdown", "highDistance"].includes(metric.id)
        ? [0, -10, -20]
        : [];
  const minimum = Math.min(...valid, ...refs),
    maximum = Math.max(...valid, ...refs);
  const padding =
    (maximum - minimum) * 0.1 || Math.max(Math.abs(maximum) * 0.05, 1);
  const low = metric.id === "rsi" ? 0 : minimum - padding,
    high = metric.id === "rsi" ? 100 : maximum + padding;
  const x = (i: number) => 85 + (i / Math.max(1, points.length - 1)) * 640;
  const y = (v: number) => 230 - ((v - low) / (high - low)) * 205;
  let pen = false;
  const path = points
    .map((p, i) => {
      if (p.value === null) {
        pen = false;
        return "";
      }
      const command = `${pen ? "L" : "M"}${x(i)},${y(p.value)}`;
      pen = true;
      return command;
    })
    .join(" ");
  const current = points[selected];
  const assessment = metricAssessment({ id: metric.id, value: current.value });
  return (
    <div className="research-history-chart">
      <div
        className={`research-history-value research-tone-${assessment.tone}`}
        aria-live="polite"
      >
        <time>{current.date}</time>
        <strong>{format(current.value)}</strong>
        <span>{assessment.label[locale === "zh" ? 1 : 0]}</span>
      </div>
      <svg
        viewBox="0 0 800 270"
        role="img"
        aria-label={t(`${metric.en} historical chart`, `${metric.zh}历史曲线`)}
      >
        <title>
          {metric[locale]} · {points[0].date} — {points.at(-1)!.date}
        </title>
        {[low, (low + high) / 2, high].map((v) => (
          <g key={v}>
            <line
              x1="85"
              x2="725"
              y1={y(v)}
              y2={y(v)}
              className="history-grid"
            />
            <text x="78" y={y(v) + 4} textAnchor="end">
              {new Intl.NumberFormat(locale, {
                maximumFractionDigits: 1,
                notation: "compact",
              }).format(v)}
            </text>
          </g>
        ))}
        {refs.map((v) => (
          <g key={v}>
            <line
              x1="85"
              x2="725"
              y1={y(v)}
              y2={y(v)}
              className="history-reference"
            />
            <text x="732" y={y(v) + 4}>
              {v}
            </text>
          </g>
        ))}
        {low < 0 && high > 0 && !refs.includes(0) && (
          <line
            x1="85"
            x2="725"
            y1={y(0)}
            y2={y(0)}
            className="history-reference"
          />
        )}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1="25"
          y2="230"
          className="history-reference"
        />
        {points.map((p, i) =>
          p.value !== null &&
          (i === 0 || points[i - 1].value === null) &&
          (i === points.length - 1 || points[i + 1].value === null) ? (
            <circle
              key={p.date}
              cx={x(i)}
              cy={y(p.value)}
              r="3"
              fill="var(--accent)"
            />
          ) : null,
        )}
        {current.value !== null && (
          <circle
            cx={x(selected)}
            cy={y(current.value)}
            r="4"
            fill="var(--accent)"
          />
        )}
        <ChartInspection
          dates={points.map((p) => p.date)}
          x={x}
          top={25}
          bottom={230}
          labelY={258}
          onSelect={setSelected}
          describe={(i) => [format(points[i].value)]}
        />
      </svg>
      <label className="research-history-slider">
        {t("Choose date · arrow keys supported", "选择日期 · 支持方向键")}
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          aria-valuetext={`${current.date}: ${format(current.value)}`}
        />
      </label>
      <p className="research-history-method">
        {t(
          "Daily completed-session observations. Gaps mean missing data, not zero. Dashed horizontal lines are reference levels, not buy/sell signals.",
          "按完整交易日观察。断线表示缺失，不是零；横向虚线为参考线，不是买卖信号。",
        )}
      </p>
      <details className="research-history-table">
        <summary>{t("View dated values", "查看每日数值")}</summary>
        <div>
          <table>
            <thead>
              <tr>
                <th>{t("Date", "日期")}</th>
                <th>{metric[locale]}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
