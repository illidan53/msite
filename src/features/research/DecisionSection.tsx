import type { ResearchReport } from "../../../shared/research";
import { useLocale } from "../../shared/locale";
import { scoreDecision } from "./decision";

export function DecisionSection({ report }: { report: ResearchReport }) {
  const { t, locale } = useLocale(),
    i = locale === "zh" ? 1 : 0;
  const d = scoreDecision(report);
  const number = (v: number | null, unit = "") =>
    v === null
      ? "—"
      : new Intl.NumberFormat(locale, {
          maximumFractionDigits: 2,
          notation: Math.abs(v) >= 1e6 ? "compact" : "standard",
        }).format(v) +
        (unit === "pp"
          ? t(" pp", " 个百分点")
          : unit === "USD"
            ? " USD"
            : unit);
  const strength = (grade: number) =>
    [t("None", "无"), t("Weak", "弱"), t("Moderate", "中"), t("Strong", "强")][
      grade
    ];
  const title =
    d.side === "unavailable"
      ? t("No final grade", "暂不评级")
      : d.side === "conflict"
        ? t("Conflicting signals · wait", "信号冲突 · 观望")
        : d.side === "wait"
          ? t("Wait", "观望")
          : d.side === "buy"
            ? t("Buy support", "买入支持")
            : t("Sell / reduce support", "卖出 / 减仓支持");
  return (
    <section
      id="research-decision"
      className="research-panel research-decision"
      aria-labelledby="decision-title"
    >
      <header>
        <div>
          <p className="eyebrow">
            {t(
              "Rule model v1 · long-only · 1–3 months",
              "规则模型 v1 · 只做多 · 1–3 个月",
            )}
          </p>
          <h3 id="decision-title">
            {t("Buy / sell decision reference", "买卖决策参考")}
          </h3>
        </div>
        <span className="research-meta">
          {t("As of", "截至")} {report.sections.quant.asOf ?? "—"} ·{" "}
          {report.symbol} / {report.benchmark}
        </span>
      </header>
      <p className="research-meta">
        {t(
          "An unbacktested technical rule model, not a probability of profit or a personalized trade instruction. Sell means reviewing an existing position, not opening a short. News, valuation, taxes, costs and your holdings are not scored.",
          "这是尚未回测的技术规则模型，分数不是获利概率，也不是个性化交易指令。卖出表示审视已有持仓，不代表做空；新闻、估值、税费、交易成本与个人仓位未纳入。",
        )}
      </p>
      <div className={`decision-verdict decision-${d.side}`} role="status">
        <strong>
          {title}
          {d.grade > 0 ? ` · ${strength(d.grade)} (${d.grade}/3)` : ""}
        </strong>
        <span>
          {t("Directional data coverage", "方向数据覆盖")} {d.coverage}%
        </span>
      </div>
      {!d.ready && (
        <p className="decision-notice">
          {d.stale
            ? t(
                "The price cutoff is missing, in the future, or over 7 calendar days old. Generate a current quantitative report.",
                "行情日期缺失、异常或已超过 7 个自然日，请生成最新量化报告。",
              )
            : d.missing
              ? t(
                  "Requires at least 80% directional weight coverage, both moving-average distances, and all four risk filters. Missing data is not a neutral signal.",
                  "至少需要 80% 方向权重覆盖、两条均线距离和四项风险过滤数据。缺失数据不等于中性信号。",
                )
              : t(
                  "The quantitative module is not complete.",
                  "量化模块尚未完整完成。",
                )}
        </p>
      )}
      {d.conflict && (
        <p className="decision-notice">
          {t(
            "Both raw buy and sell support reach 20 points: conflicting evidence overrides the net score, so wait.",
            "原始买入和卖出支持均达到 20 分，证据冲突优先于净分，因此归为观望。",
          )}
        </p>
      )}
      <div
        className="decision-table-wrap"
        tabIndex={0}
        aria-label={t(
          "Decision scoring table; scroll horizontally on small screens",
          "决策评分表；小屏可横向滚动",
        )}
      >
        <table className="decision-table">
          <caption>
            {t(
              "Direction: −2 strong sell support, −1 weak sell, 0 neutral, +1 weak buy, +2 strong buy. These are site-designed thresholds, not validated trading cutoffs.",
              "方向分级：−2 强卖出支持，−1 弱卖出，0 中性，+1 弱买入，+2 强买入。以下为本站设计的阈值，并非已验证的交易界线。",
            )}
          </caption>
          <thead>
            <tr>
              {[
                t("Indicator / group", "指标 / 类别"),
                t("Current value", "当前值"),
                t("Threshold → grade", "阈值 → 分级"),
                t("Weight", "权重"),
                t("Current grade", "当前分级"),
                t("Buy points", "买入贡献"),
                t("Sell points", "卖出贡献"),
              ].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  {r.name[i]}
                  <small>{r.group[i]}</small>
                </th>
                <td>{number(r.value, r.unit)}</td>
                <td className="decision-threshold">{r.thresholds[i]}</td>
                <td>{r.weight}%</td>
                <td
                  className={
                    r.score && r.score > 0
                      ? "decision-positive"
                      : r.score && r.score < 0
                        ? "decision-negative"
                        : ""
                  }
                >
                  {r.score === null
                    ? t("Missing", "缺失")
                    : r.score === 0
                      ? t("Neutral · 0", "中性 · 0")
                      : `${r.score > 0 ? "+" : ""}${r.score} · ${Math.abs(r.score) === 2 ? t("Strong", "强") : t("Weak", "弱")}`}
                </td>
                <td>{r.score === null ? "—" : `+${number(r.buy)}`}</td>
                <td>{r.score === null ? "—" : `+${number(r.sell)}`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>
                {t(
                  "Raw directional support · fixed 100-point budget",
                  "原始方向支持 · 固定 100 分预算",
                )}
              </th>
              <td>{number(d.rawBuy)} / 100</td>
              <td>{number(d.sell)} / 100</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div
        className="decision-table-wrap"
        tabIndex={0}
        aria-label={t("Risk filters table", "风险过滤表")}
      >
        <table className="decision-table">
          <caption>
            {t(
              "Risk filters reduce buy support only; they do not create sell points. Use the lowest multiplier once, without stacking correlated risk penalties.",
              "风险过滤只削弱买入支持，不产生卖出分数。取最低乘数一次，避免相关风险重复扣分。",
            )}
          </caption>
          <thead>
            <tr>
              <th>{t("Risk indicator", "风险指标")}</th>
              <th>{t("Current value", "当前值")}</th>
              <th>{t("Threshold → multiplier", "阈值 → 乘数")}</th>
              <th>{t("Buy multiplier", "买入乘数")}</th>
              <th>{t("Sell contribution", "卖出贡献")}</th>
            </tr>
          </thead>
          <tbody>
            {d.risks.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name[i]}</th>
                <td>{number(r.value, r.unit)}</td>
                <td>{r.thresholds[i]}</td>
                <td>
                  {r.factor === null ? t("Missing", "缺失") : `×${r.factor}`}
                </td>
                <td>0</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="decision-table-wrap"
        tabIndex={0}
        aria-label={t("Final decision table", "最终决策表")}
      >
        <table className="decision-table">
          <caption>
            {t("Final quantitative decision reference", "最终量化决策参考")}
          </caption>
          <thead>
            <tr>
              <th>{t("Adjusted buy support", "调整后买入支持")}</th>
              <th>{t("Sell support", "卖出支持")}</th>
              <th>{t("Net score", "净分")}</th>
              <th>{t("Final grade", "最终分级")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {d.ready
                  ? `${number(d.rawBuy)} × ${d.factor} = ${number(d.buy)} / 100`
                  : "—"}
              </td>
              <td>{d.ready ? `${number(d.sell)} / 100` : "—"}</td>
              <td>{d.ready ? number(d.net) : "—"}</td>
              <td>
                {title}
                {d.grade > 0 ? ` · ${strength(d.grade)}` : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details className="decision-method">
        <summary>
          {t(
            "Scoring method, limitations and sources",
            "评分方法、限制与参考资料",
          )}
        </summary>
        <p>
          {t(
            "Contribution = weight × |grade| / 2. Positive grades add buy points; negative grades add sell points. Missing weights are never redistributed. Trend budget: 45%; momentum: 40%; relative strength: 15%. These groups still overlap and are not independent confirmations.",
            "单项贡献 = 权重 × |分级| ÷ 2。正分进入买入支持，负分进入卖出支持；缺失权重不重新分配。趋势预算 45%、动量 40%、相对强弱 15%；这些类别仍存在相关性，不是独立证据。",
          )}
        </p>
        <p>
          {t(
            "Net = adjusted buy − sell. |Net| <20: wait; [20,40): weak; [40,60): moderate; ≥60: strong. Positive favors buying; negative favors reducing. Conflict and data gates override all grades. Risk multipliers are applied to buy support once.",
            "净分 = 调整后买入支持 − 卖出支持。|净分| <20：观望；[20,40)：弱；[40,60)：中；≥60：强。正净分偏买入，负净分偏减仓；冲突和数据门槛优先于所有等级。风险乘数只作用于买入支持一次。",
          )}
        </p>
        <p>
          {t(
            "MACD histogram is divided by the same-date close ×100 to remove dollar-price scale. RSI below 30 does not automatically become a buy, nor does above 70 automatically become a sell. Annual excess return supplies context for the shorter horizon. No crossover or historical win rate is inferred from a snapshot.",
            "MACD 柱值除以同日收盘价再 ×100，消除绝对股价尺度。RSI 低于 30 不自动判买入，高于 70 不自动判卖出。一年超额收益用于补充中期背景；单点快照不推断交叉事件或历史胜率。",
          )}
        </p>
        <p>
          {t(
            "Thresholds and weights are our explicit heuristic choices; the following source explains indicator concepts and does not validate this scoring system.",
            "阈值和权重是本站明确设定的经验规则；以下资料仅解释指标概念，不为本评分体系提供验证。",
          )}{" "}
          <a
            href="https://www.fidelity.com/viewpoints/active-investor/how-to-use-RSI"
            target="_blank"
            rel="noreferrer"
          >
            Fidelity · RSI
          </a>
        </p>
      </details>
    </section>
  );
}
