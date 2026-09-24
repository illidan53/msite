import { EmaConsideration } from "./EmaConsideration";
import { EmaOutcomes } from "./EmaOutcomes";
import { ChartInspection } from "../../shared/ChartInspection";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, FlaskConical } from "lucide-react";
import type { Ema200StudyV2, ResearchReport } from "../../../shared/research";
import { useLocale } from "../../shared/locale";
// Share an in-flight request across remounts (including React Strict Mode).
const pendingModels = new Map<string, Promise<ResearchReport>>();
function loadModel(id: string) {
  const pending = pendingModels.get(id);
  if (pending) return pending;
  const task = fetch(`/api/research/${id}/models`, { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as ResearchReport;
      if (next.ema200Study?.version !== 2) throw new Error("unavailable");
      return next;
    })
    .finally(() => pendingModels.delete(id));
  pendingModels.set(id, task);
  return task;
}
export function MyQuant({
  report,
  canRun,
  onLoaded,
}: {
  report: ResearchReport;
  canRun: boolean;
  onLoaded: (report: ResearchReport) => void;
}) {
  const { t, locale } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const study =
    report.ema200Study?.version === 2 ? report.ema200Study : undefined;
  const [retry, setRetry] = useState(0);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  }, [onLoaded]);
  const asOf = report.sections.quant.asOf;
  useEffect(() => {
    if (study || !canRun || report.status === "running" || !asOf) {
      setBusy(false);
      return;
    }
    let current = true;
    setBusy(true);
    setError("");
    void loadModel(report.id)
      .then((next) => {
        if (current) loaded.current(next);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : "unknown");
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [report.id, report.status, asOf, study, canRun, retry]);
  const outcomeLabel = (value: string) =>
    ({
      pending: t("Window incomplete", "窗口未完成"),
      near: t("Near-line pullback", "附近回踩"),
      reclaimed: t("Undercut & reclaimed", "曾跌破收回"),
      weak: t("Sustained weakness", "持续走弱"),
      mixed: t("Mixed / not reclaimed", "反复／未收回"),
    })[value] ?? "—";
  const number = (v: number | null | undefined, unit = "") =>
    v === null || v === undefined
      ? "—"
      : new Intl.NumberFormat(locale, {
          maximumFractionDigits: unit === " r" ? 3 : 2,
        }).format(v) + (unit === " r" ? "" : unit);
  const status = study
    ? {
        positive: t("Preliminary positive association", "初步正向关联"),
        negative: t("Underperforms the background sample", "弱于背景样本"),
        inconclusive: t("No clear positive evidence", "未见明确正向证据"),
        insufficient: t("Insufficient evidence", "证据不足"),
      }[study.status]
    : t("Preparing model", "正在准备模型");
  const main = study?.horizons.find((h) => h.sessions === 20);
  return (
    <section
      id="research-my-quant"
      className="research-panel research-my-quant"
      aria-labelledby="my-quant-heading"
    >
      <header className="my-quant-heading">
        <div>
          <p className="eyebrow">
            {t("Your model workspace", "我的模型工作区")}
          </p>
          <h3 id="my-quant-heading">
            <FlaskConical size={23} aria-hidden="true" />
            {t("My Quant", "我的量化")}
          </h3>
          <p>
            {t(
              "Focused hypotheses, explicit rules, and observed historical outcomes.",
              "把关注的交易假设，变成明确规则与可核查的历史效果。",
            )}
          </p>
        </div>
        <span className="my-quant-count">{t("01 model", "01 个模型")}</span>
      </header>
      <article
        id="model-ema200"
        className="quant-model"
        aria-labelledby="ema200-heading"
      >
        <header className="quant-model-heading">
          <div>
            <p className="eyebrow">
              {t("Model 01 · event study · ±3%", "模型 01 · 事件研究 · ±3%")}
            </p>
            <h4 id="ema200-heading">
              {t("EMA200 pullback & rebound", "EMA200 回踩与反弹")}
            </h4>
          </div>
          <span className={`quant-evidence ${study?.status ?? "insufficient"}`}>
            {status}
          </span>
        </header>
        <EmaConsideration />
        <p className="quant-model-intro">
          {t(
            "When price approaches EMA200 from above, does touching the line precede stronger returns? Historical replay, not a live trade record.",
            "价格从上方回踩 EMA200 后，是否更容易反弹？比较首次触碰与背景样本，检验“支撑有效”这一假设。这里是历史回放，不是实盘交易记录。",
          )}
        </p>
        {!study && !error && (
          <p className="quant-model-empty" role="status">
            {busy || (canRun && asOf && report.status !== "running")
              ? t("Preparing model results…", "正在准备模型结果…")
              : !asOf || report.status === "running"
                ? t(
                    "Model results will appear when the quantitative analysis is ready.",
                    "量化分析完成后，模型结果会自动显示。",
                  )
                : t(
                    "Model results are not available yet.",
                    "模型结果暂不可用。",
                  )}
          </p>
        )}
        {error && (
          <p role="alert">
            {error === "403"
              ? t("This IP cannot run the model.", "当前 IP 无权运行模型。")
              : error === "429"
                ? t(
                    "Calculation capacity reached; retry later.",
                    "计算频率已达上限，请稍后重试。",
                  )
                : t(
                    "Model calculation failed. Historical data may be unavailable; please retry.",
                    "模型计算失败，可能缺少历史行情，请重试。",
                  )}
          </p>
        )}
        {error && canRun && (
          <button
            className="quant-model-run"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {t("Retry loading", "重新加载")}
          </button>
        )}
        {study && (
          <>
            <p className="research-meta">
              {t("Observed history", "观测历史")} {study.dataStart} →{" "}
              {study.asOf} · {t("Split-adjusted daily prices", "拆股调整日线")}{" "}
              ·{" "}
              {study.basis === "reconstructed"
                ? t(
                    "Reconstructed from current provider history",
                    "按当前数据源历史行情重建",
                  )
                : t("Same snapshot as this report", "与本报告同一快照")}
            </p>
            <section
              className="quant-model-item"
              aria-labelledby="ema-evidence-heading"
            >
              <h5 id="ema-evidence-heading">
                {t(
                  "01 / Does the rebound tendency exist?",
                  "01 / 是否存在反弹倾向？",
                )}
              </h5>
              <div className="ema-stat-grid">
                <div>
                  <span>
                    {t(
                      "Touch / 20D return correlation r",
                      "触碰 / 20 日收益相关系数 r",
                    )}
                  </span>
                  <strong>{number(main?.correlation, " r")}</strong>
                  <small>
                    {t(
                      "−1 to +1 · association, not probability",
                      "−1 至 +1 · 关联程度，不是概率",
                    )}
                  </small>
                </div>
                <div>
                  <span>
                    {t("20D endpoint return advantage", "20 日终点收益优势")}
                  </span>
                  <strong>{number(main?.lift, t(" pp", " 个百分点"))}</strong>
                  <small>
                    {t("Touch mean − background mean", "触碰均值 − 背景均值")}
                  </small>
                </div>
                <div>
                  <span>
                    {t(
                      "Approx. 95% interval of advantage",
                      "收益优势的近似 95% 区间",
                    )}
                  </span>
                  <strong className="ema-interval">
                    {study.confidenceInterval
                      ? `${number(study.confidenceInterval[0])} ~ ${number(study.confidenceInterval[1])} pp`
                      : "—"}
                  </strong>
                  <small>
                    {t("42-session block bootstrap", "42 个交易日分块重采样")}
                  </small>
                </div>
                <div>
                  <span>
                    {t(
                      "Mature events / background days",
                      "成熟事件 / 背景交易日",
                    )}
                  </span>
                  <strong>
                    {main?.events ?? 0} / {main?.controls ?? 0}
                  </strong>
                  <small>
                    {t(
                      "Primary horizon: 20 sessions",
                      "主检验窗口：20 个交易日",
                    )}
                  </small>
                </div>
              </div>
              <p className="ema-verdict">
                {study.status === "positive"
                  ? t(
                      "The approximate interval is above zero and event mean return is positive: preliminary evidence of stronger rebounds in this historical sample. This is not out-of-sample validation.",
                      "近似置信区间整体高于 0，且事件平均收益为正：此历史样本存在较强反弹的初步证据，尚非样本外验证。",
                    )
                  : study.status === "negative"
                    ? t(
                        "The interval is below zero: touches underperformed comparable background days, even if some individual events rebounded.",
                        "区间整体低于 0：触碰后的表现弱于背景交易日，即使部分事件确实反弹。",
                      )
                    : study.status === "insufficient"
                      ? t(
                          "At least 12 mature touches, 252 background days, nonzero return variation and 950 valid resamples are required. A positive average or correlation alone is not significant evidence.",
                          "至少需要 12 次成熟触碰、252 个背景交易日、非零收益变异及 950 次有效重采样。均值或相关系数为正，本身不足以判定显著。",
                        )
                      : t(
                          "The evidence does not establish a positive rebound tendency. A confidence interval crossing zero does not prove that no relationship exists.",
                          "当前证据不足以确认正向反弹倾向。置信区间跨越 0，也不等于证明完全没有关系。",
                        )}
              </p>
              <div
                className="ema-table-wrap"
                tabIndex={0}
                aria-label={t("Observed model outcomes", "模型历史效果表")}
              >
                <table>
                  <caption>
                    {t(
                      "Fixed-horizon returns · 20D is the only primary test; 5D/10D are descriptive",
                      "固定持有期收益 · 仅 20 日作主检验，5 / 10 日为描述性补充",
                    )}
                  </caption>
                  <thead>
                    <tr>
                      {[
                        t("Horizon", "窗口"),
                        t("Events", "事件数"),
                        t("Mean endpoint", "终点收益均值"),
                        t("Median endpoint", "终点收益中位数"),
                        t("Positive rate", "上涨比例"),
                        t("Background n", "背景数"),
                        t("Background mean", "背景均值"),
                        t("Advantage", "收益优势"),
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {study.horizons.map((h) => (
                      <tr key={h.sessions}>
                        <th scope="row">
                          {h.sessions}
                          {t("D", " 日")}
                        </th>
                        <td>{h.events}</td>
                        <td>{number(h.meanReturn, "%")}</td>
                        <td>{number(h.medianReturn, "%")}</td>
                        <td>{number(h.positiveRate, "%")}</td>
                        <td>{h.controls}</td>
                        <td>{number(h.controlMean, "%")}</td>
                        <td>{number(h.lift, " pp")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <EmaOutcomes study={study} />
            </section>
            <section
              className="quant-model-item"
              aria-labelledby="ema-position-heading"
            >
              <h5 id="ema-position-heading">
                {t("02 / Current position", "02 / 当前所处位置")}
              </h5>
              <div className="ema-position">
                <strong>{number(study.distance, "%")}</strong>
                <span>
                  {study.distance === null
                    ? t(
                        "EMA200 needs 200 completed sessions",
                        "EMA200 需要 200 个完整交易日",
                      )
                    : Math.abs(study.distance) <= 3
                      ? t("Inside the ±3% EMA band", "位于 EMA ±3% 区域")
                      : study.distance > 0
                        ? t("Above EMA200", "位于 EMA200 上方")
                        : t("Below EMA200", "位于 EMA200 下方")}
                </span>
                <p>
                  {t("Close", "收盘价")} {number(study.close, " USD")} · EMA200{" "}
                  {number(study.ema, " USD")} · {study.asOf}
                </p>
              </div>
              <p className="research-meta">
                {t(
                  "Distance = (close / same-day EMA200 − 1) ×100%. Position is shown even when evidence is insufficient; proximity alone is not a buy signal.",
                  "距离 =（收盘价 ÷ 当日 EMA200 − 1）×100%。证据不足时也展示位置，但接近均线本身不构成买入信号。",
                )}
              </p>
              <EmaChart study={study} />
            </section>
            <section
              className="quant-model-item"
              aria-labelledby="ema-events-heading"
            >
              <h5 id="ema-events-heading">
                {t("03 / Inspect the events", "03 / 核查触碰事件")}
              </h5>
              <details>
                <summary>
                  {t(
                    `View ${study.events.length} detected events`,
                    `查看 ${study.events.length} 次识别到的事件`,
                  )}
                </summary>
                <div className="ema-table-wrap" tabIndex={0}>
                  <table>
                    <caption>
                      {t(
                        "Return starts at the next session’s open; — means the window is not yet complete or the entry is unavailable.",
                        "收益从次日开盘计算；— 表示窗口尚未完成或开盘价不可用。",
                      )}
                    </caption>
                    <thead>
                      <tr>
                        {[
                          t("Touch date", "触碰日期"),
                          t("Low / EMA distance", "低点距 EMA"),
                          t("20D outcome · retrospective", "20 日形态 · 事后"),
                          t("Prior EMA", "前日 EMA"),
                          t("Entry date", "入场日期"),
                          t("Entry open", "入场开盘"),
                          t("5D return", "5 日收益"),
                          t("10D return", "10 日收益"),
                          t("20D return", "20 日收益"),
                          t("20D average floating", "20 日平均浮盈"),
                          t("20D max gain / loss", "20 日最大涨／跌"),
                          t("Confirmation date", "确认日期"),
                          t("Confirmed entry date / open", "确认入场日／开盘"),
                          t("Confirmed 20D return", "确认后 20 日收益"),
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...study.events].reverse().map((e) => (
                        <tr key={e.date}>
                          <td>{e.date}</td>
                          <td>{number(e.lowDistance, "%")}</td>
                          <td>{outcomeLabel(e.outcome)}</td>
                          <td>{number(e.referenceEma)}</td>
                          <td>{e.entryDate ?? "—"}</td>
                          <td>{number(e.entryPrice)}</td>
                          {[5, 10, 20].map((h) => (
                            <td key={h}>{number(e.returns[String(h)], "%")}</td>
                          ))}
                          <td>{number(e.paths["20"]?.averageReturn, "%")}</td>
                          <td>
                            {number(e.paths["20"]?.maxGain, "%")} /{" "}
                            {number(e.paths["20"]?.maxLoss, "%")}
                          </td>
                          <td>{e.confirmation?.date ?? "—"}</td>
                          <td>
                            {e.confirmation?.entryDate ?? "—"} /{" "}
                            {number(e.confirmation?.entryPrice)}
                          </td>
                          <td>
                            {number(
                              e.confirmation?.paths["20"]?.endReturn,
                              "%",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!study.events.length && (
                    <p>
                      {t(
                        "No qualifying touches in the available history.",
                        "可用历史内没有符合定义的触碰。",
                      )}
                    </p>
                  )}
                </div>
              </details>
            </section>
          </>
        )}
      </article>
    </section>
  );
}
function EmaChart({ study }: { study: Ema200StudyV2 }) {
  const { t } = useLocale();
  if (study.chart.length < 2 || study.ema === null) return null;
  const all = study.chart.flatMap((p) =>
    p.ema === null ? [p.close] : [p.close, p.ema * 0.97, p.ema * 1.03],
  );
  const lo = Math.min(...all),
    hi = Math.max(...all),
    pad = (hi - lo) * 0.1 || 1;
  const x = (i: number) => 60 + (i / (study.chart.length - 1)) * 650,
    y = (v: number) => 220 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 185;
  const path = (field: "close" | "ema") => {
    let pen = false;
    return study.chart
      .map((p, i) => {
        const value = p[field];
        if (value === null) {
          pen = false;
          return "";
        }
        const d = `${pen ? "L" : "M"}${x(i)},${y(value)}`;
        pen = true;
        return d;
      })
      .join(" ");
  };
  const band = study.chart.flatMap((p, i) =>
    p.ema === null ? [] : [{ i, ema: p.ema }],
  );
  const bandPath = band.length
    ? "M" +
      band.map((p) => `${x(p.i)},${y(p.ema * 1.03)}`).join(" L") +
      " L" +
      [...band]
        .reverse()
        .map((p) => `${x(p.i)},${y(p.ema * 0.97)}`)
        .join(" L") +
      " Z"
    : "";
  return (
    <figure className="ema-chart">
      <figcaption>
        {t(
          "Latest 252 sessions · solid: close · dashed: EMA200 · shaded: ±3% · dots: candidate-day close",
          "最近最多 252 日 · 实线：收盘价 · 虚线：EMA200 · 阴影：±3% · 圆点：候选日收盘",
        )}
      </figcaption>
      <svg
        viewBox="0 0 780 260"
        role="img"
        aria-label={t(
          "Closing price against EMA200 with touch events",
          "收盘价与 EMA200 及触碰事件",
        )}
      >
        {[lo, (hi + lo) / 2, hi].map((v, index) => (
          <g key={index}>
            <line
              x1="60"
              x2="710"
              y1={y(v)}
              y2={y(v)}
              className="history-grid"
            />
            <text x="52" y={y(v) + 4} textAnchor="end">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <path
          d={bandPath}
          fill="var(--accent)"
          opacity="0.09"
          aria-hidden="true"
        />
        <path
          d={path("close")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path("ema")}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
        {study.chart.map(
          (p, i) =>
            p.touch && (
              <circle
                key={p.date}
                cx={x(i)}
                cy={y(p.close)}
                r="4"
                fill="var(--surface)"
                stroke="var(--accent)"
                strokeWidth="2"
              >
                <title>{p.date}</title>
              </circle>
            ),
        )}
        <ChartInspection
          dates={study.chart.map((p) => p.date)}
          x={x}
          top={35}
          bottom={220}
          labelY={250}
          describe={(i) => [
            `${t("Close", "收盘价")}: ${study.chart[i].close.toFixed(2)} USD`,
            `EMA200: ${study.chart[i].ema?.toFixed(2) ?? "—"}`,
            ...(study.chart[i].touch ? [t("Touch event", "触碰事件")] : []),
          ]}
        />
      </svg>
      <details>
        <summary>{t("View chart values", "查看图表数值")}</summary>
        <div className="ema-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Date", "日期")}</th>
                <th>{t("Close", "收盘")}</th>
                <th>EMA200</th>
              </tr>
            </thead>
            <tbody>
              {[...study.chart].reverse().map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{p.close.toFixed(2)}</td>
                  <td>{p.ema?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
