import type { ReactNode } from "react";
import type {
  PullbackModelId,
  PullbackStudy,
  QuantModelSet,
} from "../../../shared/research";
import { ModelChart, type ChartLine } from "./ModelChart";
import { ModelConsideration } from "./ModelConsideration";
import {
  BreakdownNote,
  ModelEvidence,
  PathTable,
  SensitivityTable,
  useBreakdownLabel,
  useModelFormat,
} from "./ModelTables";
import { QuantModelCard, type ModelSection } from "./QuantModelCard";
import { pullbackNotes, type Pair } from "./quantModelText";

export interface ModelConfig {
  index: number;
  eyebrow: Pair;
  title: Pair;
  intro: Pair;
  event: Pair;
  trigger: Pair;
  triggerUnit: string;
  paramHeader: Pair;
  param: (value: number) => string;
  exitLine: Pair;
  legend: Pair;
  lines: Record<string, ChartLine>;
}
export const pullbackConfigs: Record<PullbackModelId, ModelConfig> = {
  sma50: {
    index: 2,
    eyebrow: ["Model 02 · event study · ±2%", "模型 02 · 事件研究 · ±2%"],
    title: ["SMA50 pullback in an uptrend", "上升趋势中的 50 日均线回踩"],
    intro: [
      "While SMA50 is above SMA200, does a pullback into the 50-day line zone precede stronger returns than other uptrend days? Historical replay, not a live trade record.",
      "SMA50 位于 SMA200 上方时，回踩 50 日均线区域后，收益是否强于其他上升趋势交易日？这里是历史回放，不是实盘交易记录。",
    ],
    event: ["Touch", "触碰"],
    trigger: ["Low vs prior SMA50", "低点距前日 SMA50"],
    triggerUnit: "%",
    paramHeader: ["Zone", "区域"],
    param: (v) => `±${v}%`,
    exitLine: ["Pre-touch 20-session high", "触碰前 20 日最高收盘"],
    legend: [
      "Latest 252 sessions · solid: close · dashed: SMA50 · dotted: SMA200 · shaded: ±2% zone · dots: touch-day close · red: breakdown not reclaimed within 20 sessions",
      "最近最多 252 日 · 实线：收盘价 · 虚线：SMA50 · 点线：SMA200 · 阴影：±2% 区域 · 圆点：触碰日收盘 · 红点：破位且 20 日内未收回",
    ],
    lines: {
      sma50: { label: "SMA50", dash: "6 4" },
      sma200: { label: "SMA200", dash: "2 3" },
    },
  },
  rsi2: {
    index: 3,
    eyebrow: [
      "Model 03 · event study · RSI(2) < 10",
      "模型 03 · 事件研究 · RSI(2) < 10",
    ],
    title: ["RSI(2) oversold rebound (Connors)", "RSI(2) 超卖反弹（Connors）"],
    intro: [
      "Above SMA200, does a deeply oversold 2-period RSI precede a short-term bounce that beats other uptrend days? Historical replay, not a live trade record.",
      "价格位于 SMA200 上方时，2 周期 RSI 深度超卖后，短线反弹是否强于其他上升趋势交易日？这里是历史回放，不是实盘交易记录。",
    ],
    event: ["Signal", "信号"],
    trigger: ["RSI(2) at signal", "信号日 RSI(2)"],
    triggerUnit: "",
    paramHeader: ["Threshold", "阈值"],
    param: (v) => `RSI(2) < ${v}`,
    exitLine: ["Close above SMA5", "收盘高于 SMA5"],
    legend: [
      "Latest 252 sessions · solid: close · dotted: SMA200 · lower panel: RSI(2) and the 10 threshold · dots: signal-day close",
      "最近最多 252 日 · 实线：收盘价 · 点线：SMA200 · 下方：RSI(2) 与 10 阈值 · 圆点：信号日收盘",
    ],
    lines: { sma200: { label: "SMA200", dash: "2 3" } },
  },
  bollinger: {
    index: 4,
    eyebrow: [
      "Model 04 · event study · 20, 2σ",
      "模型 04 · 事件研究 · 20 日 2σ",
    ],
    title: ["Bollinger lower-band reversion", "布林下轨回归"],
    intro: [
      "Above SMA200, does a close below the lower Bollinger band precede a reversion toward the middle band and stronger returns? Historical replay, not a live trade record.",
      "价格位于 SMA200 上方时，收盘跌破布林下轨后，是否更容易回归中轨并取得更强收益？这里是历史回放，不是实盘交易记录。",
    ],
    event: ["Signal", "信号"],
    trigger: ["Close vs lower band", "收盘距下轨"],
    triggerUnit: "%",
    paramHeader: ["Band width", "带宽"],
    param: (v) => `${v}σ`,
    exitLine: ["Middle band (SMA20)", "中轨（SMA20）"],
    legend: [
      "Latest 252 sessions · solid: close · dashed: middle band (SMA20) · dotted: SMA200 · shaded: 2σ bands · dots: signal-day close",
      "最近最多 252 日 · 实线：收盘价 · 虚线：中轨（SMA20）· 点线：SMA200 · 阴影：2σ 布林带 · 圆点：信号日收盘",
    ],
    lines: {
      mid: { label: "SMA20", dash: "6 4" },
      sma200: { label: "SMA200", dash: "2 3" },
    },
  },
};

