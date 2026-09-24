import type { Ema200StudyV2 } from "../../../shared/research";
import { useLocale } from "../../shared/locale";

export function EmaOutcomes({ study }: { study: Ema200StudyV2 }) {
  const { t, locale } = useLocale();
  const n = (v: number | null, unit = "%") =>
    v === null
      ? "—"
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v) +
        unit;
  return (
    <div className="ema-outcomes">
      <h6>
        {t("Rebound path · opportunity and risk", "反弹路径 · 机会与风险")}
      </h6>
      <p className="research-meta">
        {t(
          "Each row summarizes fully observed events. Average floating return uses daily closes versus the same entry price. Maximum gain/loss are per-event excursions, then averaged; they are not realized profits or peak-to-trough drawdowns.",
          "每行汇总完整窗口事件。平均浮盈是每日收盘相对同一入场价的收益均值；最大上涨／下跌先按每次事件计算，再取平均，不是实际获利或峰谷回撤。",
        )}
      </p>
      <div className="ema-table-wrap" tabIndex={0}>
        <table>
          <caption>
            {t(
              "Path outcomes · +5% is a preset intraday target; hit time includes hits only",
              "路径表现 · +5% 为预设盘中目标；用时仅统计已命中的事件",
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
                t("Hit +5%", "+5% 发生率"),
                t("Median sessions to hit", "到达用时中位数"),
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
                <td>{h.count}</td>
                <td>{n(h.averageReturn)}</td>
                <td>{n(h.maxGain)}</td>
                <td>{n(h.maxLoss)}</td>
                <td>{n(h.hitRate)}</td>
                <td>{n(h.medianHitDay, t(" sessions", " 交易日"))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h6>
        {t("Wait for confirmation · separate entry", "等待确认 · 独立入场口径")}
      </h6>
      <p className="research-meta">
        {t(
          "First three sessions without a new low, within 20 sessions of the candidate. Enter at the next open after confirmation, not at the earlier low. This cohort can differ from first-touch events and can still include false bottoms.",
          "候选后 20 日内，首次连续三个交易日未创新低视为确认。从确认后次日开盘入场，不倒回最低点。确认样本与首次回踩样本不同，且仍可能出现假底。",
        )}
      </p>
      <div className="ema-table-wrap" tabIndex={0}>
        <table>
          <caption>
            {t(
              "Returns measured from confirmation entry · descriptive only",
              "从确认入场开始计时 · 仅作描述性比较",
            )}
          </caption>
          <thead>
            <tr>
              {[
                t("Horizon", "窗口"),
                t("Confirmed / mature", "已确认／完整窗口"),
                t("Mean endpoint return", "平均终点收益"),
                t("Positive rate", "上涨比例"),
                t("Average floating return", "平均浮盈"),
                t("Mean max loss", "平均最大下跌"),
                t("Hit +5%", "+5% 发生率"),
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {study.confirmed.map((h) => (
              <tr key={h.sessions}>
                <th scope="row">
                  {h.sessions}
                  {t("D", " 日")}
                </th>
                <td>
                  {h.detected} / {h.path.count}
                </td>
                <td>{n(h.meanReturn)}</td>
                <td>{n(h.positiveRate)}</td>
                <td>{n(h.path.averageReturn)}</td>
                <td>{n(h.path.maxLoss)}</td>
                <td>{n(h.path.hitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h6>
        {t(
          "Band sensitivity · keep the primary rule fixed",
          "接触带敏感性 · 主规则保持固定",
        )}
      </h6>
      <p className="research-meta">
        {t(
          "±3% is primary. ±1% / ±5% are descriptive checks, not a search for the best backtest. Wider zones change both event and background samples, not just the number of touches.",
          "±3% 为主模型；±1%／±5% 仅检查敏感性，不用于挑选收益最高的回测。放宽区域会同时改变事件和背景样本，并非只增加触碰次数。",
        )}
      </p>
      <div className="ema-table-wrap" tabIndex={0}>
        <table>
          <caption>
            {t(
              "20-session endpoint and path comparison",
              "20 日终点与路径对比",
            )}
          </caption>
          <thead>
            <tr>
              {[
                t("Band", "接触带"),
                t("Events / background", "事件／背景"),
                t("Mean endpoint", "平均终点收益"),
                t("Advantage", "收益优势"),
                "r",
                t("Average floating return", "平均浮盈"),
                t("Hit +5%", "+5% 发生率"),
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {study.sensitivity.map(({ bandPercent, horizon: h }) => (
              <tr
                key={bandPercent}
                className={bandPercent === 3 ? "ema-primary-band" : undefined}
              >
                <th scope="row">
                  ±{bandPercent}%{" "}
                  {bandPercent === 3 ? t("· primary", "· 主模型") : ""}
                </th>
                <td>
                  {h.events} / {h.controls}
                </td>
                <td>{n(h.meanReturn)}</td>
                <td>{n(h.lift, t(" pp", " 个百分点"))}</td>
                <td>{h.correlation?.toFixed(3) ?? "—"}</td>
                <td>{n(h.averageReturn)}</td>
                <td>{n(h.hitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
