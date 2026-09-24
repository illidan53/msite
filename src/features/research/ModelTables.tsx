import type { Ema200HorizonV2, PullbackStudy } from "../../../shared/research";
import { useLocale } from "../../shared/locale";
import type { Pair } from "./quantModelText";

export type EvidenceStatus = PullbackStudy["status"];
export function useModelFormat() {
  const { t, locale } = useLocale();
  const number = (v: number | null | undefined, unit = "", digits = 2) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? "—"
      : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
          v,
        ) + unit;
  /** Distances read better with an explicit direction. */
  const signed = (v: number | null | undefined, unit = "") =>
    (v !== null && v !== undefined && v > 0 ? "+" : "") + number(v, unit);
  const tr = (pair: Pair) => t(pair[0], pair[1]);
  const days = (n: number) => `${n}${t("D", " 日")}`;
  const pp = t(" pp", " 个百分点");
  return { t, tr, locale, number, signed, days, pp };
}
export function useStatusLabel() {
  const { t } = useLocale();
  return (status: EvidenceStatus | undefined) =>
    status
      ? {
          positive: t("Preliminary positive association", "初步正向关联"),
          negative: t("Underperforms the background sample", "弱于背景样本"),
          inconclusive: t("No clear positive evidence", "未见明确正向证据"),
          insufficient: t("Insufficient evidence", "证据不足"),
        }[status]
      : t("Preparing model", "正在准备模型");
}

/** Primary test summary: stat grid, verdict and fixed-horizon table. */
export function ModelEvidence({
  horizons,
  primary,
  status,
  interval,
  event,
}: {
  horizons: Ema200HorizonV2[];
  primary: number;
  status: EvidenceStatus;
  interval: [number, number] | null;
  event: Pair;
}) {
  const { t, number, days, pp } = useModelFormat();
  const main = horizons.find((h) => h.sessions === primary);
  return (
    <>
      <div className="ema-stat-grid">
        <div>
          <span>
            {t(
              `${event[0]} / ${primary}D return correlation r`,
              `${event[1]} / ${primary} 日收益相关系数 r`,
            )}
          </span>
          <strong>{number(main?.correlation, "", 3)}</strong>
          <small>
            {t(
              "−1 to +1 · association, not probability",
              "−1 至 +1 · 关联程度，不是概率",
            )}
          </small>
        </div>
        <div>
          <span>
            {t(
              `${primary}D endpoint return advantage`,
              `${primary} 日终点收益优势`,
            )}
          </span>
          <strong>{number(main?.lift, pp)}</strong>
          <small>
            {t(
              `${event[0]} mean − background mean`,
              `${event[1]}均值 − 背景均值`,
            )}
          </small>
        </div>
        <div>
          <span>
            {t("Approx. 95% interval of advantage", "收益优势的近似 95% 区间")}
          </span>
          <strong className="ema-interval">
            {interval
              ? `${number(interval[0])} ~ ${number(interval[1])} pp`
              : "—"}
          </strong>
          <small>
            {t("42-session block bootstrap", "42 个交易日分块重采样")}
          </small>
        </div>
        <div>
          <span>
            {t("Mature events / background days", "成熟事件 / 背景交易日")}
          </span>
          <strong>
            {main?.events ?? 0} / {main?.controls ?? 0}
          </strong>
          <small>
            {t(
              `Primary horizon: ${primary} sessions`,
              `主检验窗口：${primary} 个交易日`,
            )}
          </small>
        </div>
      </div>
      <p className="ema-verdict">
        {status === "positive"
          ? t(
              "The approximate interval is above zero and event mean return is positive: preliminary evidence of stronger rebounds in this historical sample. This is not out-of-sample validation.",
              "近似置信区间整体高于 0，且事件平均收益为正：此历史样本存在较强反弹的初步证据，尚非样本外验证。",
            )
          : status === "negative"
            ? t(
                `The interval is below zero: ${event[0].toLowerCase()} events underperformed comparable background days, even if some individual events rebounded.`,
                `区间整体低于 0：${event[1]}后的表现弱于背景交易日，即使部分事件确实反弹。`,
              )
            : status === "insufficient"
              ? t(
                  "At least 12 mature events, 252 background days, nonzero return variation and 950 valid resamples are required. A positive average or correlation alone is not significant evidence.",
                  "至少需要 12 次成熟事件、252 个背景交易日、非零收益变异及 950 次有效重采样。均值或相关系数为正，本身不足以判定显著。",
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
              `Fixed-horizon returns · ${primary}D is the only primary test; other horizons are descriptive`,
              `固定持有期收益 · 仅 ${primary} 日作主检验，其余窗口为描述性补充`,
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
            {horizons.map((h) => (
              <tr
                key={h.sessions}
                className={
                  h.sessions === primary ? "quant-primary-row" : undefined
                }
              >
                <th scope="row">
                  {days(h.sessions)}
                  {h.sessions === primary ? t(" · primary", " · 主检验") : ""}
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
    </>
  );
}

export function PathTable({
  horizons,
  target,
}: {
  horizons: Ema200HorizonV2[];
  target: number;
}) {
  const { t, number, days } = useModelFormat();
  return (
    <div className="ema-table-wrap" tabIndex={0}>
      <table>
        <caption>
          {t(
            `Path outcomes · +${target}% is a preset intraday target; hit time includes hits only`,
            `路径表现 · +${target}% 为预设盘中目标；用时仅统计已命中的事件`,
          )}
        </caption>
        <thead>
          <tr>
            {[
              t("Horizon", "窗口"),
              t("Events", "事件数"),
              t("Average floating return", "平均浮盈"),
              t("Mean max gain", "平均最大上涨"),
              t("Mean max loss", "平均最大下跌"),
              t(`Hit +${target}%`, `+${target}% 发生率`),
              t("Median sessions to hit", "到达用时中位数"),
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {horizons.map((h) => (
            <tr key={h.sessions}>
              <th scope="row">{days(h.sessions)}</th>
              <td>{h.count}</td>
              <td>{number(h.averageReturn, "%")}</td>
              <td>{number(h.maxGain, "%")}</td>
              <td>{number(h.maxLoss, "%")}</td>
              <td>{number(h.hitRate, "%")}</td>
              <td>{number(h.medianHitDay, t(" sessions", " 交易日"))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SensitivityTable({
  rows,
  caption,
  header,
  target,
}: {
  rows: { label: string; primary: boolean; horizon: Ema200HorizonV2 }[];
  caption: string;
  header: string;
  target: number;
}) {
  const { t, number, pp } = useModelFormat();
  return (
    <div className="ema-table-wrap" tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {[
              header,
              t("Events / background", "事件／背景"),
              t("Mean endpoint", "平均终点收益"),
              t("Advantage", "收益优势"),
              "r",
              t("Average floating return", "平均浮盈"),
              t(`Hit +${target}%`, `+${target}% 发生率`),
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, primary, horizon: h }) => (
            <tr
              key={label}
              className={primary ? "quant-primary-row" : undefined}
            >
              <th scope="row">
                {label} {primary ? t("· primary", "· 主模型") : ""}
              </th>
              <td>
                {h.events} / {h.controls}
              </td>
              <td>{number(h.meanReturn, "%")}</td>
              <td>{number(h.lift, pp)}</td>
              <td>{h.correlation?.toFixed(3) ?? "—"}</td>
              <td>{number(h.averageReturn, "%")}</td>
              <td>{number(h.hitRate, "%")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
