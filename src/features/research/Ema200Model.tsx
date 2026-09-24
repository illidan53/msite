import type { ReactNode } from "react";
import type { Ema200StudyV2 } from "../../../shared/research";
import { ChartInspection } from "../../shared/ChartInspection";
import { useLocale } from "../../shared/locale";
import { EmaOutcomes } from "./EmaOutcomes";
import { ModelConsideration } from "./ModelConsideration";
import { ModelEvidence, useModelFormat } from "./ModelTables";
import { QuantModelCard, type ModelSection } from "./QuantModelCard";
import { ema200Notes } from "./quantModelText";

export function Ema200Model({
  study,
  open,
  onToggle,
  notice,
}: {
  study: Ema200StudyV2 | undefined;
  open: boolean;
  onToggle: () => void;
  notice?: ReactNode;
}) {
  const { t, number, signed, pp } = useModelFormat();
  const outcomeLabel = (value: string) =>
    ({
      pending: t("Window incomplete", "窗口未完成"),
      near: t("Near-line pullback", "附近回踩"),
      reclaimed: t("Undercut & reclaimed", "曾跌破收回"),
      weak: t("Sustained weakness", "持续走弱"),
      mixed: t("Mixed / not reclaimed", "反复／未收回"),
    })[value] ?? "—";
  const main = study?.horizons.find((h) => h.sessions === 20);
  const sections: ModelSection[] = study
    ? [
        {
          key: "evidence",
          title: t("Does the rebound tendency exist?", "是否存在反弹倾向？"),
          content: (
            <>
              <p className="research-meta">
                {t("Observed history", "观测历史")} {study.dataStart} →{" "}
                {study.asOf} ·{" "}
                {t("Split-adjusted daily prices", "拆股调整日线")} ·{" "}
                {study.basis === "reconstructed"
                  ? t(
                      "Reconstructed from current provider history",
                      "按当前数据源历史行情重建",
                    )
                  : t("Same snapshot as this report", "与本报告同一快照")}
              </p>
              <ModelEvidence
                horizons={study.horizons}
                primary={20}
                status={study.status}
                interval={study.confidenceInterval}
                event={["Touch", "触碰"]}
              />
            </>
          ),
        },
        {
          key: "path",
          title: t("Rebound path & robustness", "反弹路径与稳健性"),
          content: <EmaOutcomes study={study} />,
        },
        {
          key: "position",
          title: t("Current position", "当前所处位置"),
          content: (
            <>
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
            </>
          ),
        },
        {
          key: "events",
          title: t("Inspect the events", "核查触碰事件"),
          content: (
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
                          {number(e.confirmation?.paths["20"]?.endReturn, "%")}
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
          ),
        },
      ]
    : [];
  sections.push({
    key: "consideration",
    title: t("Consideration", "模型说明与考量"),
    content: <ModelConsideration notes={ema200Notes} />,
  });
  return (
    <QuantModelCard
      id="ema200"
      index={1}
      eyebrow={t("Model 01 · event study · ±3%", "模型 01 · 事件研究 · ±3%")}
      title={t("EMA200 pullback & rebound", "EMA200 回踩与反弹")}
      status={study?.status}
      summary={
        study &&
        t(
          `20D advantage ${number(main?.lift, " pp")} · ${main?.events ?? 0} mature events · now ${signed(study.distance, "%")} vs EMA200`,
          `20 日优势 ${number(main?.lift, pp)} · ${main?.events ?? 0} 次成熟事件 · 当前距 EMA200 ${signed(study.distance, "%")}`,
        )
      }
      signal={
        study && study.events.at(-1)?.date === study.asOf
          ? t("Touch today", "今日回踩")
          : undefined
      }
      intro={t(
        "When price approaches EMA200 from above, does touching the line precede stronger returns? Historical replay, not a live trade record.",
        "价格从上方回踩 EMA200 后，是否更容易反弹？比较首次触碰与背景样本，检验“支撑有效”这一假设。这里是历史回放，不是实盘交易记录。",
      )}
      notice={notice}
      sections={sections}
      open={open}
      onToggle={onToggle}
    />
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
