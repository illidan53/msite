import { ChevronDown } from "lucide-react";
import { ruleFamilies } from "../../../shared/strategy";
import { familyLabels, ruleCatalog } from "../../../shared/strategyRules";
import { useStrategyFormat } from "./format";
import { familyColors } from "./parts";
import {
  bookCitation,
  familyIntuition,
  frameworkItems,
  ruleText,
} from "./strategyText";

const pad = (n: number) => String(n).padStart(2, "0");

export function RulesTab() {
  const { t, tr, number } = useStrategyFormat();
  return (
    <>
      <section
        className="research-panel strategy-rules"
        aria-labelledby="strategy-catalog-heading"
      >
        <p className="eyebrow">
          {t("Pre-registered rule catalog", "预先登记的规则目录")}
        </p>
        <h3 id="strategy-catalog-heading" className="strategy-heading">
          {t("Trading rules", "交易规则")}
        </h3>
        <p className="quant-model-intro">
          {t(
            "Seventeen continuous rules in four families. Each turns prices into a forecast scaled to an average |f| of 10 and capped at ±20; the system combines them with fixed weights. Nothing here is re-fitted on results.",
            "四个规则族共 17 条连续规则。每条规则把价格转化为平均 |f| 为 10、截断在 ±20 的预测值，系统再以固定权重组合。这些设置不会根据结果重新拟合。",
          )}
        </p>
        {ruleFamilies.map((family) => {
          const rules = ruleCatalog.filter((r) => r.family === family);
          const weight = rules.reduce((s, r) => s + r.weight, 0);
          return (
            <section
              key={family}
              className="strategy-family"
              aria-labelledby={`strategy-family-${family}`}
            >
              <h4 id={`strategy-family-${family}`}>
                <span
                  className="strategy-swatch"
                  style={{ background: familyColors[family] }}
                  aria-hidden="true"
                />
                {tr(familyLabels[family])}
                <small>
                  {t(
                    `${number(weight, 0)}% of weight`,
                    `权重 ${number(weight, 0)}%`,
                  )}
                </small>
              </h4>
              <p className="research-meta">{tr(familyIntuition[family])}</p>
              <div className="strategy-rule-grid">
                {rules.map((rule) => (
                  <article key={rule.id} className="strategy-rule">
                    <header>
                      <h5>{tr(rule.label)}</h5>
                      <code>{rule.id}</code>
                    </header>
                    <p className="strategy-formula">
                      {ruleText[rule.id].formula}
                    </p>
                    <p>{tr(ruleText[rule.id].intuition)}</p>
                    <dl>
                      <div>
                        <dt>{t("Scalar", "缩放系数")}</dt>
                        <dd>
                          {rule.scalar === null
                            ? t("Pooled, expanding", "跨标的扩展估计")
                            : number(rule.scalar, 2)}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("Weight", "权重")}</dt>
                        <dd>{number(rule.weight, 2, "%")}</dd>
                      </div>
                      <div>
                        <dt>{t("Warm-up", "预热")}</dt>
                        <dd>
                          {t(
                            `${rule.warmup} sessions`,
                            `${rule.warmup} 个交易日`,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("Source", "出处")}</dt>
                        <dd>{rule.source}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-framework-heading"
      >
        <p className="eyebrow">
          {t("How forecasts become positions", "预测如何变成仓位")}
        </p>
        <h3 id="strategy-framework-heading" className="strategy-heading">
          {t("The framework", "系统框架")}
        </h3>
        <div className="model-notes strategy-notes">
          {frameworkItems.map((item, i) => (
            <details key={item.id}>
              <summary>
                <span>{pad(i + 1)}</span>
                <strong>{tr(item.title)}</strong>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                {tr(item.body)} <small>{item.source}</small>
              </p>
            </details>
          ))}
        </div>
        <p className="research-notice">
          {t(
            "The four pullback event studies (EMA200, SMA50, RSI(2) and Bollinger) remain on Analytics → Models and in Dig Deep as research diagnostics. They carry no weight here: sparse on/off events break forecast scaling, so their ideas survive as slow trend and trend-gated mean reversion.",
            "四个回踩事件研究（EMA200、SMA50、RSI(2) 与布林带）仍作为研究诊断保留在“分析 → 模型”与“深度研究”中，在本系统中权重为 0：稀疏的开关式事件会破坏预测缩放，其思路以慢速趋势和顺势均值回归的形式延续。",
          )}
        </p>
        <p className="research-meta">
          {t("Source:", "出处：")} {tr(bookCitation)}.{" "}
          {t(
            "Constants were cross-checked against Carver's pysystemtrade and the book's own example code. Historical and descriptive; not investment advice.",
            "常数已与 Carver 的 pysystemtrade 及书中示例代码交叉核对。内容为历史与描述性信息，不构成投资建议。",
          )}
        </p>
      </section>
    </>
  );
}