export function PullbackModel({
  id,
  set,
  open,
  onToggle,
  notice,
}: {
  id: PullbackModelId;
  set: QuantModelSet | undefined;
  open: boolean;
  onToggle: () => void;
  notice?: ReactNode;
}) {
  const format = useModelFormat();
  const { t, tr, number, days, pp } = format;
  const config = pullbackConfigs[id];
  const breakdownLabel = useBreakdownLabel();
  // Only the touch model defines a support line that can break.
  const touch = id === "sma50";
  const study = set?.models.find((m) => m.id === id);
  const primary = study?.horizons.find(
    (h) => h.sessions === study.primaryHorizon,
  );
  const readings = study ? currentReadings(id, study, format) : [];
  const sections: ModelSection[] =
    set && study
      ? [
          {
            key: "evidence",
            title: t("Does the rebound tendency exist?", "是否存在反弹倾向？"),
            content: (
              <>
                <p className="research-meta">
                  {t("Observed history", "观测历史")} {set.dataStart} →{" "}
                  {set.asOf} ·{" "}
                  {t("Split-adjusted daily prices", "拆股调整日线")} ·{" "}
                  {set.basis === "reconstructed"
                    ? t(
                        "Reconstructed from current provider history",
                        "按当前数据源历史行情重建",
                      )
                    : t("Same snapshot as this report", "与本报告同一快照")}
                </p>
                <ModelEvidence
                  horizons={study.horizons}
                  primary={study.primaryHorizon}
                  status={study.status}
                  interval={study.confidenceInterval}
                  event={config.event}
                />
                {touch && (
                  <BreakdownNote
                    summary={study.failure}
                    line="SMA50"
                    lowerEdge={t("prior SMA50 × 0.98", "前日 SMA50 × 0.98")}
                  />
                )}
              </>
            ),
          },
          {
            key: "path",
            title: t("Rebound path & rule exit", "反弹路径与规则退出"),
            content: (
              <div className="ema-outcomes">
                <h6>
                  {t(
                    "Rebound path · opportunity and risk",
                    "反弹路径 · 机会与风险",
                  )}
                </h6>
                <p className="research-meta">
                  {t(
                    "Each row summarizes fully observed events from the next open. Maximum gain/loss are per-event excursions, then averaged; they are not realized profits.",
                    "每行汇总从次日开盘起完整观测的事件。最大上涨／下跌先按每次事件计算再取平均，不是实际获利。",
                  )}
                </p>
                <PathTable
                  horizons={study.horizons}
                  target={study.targetPercent}
                />
                <h6>
                  {t(
                    `Rule exit · ${tr(config.exitLine)}`,
                    `规则退出 · ${tr(config.exitLine)}`,
                  )}
                </h6>
                <p className="research-meta">
                  {t(
                    `Buy the next open; sell at the first close that reaches the exit line, otherwise at the close of session 20. Only events with a complete 20-session window count.`,
                    `次日开盘买入；首次收盘达到退出线时卖出，否则在第 20 日收盘退出。只统计 20 日窗口已完整的事件。`,
                  )}
                </p>
                <div className="ema-stat-grid model-exit-grid">
                  {[
                    [
                      t("Reverted within 20 sessions", "20 日内回归"),
                      number(study.exit.revertedRate, "%"),
                      t(
                        `${study.exit.count} mature events`,
                        `${study.exit.count} 次成熟事件`,
                      ),
                    ],
                    [
                      t("Mean rule-exit return", "规则退出平均收益"),
                      number(study.exit.meanReturn, "%"),
                      t("Includes time exits", "含超时退出"),
                    ],
                    [
                      t("Win rate", "盈利比例"),
                      number(study.exit.winRate, "%"),
                      t("Exit return > 0", "退出收益 > 0"),
                    ],
                    [
                      t("Median holding", "持有中位数"),
                      number(study.exit.medianSessions, t(" sessions", " 日")),
                      t("Signal to exit close", "信号至退出收盘"),
                    ],
                    [
                      t("Worst exit", "最差退出"),
                      number(study.exit.worstReturn, "%"),
                      t("Single event", "单次事件"),
                    ],
                  ].map(([label, value, note]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{note}</small>
                    </div>
                  ))}
                </div>
                <h6>
                  {t(
                    "Parameter sensitivity · keep the primary rule fixed",
                    "参数敏感性 · 主规则保持固定",
                  )}
                </h6>
                <p className="research-meta">
                  {t(
                    `${config.param(study.parameter)} is primary. The other rows redefine both event and background samples; they are checks, not a search for the best backtest.`,
                    `${config.param(study.parameter)} 为主模型。其他参数会同时改变事件与背景样本，仅用于检查稳健性，不用于挑选最佳回测。`,
                  )}
                </p>
                <SensitivityTable
                  caption={t(
                    `${study.primaryHorizon}-session endpoint and path comparison`,
                    `${study.primaryHorizon} 日终点与路径对比`,
                  )}
                  header={tr(config.paramHeader)}
                  target={study.targetPercent}
                  rows={study.sensitivity.map(({ parameter, horizon }) => ({
                    label: config.param(parameter),
                    primary: parameter === study.parameter,
                    horizon,
                  }))}
                />
              </div>
            ),
          },
          {
            key: "current",
            title: t("Current state", "当前状态"),
            content: (
              <>
                <div className="ema-stat-grid">
                  {readings.map((r) => (
                    <div key={r.label}>
                      <span>{r.label}</span>
                      <strong>{r.value}</strong>
                      <small>{r.note}</small>
                    </div>
                  ))}
                  <div>
                    <span>{t("Latest signal", "最近一次信号")}</span>
                    <strong className="ema-interval">
                      {study.current.lastEvent ?? "—"}
                    </strong>
                    <small>
                      {study.current.signal
                        ? t("Triggered on the latest session", "最新交易日触发")
                        : study.current.sessionsSince === null
                          ? t(
                              "No signal in the available history",
                              "可用历史内无信号",
                            )
                          : t(
                              `${study.current.sessionsSince} sessions ago`,
                              `${study.current.sessionsSince} 个交易日前`,
                            )}
                    </small>
                  </div>
                </div>
                <p className="research-meta">
                  {t(
                    `As of ${set.asOf}. Readings are shown even when evidence is insufficient; a current signal is a historical-study condition, not a buy recommendation.`,
                    `数据截至 ${set.asOf}。证据不足时也展示读数；当前触发只代表满足历史研究条件，不是买入建议。`,
                  )}
                </p>
                <ModelChart
                  dates={set.chart.dates}
                  close={set.chart.close}
                  chart={study.chart}
                  lines={config.lines}
                  legend={tr(config.legend)}
                  title={tr(config.title)}
                />
              </>
            ),
          },
          {
            key: "events",
            title: t("Inspect the events", "核查信号事件"),
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
                        "Returns start at the next session’s open; — means the window is not complete or the entry is unavailable.",
                        "收益从次日开盘计算；— 表示窗口尚未完成或开盘价不可用。",
                      )}
                    </caption>
                    <thead>
                      <tr>
                        {[
                          t("Signal date", "信号日期"),
                          tr(config.trigger),
                          ...(touch ? [t("Support · 20D", "支撑 · 20 日")] : []),
                          t("Entry date", "入场日期"),
                          t("Entry open", "入场开盘"),
                          t("5D return", "5 日收益"),
                          t("10D return", "10 日收益"),
                          t("20D return", "20 日收益"),
                          t("20D max gain / loss", "20 日最大涨／跌"),
                          t("Rule exit date", "规则退出日"),
                          t("Exit return", "退出收益"),
                          t("Sessions held", "持有交易日"),
                          t("Exit type", "退出方式"),
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...study.events].reverse().map((e) => (
                        <tr key={e.date}>
                          <td>{e.date}</td>
                          <td>{number(e.trigger, config.triggerUnit)}</td>
                          {touch && <td>{breakdownLabel(e)}</td>}
                          <td>{e.entryDate ?? "—"}</td>
                          <td>{number(e.entryPrice)}</td>
                          {[5, 10, 20].map((h) => (
                            <td key={h}>{number(e.returns[String(h)], "%")}</td>
                          ))}
                          <td>
                            {number(e.paths["20"]?.maxGain, "%")} /{" "}
                            {number(e.paths["20"]?.maxLoss, "%")}
                          </td>
                          <td>{e.exit?.date ?? "—"}</td>
                          <td>{number(e.exit?.return, "%")}</td>
                          <td>{e.exit?.sessions ?? "—"}</td>
                          <td>
                            {e.exit === null
                              ? t("Window incomplete", "窗口未完成")
                              : e.exit.reason === "reverted"
                                ? t("Reverted", "已回归")
                                : t("Time exit", "超时退出")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!study.events.length && (
                    <p>
                      {t(
                        "No qualifying signals in the available history.",
                        "可用历史内没有符合定义的信号。",
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
    content: <ModelConsideration notes={pullbackNotes[id]} />,
  });
  const r = study?.current.readings ?? {};
  const nowText =
    id === "sma50"
      ? t(
          `now ${format.signed(r.distance, "%")} vs SMA50`,
          `当前距 SMA50 ${format.signed(r.distance, "%")}`,
        )
      : id === "rsi2"
        ? t(
            `now RSI(2) ${number(r.rsi2, "", 1)}`,
            `当前 RSI(2) ${number(r.rsi2, "", 1)}`,
          )
        : t(`now %B ${number(r.percentB)}`, `当前 %B ${number(r.percentB)}`);
  return (
    <QuantModelCard
      id={id}
      index={config.index}
      eyebrow={tr(config.eyebrow)}
      title={tr(config.title)}
      status={study?.status}
      summary={
        study &&
        [
          t(
            `${days(study.primaryHorizon)} advantage ${number(primary?.lift, " pp")}`,
            `${days(study.primaryHorizon)}优势 ${number(primary?.lift, pp)}`,
          ),
          t(
            `${primary?.events ?? 0} mature events`,
            `${primary?.events ?? 0} 次成熟事件`,
          ),
          nowText,
          ...(study.current.regime === false
            ? [t("trend filter off", "趋势过滤未满足")]
            : []),
        ].join(" · ")
      }
      signal={study?.current.signal ? t("Signal today", "今日触发") : undefined}
      intro={tr(config.intro)}
      notice={notice}
      sections={sections}
      open={open}
      onToggle={onToggle}
    />
  );
}

/** Labels are resolved once so the collapsed summary and the grid stay identical. */
function currentReadings(
  id: PullbackModelId,
  study: PullbackStudy,
  { t, number, signed }: ReturnType<typeof useModelFormat>,
) {
  const r = study.current.readings;
  const filter = (on: string, off: string) =>
    study.current.regime === null
      ? t("Needs 200 sessions of history", "需要 200 个交易日历史")
      : study.current.regime
        ? on
        : off;
  if (id === "sma50")
    return [
      {
        label: t("Close vs SMA50", "收盘距 SMA50"),
        value: signed(r.distance, "%"),
        note:
          r.distance === null
            ? "—"
            : Math.abs(r.distance) <= study.parameter
              ? t("Inside the ±2% zone", "位于 ±2% 区域内")
              : r.distance > 0
                ? t("Above the zone", "位于区域上方")
                : t("Below the zone", "位于区域下方"),
      },
      {
        label: "SMA50 / SMA200",
        value: `${number(r.sma50, "", 1)} / ${number(r.sma200, "", 1)}`,
        note: filter(
          t(
            "Trend filter on · SMA50 above SMA200",
            "趋势过滤满足 · SMA50 高于 SMA200",
          ),
          t(
            "Trend filter off · SMA50 below SMA200",
            "趋势过滤未满足 · SMA50 低于 SMA200",
          ),
        ),
      },
      {
        label: t("SMA50 vs SMA200", "SMA50 距 SMA200"),
        value: signed(r.trendGap, "%"),
        note: t("Trend strength", "趋势强度"),
      },
    ];
  if (id === "rsi2")
    return [
      {
        label: "RSI(2)",
        value: number(r.rsi2, "", 1),
        note:
          r.rsi2 !== null && r.rsi2 < study.parameter
            ? t("Oversold zone (< 10)", "处于超卖区（< 10）")
            : t("Signal needs < 10", "信号需 < 10"),
      },
      {
        label: t("Close vs SMA200", "收盘距 SMA200"),
        value: signed(r.distance200, "%"),
        note: filter(
          t("Trend filter on", "趋势过滤满足"),
          t("Trend filter off · below SMA200", "趋势过滤未满足 · 低于 SMA200"),
        ),
      },
      {
        label: t("SMA5 · exit line", "SMA5 · 退出线"),
        value: number(r.sma5, " USD"),
        note: t("Connors exit: close above", "Connors 退出：收盘站上"),
      },
    ];
  return [
    {
      label: "%B",
      value: number(r.percentB, "", 2),
      note: t("0 = lower band · 1 = upper band", "0 = 下轨 · 1 = 上轨"),
    },
    {
      label: t("Lower / middle band", "下轨 / 中轨"),
      value: `${number(r.lower, "", 1)} / ${number(r.mid, "", 1)}`,
      note: t("Middle band is the exit line", "中轨为退出线"),
    },
    {
      label: "SMA200",
      value: number(r.sma200, " USD"),
      note: filter(
        t("Trend filter on · close above", "趋势过滤满足 · 收盘在其上方"),
        t("Trend filter off · close below", "趋势过滤未满足 · 收盘在其下方"),
      ),
    },
  ];
}
