import { useState } from "react";
import {
  variantIds,
  type BacktestBookReport,
  type BacktestReport,
  type BacktestReportSummary,
  type PerformanceStats,
  type RunId,
  type StrategyState,
  type VariantId,
} from "../../../shared/strategy";
import { familyLabels, ruleById } from "../../../shared/strategyRules";
import { EquityChart, seriesColors, seriesDashes } from "./EquityChart";
import { useStrategyFormat, type StrategyFormat } from "./format";
import {
  Empty,
  Pending,
  RunButton,
  classNamer,
  reportPath,
  type RunControls,
} from "./parts";
import { useResource } from "./strategyApi";
import {
  admissionLabels,
  benchmarkOrder,
  runLabels,
  warningDetail,
  warningLabels,
} from "./strategyText";

export const reportsPath = "/strategy/reports";

export function BacktestTab({
  book,
  state,
  controls,
}: {
  book: string;
  state: StrategyState;
  controls: RunControls;
}) {
  const { t, dateTime } = useStrategyFormat();
  const list = useResource<BacktestReportSummary[]>(reportsPath);
  const [picked, setPicked] = useState<string | null>(null);
  const summaries =
    list?.status === "ready"
      ? [...list.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
  const id =
    (picked && summaries.find((s) => s.id === picked)?.id) ??
    summaries[0]?.id ??
    null;
  const report = useResource<BacktestReport>(id ? reportPath(id) : null);
  const tz = state.scheduler.timezone;
  if (list?.status !== "ready")
    return (
      <Pending
        path={reportsPath}
        resource={list}
        label={t("reports", "报告列表")}
      />
    );
  if (!summaries.length || !id)
    return (
      <Empty
        title={t("No backtest report yet", "尚无回测报告")}
        action={<RunButton job="backtest" controls={controls} />}
      >
        {t(
          "Reports are generated every Saturday morning (New York) and kept for the latest 26 runs.",
          "回测报告在每周六上午（纽约时间）生成，保留最近 26 份。",
        )}
      </Empty>
    );
  const bookReport =
    report?.status === "ready"
      ? report.value.books.find((b) => b.book === book)
      : undefined;
  // Labels stay short enough for a phone-width picker: the data date tells
  // reports apart, and the run time is added only when it is needed to.
  const label = (s: BacktestReportSummary) => {
    const twin = summaries.some(
      (o) => o !== s && o.asOf === s.asOf && o.trigger === s.trigger,
    );
    return [
      `${t("Data to", "数据至")} ${s.asOf}`,
      s.trigger === "manual" && t("manual", "手动"),
      twin && dateTime(s.createdAt, tz),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const selected = summaries.find((s) => s.id === id)!;
  const created = dateTime(selected.createdAt, tz);
  return (
    <>
      <div className="research-toolbar strategy-report-toolbar">
        <label className="models-picker">
          {t("Report", "报告")}
          <select value={id} onChange={(e) => setPicked(e.target.value)}>
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <p className="research-meta">
          {selected.trigger === "manual"
            ? t(`Run manually ${created}. `, `${created} 手动运行。`)
            : t(`Scheduled run ${created}. `, `${created} 定时运行。`)}
          {t(
            "Price returns after costs. The universe is today's watchlist (survivorship bias), so judge alpha against risk-parity buy & hold of the same symbols, not against zero.",
            "扣除成本后的价格收益。标的池为当前自选列表（存在幸存者偏差），请以同一批标的的风险平价买入持有为基准判断超额收益，而非与零比较。",
          )}
        </p>
      </div>
      {report?.status !== "ready" ? (
        <Pending
          path={reportPath(id)}
          resource={report}
          label={t("report", "报告")}
        />
      ) : bookReport ? (
        <BookReport
          key={`${id}:${book}`}
          report={report.value}
          book={bookReport}
        />
      ) : (
        <Empty
          title={t("This book is not in the report", "该报告不包含此组合")}
        >
          {t(
            "Pick a newer report or run a backtest.",
            "请选择更新的报告或运行回测。",
          )}
        </Empty>
      )}
    </>
  );
}

type Column = {
  key: keyof PerformanceStats;
  label: [string, string];
  format: (f: StrategyFormat, s: PerformanceStats) => string;
};
const statColumns: Column[] = [
  {
    key: "cagr",
    label: ["CAGR", "年化复合"],
    format: (f, s) => f.signedPct(s.cagr),
  },
  {
    key: "totalReturn",
    label: ["Total", "累计"],
    format: (f, s) => f.signedPct(s.totalReturn),
  },
  {
    key: "annualVol",
    label: ["Vol", "波动率"],
    format: (f, s) => f.pct(s.annualVol),
  },
  {
    key: "sharpe",
    label: ["Sharpe", "夏普"],
    format: (f, s) =>
      `${f.number(s.sharpe, 2)} ± ${f.number(s.sharpeError, 2)}`,
  },
  {
    key: "sortino",
    label: ["Sortino", "索提诺"],
    format: (f, s) => f.number(s.sortino, 2),
  },
  {
    key: "maxDrawdown",
    label: ["Max DD", "最大回撤"],
    format: (f, s) => f.pct(s.maxDrawdown),
  },
  {
    key: "averageDrawdown",
    label: ["Avg DD", "平均回撤"],
    format: (f, s) => f.pct(s.averageDrawdown),
  },
  {
    key: "calmar",
    label: ["Calmar", "卡玛"],
    format: (f, s) => f.number(s.calmar, 2),
  },
  {
    key: "monthlySkew",
    label: ["Monthly skew", "月度偏度"],
    format: (f, s) => f.signed(s.monthlySkew, 2),
  },
  {
    key: "lowerTail",
    label: ["Lower tail", "左尾"],
    format: (f, s) => f.number(s.lowerTail, 2),
  },
  {
    key: "upperTail",
    label: ["Upper tail", "右尾"],
    format: (f, s) => f.number(s.upperTail, 2),
  },
  {
    key: "hitRate",
    label: ["Hit rate", "胜率"],
    format: (f, s) => f.pct(s.hitRate),
  },
  {
    key: "turnover",
    label: ["Turnover", "换手"],
    format: (f, s) => f.number(s.turnover, 1, "×"),
  },
  {
    key: "annualCost",
    label: ["Cost / yr", "年成本"],
    format: (f, s) => f.pct(s.annualCost, 2),
  },
  {
    key: "costSharpe",
    label: ["Cost SR", "成本 SR"],
    format: (f, s) => f.number(s.costSharpe, 3),
  },
  {
    key: "averageGross",
    label: ["Avg gross", "平均总敞口"],
    format: (f, s) => f.pct(s.averageGross),
  },
  {
    key: "overlayBinding",
    label: ["Overlay on", "叠加层触发"],
    format: (f, s) => f.pct(s.overlayBinding),
  },
  {
    key: "alpha",
    label: ["α vs RP", "相对风险平价 α"],
    format: (f, s) => f.signedPct(s.alpha),
  },
  {
    key: "beta",
    label: ["β vs RP", "相对风险平价 β"],
    format: (f, s) => f.number(s.beta, 2),
  },
  {
    key: "correlation",
    label: ["ρ vs RP", "相对风险平价 ρ"],
    format: (f, s) => f.number(s.correlation, 2),
  },
  {
    key: "alphaSpy",
    label: ["α vs SPY", "相对 SPY α"],
    format: (f, s) => f.signedPct(s.alphaSpy),
  },
  {
    key: "betaSpy",
    label: ["β vs SPY", "相对 SPY β"],
    format: (f, s) => f.number(s.betaSpy, 2),
  },
];

type DataQuality = BacktestBookReport["dataQuality"];
const legacyTrim =
  /^History before (\d{4}-\d{2}-\d{2}) dropped \((-?\d+(?:\.\d+)?)% in one session\)$/;
/**
 * Reports saved before `trimmed` existed listed trimmed symbols as load
 * failures with an English message; split them back out.
 */
function dataQuality(quality: DataQuality): DataQuality {
  if (quality.trimmed) return quality;
  const trimmed: DataQuality["trimmed"] = [];
  const failures = quality.failures.filter((f) => {
    const [, date, value] = f.message.match(legacyTrim) ?? [];
    if (date) trimmed.push({ symbol: f.symbol, date, return: Number(value) });
    return !date;
  });
  return { ...quality, failures, trimmed };
}

function BookReport({
  report,
  book,
}: {
  report: BacktestReport;
  book: BacktestBookReport;
}) {
  const format = useStrategyFormat();
  const {
    t,
    tr,
    number,
    signed,
    pct,
    signedPct,
    money,
    interval,
    probability,
  } = format;
  const [compare, setCompare] = useState<VariantId | "">("");
  const [allSymbols, setAllSymbols] = useState(false);
  const run = (id: RunId) => book.runs.find((r) => r.id === id);
  const chartIds: RunId[] = [
    "core",
    ...benchmarkOrder,
    ...(compare ? [compare] : []),
  ];
  const years = [
    ...new Set(book.runs.flatMap((r) => r.yearly.map((y) => y.year))),
  ].sort();
  const symbols = [...book.symbols].sort(
    (a, b) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity),
  );
  const shownSymbols = allSymbols ? symbols : symbols.slice(0, 15);
  const { deflatedSharpe: dsr, overfitting: pbo } = book.tests;
  const classLabel = classNamer(book.universe.classes);
  const quality = dataQuality(book.dataQuality);
  return (
    <>
      <section
        className="research-panel"
        aria-labelledby="strategy-report-heading"
      >
        <p className="eyebrow">
          {t(
            `Evaluation ${book.window.start} – ${book.window.end} · ${book.window.sessions} sessions · data from ${book.window.dataStart}`,
            `评估区间 ${book.window.start} – ${book.window.end} · ${book.window.sessions} 个交易日 · 数据始于 ${book.window.dataStart}`,
          )}
        </p>
        <h3 id="strategy-report-heading" className="strategy-heading">
          {tr(book.name)}
        </h3>
        <dl className="strategy-facts">
          <div>
            <dt>{t("Universe", "标的池")}</dt>
            <dd>
              {t(
                `${book.universe.symbols} symbols`,
                `${book.universe.symbols} 只`,
              )}
              <small>
                {t(
                  `${book.universe.eligibleAtStart} eligible at start · ${book.universe.classes.length} classes`,
                  `起点合格 ${book.universe.eligibleAtStart} 只 · ${book.universe.classes.length} 个类别`,
                )}
              </small>
            </dd>
          </div>
          <div>
            <dt>{t("Risk target · capital", "风险目标 · 资金")}</dt>
            <dd>
              {pct(book.riskTarget, 0)} · {money(book.capital)}
            </dd>
          </div>
          <div>
            <dt>IDM · FDM</dt>
            <dd>
              {number(book.idm.last, 2)} · {number(book.fdm.last, 2)}
              <small>
                {t("average", "平均")} {number(book.idm.average, 2)} ·{" "}
                {number(book.fdm.average, 2)}
              </small>
            </dd>
          </div>
          <div>
            <dt>{t("Config hash", "配置哈希")}</dt>
            <dd>
              <code>{report.configHash}</code>
            </dd>
          </div>
        </dl>
        {book.warnings.length > 0 && (
          <ul className="strategy-warnings" aria-label={t("Warnings", "警示")}>
            {book.warnings.map((w) => (
              <li key={`${w.code}:${w.detail}`}>
                <strong>
                  {tr(warningLabels[w.code] ?? { en: w.code, zh: w.code })}
                </strong>{" "}
                {warningDetail(w, format)}
              </li>
            ))}
          </ul>
        )}
        <div className="models-filters">
          <label>
            {t("Compare a variant", "对比变体")}
            <select
              value={compare}
              onChange={(e) => setCompare(e.target.value as VariantId | "")}
            >
              <option value="">{t("None", "不对比")}</option>
              {variantIds
                .filter((v) => v !== "core")
                .map((v) => (
                  <option key={v} value={v}>
                    {tr(runLabels[v])}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <EquityChart
          dates={book.dates}
          title={tr(book.name)}
          series={chartIds.flatMap((id, i) => {
            const r = run(id);
            return r
              ? [
                  {
                    id,
                    label: tr(runLabels[id]),
                    values: r.curve,
                    color: seriesColors[i],
                    dash: seriesDashes[i],
                    width: id === "core" ? 2.5 : 1.75,
                  },
                ]
              : [];
          })}
        />
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-stats-heading"
      >
        <h3 id="strategy-stats-heading" className="strategy-heading">
          {t("Variants & benchmarks", "变体与基准")}
        </h3>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap strategy-sticky"
          tabIndex={0}
        >
          <table aria-label={t("Backtest statistics", "回测统计")}>
            <thead>
              <tr>
                <th scope="col">{t("Run", "运行")}</th>
                {statColumns.map((c) => (
                  <th key={c.key} scope="col">
                    {t(c.label[0], c.label[1])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {book.runs.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === "core" ? "quant-primary-row" : undefined}
                >
                  <th scope="row">
                    {tr(runLabels[r.id])}
                    {r.kind === "benchmark" && (
                      <small>{t("benchmark", "基准")}</small>
                    )}
                  </th>
                  {statColumns.map((c) => (
                    <td key={c.key}>{c.format(format, r.stats)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="research-meta">
          {t(
            "Annual return = mean daily × 256, vol = daily std × 16, Sharpe with a zero risk-free rate ± its standard error. Drawdowns are positive peak-to-trough losses. Tail ratios: 1 is Gaussian. Turnover = traded value per year ÷ average position value. α is annualised daily OLS; RP = risk-parity buy & hold.",
            "年化收益 = 日均收益 × 256，波动率 = 日标准差 × 16，夏普比率按零无风险利率计算并附标准误。回撤为正值（峰值到谷底的跌幅）。尾部比率为 1 表示正态。换手 = 年交易额 ÷ 平均持仓市值。α 为日度 OLS 年化值；RP = 风险平价买入持有。",
          )}
        </p>
        <h4 className="strategy-subheading">
          {t("Calendar-year returns", "自然年收益")}
        </h4>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap strategy-sticky"
          tabIndex={0}
        >
          <table aria-label={t("Yearly returns", "年度收益")}>
            <thead>
              <tr>
                <th scope="col">{t("Run", "运行")}</th>
                {years.map((y) => (
                  <th key={y} scope="col">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {book.runs.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === "core" ? "quant-primary-row" : undefined}
                >
                  <th scope="row">{tr(runLabels[r.id])}</th>
                  {years.map((y) => (
                    <td key={y}>
                      {signedPct(
                        r.yearly.find((v) => v.year === y)?.return ?? null,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="research-meta">
          {t(
            "The first and last years are partial windows.",
            "首尾两年为不完整年度。",
          )}
        </p>
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-tests-heading"
      >
        <h3 id="strategy-tests-heading" className="strategy-heading">
          {t("Statistical tests", "统计检验")}
        </h3>
        <h4 className="strategy-subheading">
          {t("Sharpe differences", "夏普差异")}
        </h4>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap"
          tabIndex={0}
        >
          <table aria-label={t("Sharpe differences", "夏普差异")}>
            <thead>
              <tr>
                <th scope="col">{t("Comparison", "比较")}</th>
                <th scope="col">{t("Difference", "差值")}</th>
                <th scope="col">{t("95% interval", "95% 区间")}</th>
                <th scope="col">z</th>
                <th scope="col">p</th>
              </tr>
            </thead>
            <tbody>
              {book.tests.sharpeDifferences.map((d) => (
                <tr key={`${d.a}:${d.b}`}>
                  <th scope="row">
                    {tr(runLabels[d.a])} − {tr(runLabels[d.b])}
                  </th>
                  <td>{signed(d.difference, 2)}</td>
                  <td>{interval(d.interval)}</td>
                  <td>{signed(d.z, 2)}</td>
                  <td>{number(d.p, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="research-meta">
          {t(
            "Annual Sharpe difference with a paired 42-session block bootstrap (1,000 resamples); z and p from the Jobson–Korkie/Memmel test on daily Sharpe ratios.",
            "年化夏普差值，95% 区间来自 42 日配对分块重采样（1,000 次）；z 与 p 来自基于日度夏普的 Jobson–Korkie/Memmel 检验。",
          )}
        </p>
        <h4 className="strategy-subheading">
          {t("Family admission", "规则族准入")}
        </h4>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap"
          tabIndex={0}
        >
          <table aria-label={t("Family admission", "规则族准入")}>
            <thead>
              <tr>
                <th scope="col">{t("Family", "规则族")}</th>
                <th scope="col">{t("Core − without", "核心 − 剔除后")}</th>
                <th scope="col">{t("95% interval", "95% 区间")}</th>
                <th scope="col">{t("Verdict", "结论")}</th>
              </tr>
            </thead>
            <tbody>
              {book.tests.families.map((f) => (
                <tr key={f.family}>
                  <th scope="row">{tr(familyLabels[f.family])}</th>
                  <td>{signed(f.difference, 2)}</td>
                  <td>{interval(f.interval)}</td>
                  <td>
                    <span className={`strategy-admission ${f.status}`}>
                      {tr(admissionLabels[f.status])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="research-meta">
          {t(
            "Pre-registered: a family adds when the interval is above zero and detracts when below. Admission is reported only; it never changes live weights.",
            "预先登记：区间整体高于 0 为“有贡献”，低于 0 为“拖累”。准入结论仅作报告，从不自动改变实盘权重。",
          )}
        </p>
        <div className="ema-stat-grid strategy-kpis">
          <div>
            <span>{t("Deflated Sharpe probability", "通缩夏普概率")}</span>
            <strong>{probability(dsr.probability)}</strong>
            <small>
              {t(
                `${dsr.trials} trials (≈ ${number(dsr.effectiveTrials, 1)} independent) · SR₀ ${number(dsr.benchmarkSharpe, 2)}`,
                `${dsr.trials} 次尝试（约 ${number(dsr.effectiveTrials, 1)} 次独立）· SR₀ ${number(dsr.benchmarkSharpe, 2)}`,
              )}
            </small>
          </div>
          <div>
            <span>{t("Probability of overfitting", "过拟合概率 PBO")}</span>
            <strong>{probability(pbo.probability)}</strong>
            <small>
              {t(
                `CSCV · ${pbo.splits} splits × ${pbo.variants} variants`,
                `CSCV · ${pbo.splits} 次切分 × ${pbo.variants} 个变体`,
              )}
            </small>
          </div>
        </div>
        <p className="research-meta">
          {t(
            "The deflated Sharpe ratio (Bailey & López de Prado) asks how likely the core Sharpe is to be real after every configuration ever tried, including the four legacy event studies. PBO is the share of in-sample/out-of-sample splits in which the best in-sample variant ranks below the median out of sample. Neither test is from AFTS.",
            "通缩夏普比率（Bailey 与 López de Prado）在计入所有尝试过的配置（含四个旧事件研究）后，评估核心夏普为真的可能性。PBO 是样本内最优变体在样本外排名低于中位数的切分比例。两项检验均非 AFTS 内容。",
          )}
        </p>
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-rules-diag-heading"
      >
        <h3 id="strategy-rules-diag-heading" className="strategy-heading">
          {t("Rule diagnostics", "规则诊断")}
        </h3>
        <div
          className="ema-table-wrap strategy-table-wrap strategy-wrap strategy-sticky"
          tabIndex={0}
        >
          <table aria-label={t("Rule diagnostics", "规则诊断")}>
            <thead>
              <tr>
                <th scope="col">{t("Rule", "规则")}</th>
                <th scope="col">{t("Weight", "权重")}</th>
                <th scope="col">{t("Scalar", "缩放系数")}</th>
                <th scope="col">{t("Mean |f|", "平均 |f|")}</th>
                <th scope="col">{t("Turnover", "换手")}</th>
                <th scope="col">{t("Cost pass", "成本通过率")}</th>
                <th scope="col">{t("Sharpe", "夏普")}</th>
                <th scope="col">{t("Long-only SR", "只做多夏普")}</th>
                <th scope="col">{t("ρ to trend", "与趋势相关")}</th>
              </tr>
            </thead>
            <tbody>
              {book.rules.map((r) => {
                // Sign-gated rules are checked on gate-open sessions, as the
                // forecast_scale warning is. Older reports lack that mean, and
                // the zero-heavy all-session one says nothing about scale.
                const gateOpen = r.gateOpenMeanAbsForecast ?? null;
                const gated = ruleById[r.id]?.params.gate !== undefined;
                const scale = gateOpen ?? (gated ? null : r.meanAbsForecast);
                const off = scale !== null && (scale < 7 || scale > 13);
                const flag = off ? "strategy-negative" : undefined;
                return (
                  <tr key={r.id}>
                    <th scope="row">
                      {tr(ruleById[r.id]?.label ?? { en: r.id, zh: r.id })}
                      <small>{tr(familyLabels[r.family])}</small>
                    </th>
                    <td>{number(r.weight, 2, "%")}</td>
                    <td>
                      {number(r.scalar, 2)}
                      <small>
                        {r.scalarSource === "book"
                          ? t("book", "书中")
                          : t("pooled", "跨标的汇总")}
                      </small>
                    </td>
                    {gateOpen === null ? (
                      <td className={flag}>{number(r.meanAbsForecast, 1)}</td>
                    ) : (
                      <td>
                        {number(r.meanAbsForecast, 1)}
                        <small className={flag}>
                          {t("gate open", "门控开启")} {number(gateOpen, 1)}
                        </small>
                      </td>
                    )}
                    <td>{number(r.turnover, 1)}</td>
                    <td>{pct(r.costPassRate)}</td>
                    <td>{number(r.sharpe, 2)}</td>
                    <td>{number(r.longOnlySharpe, 2)}</td>
                    <td>{number(r.correlationToTrend, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="research-meta">
          {t(
            "Mean |f| should stay near 10 (flagged outside 7–13). Trend-gated reversion forecasts are 0 while the gate is closed, so their all-session mean sits far below 10; they are checked on gate-open sessions instead. Turnover is forecast turnover per year. Cost pass is the share of eligible symbols where the rule stays under the 0.15 SR speed limit. Rule Sharpe ratios come from pooled single-rule account curves after costs.",
            "平均 |f| 应接近 10（超出 7–13 会标红）。顺势均值回归在门控关闭时预测值为 0，全时段均值因此远低于 10，故改按门控开启的交易日检查。换手为每年预测换手。成本通过率为该规则低于 0.15 SR 速度限制的合格标的占比。规则夏普来自扣除成本后、跨标的汇总的单规则账户曲线。",
          )}
        </p>
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-attribution-heading"
      >
        <h3 id="strategy-attribution-heading" className="strategy-heading">
          {t("Attribution", "收益归因")}
        </h3>
        <div className="strategy-columns">
          <div
            className="ema-table-wrap strategy-table-wrap strategy-wrap"
            tabIndex={0}
          >
            <table aria-label={t("Class attribution", "类别归因")}>
              <thead>
                <tr>
                  <th scope="col">{t("Class", "类别")}</th>
                  <th scope="col">{t("Contribution", "贡献")}</th>
                  <th scope="col">{t("Avg weight", "平均权重")}</th>
                </tr>
              </thead>
              <tbody>
                {book.classes.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td>{signedPct(c.contribution, 2)}</td>
                    <td>{pct(c.averageWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="ema-table-wrap strategy-table-wrap strategy-wrap strategy-scroll"
            tabIndex={0}
          >
            <table aria-label={t("Symbol attribution", "个股归因")}>
              <thead>
                <tr>
                  <th scope="col">{t("Symbol", "代码")}</th>
                  <th scope="col">{t("Contribution", "贡献")}</th>
                  <th scope="col">{t("Avg weight", "平均权重")}</th>
                  <th scope="col">{t("Trades", "交易次数")}</th>
                </tr>
              </thead>
              <tbody>
                {shownSymbols.map((s) => (
                  <tr key={s.symbol}>
                    <th scope="row">
                      {s.symbol}
                      <small>{classLabel(s.class)}</small>
                    </th>
                    <td>{signedPct(s.contribution, 2)}</td>
                    <td>{pct(s.averageWeight, 2)}</td>
                    <td>{s.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {symbols.length > 15 && (
          <button type="button" onClick={() => setAllSymbols(!allSymbols)}>
            {allSymbols
              ? t("Show top 15", "只看前 15")
              : t(
                  `Show all ${symbols.length} symbols`,
                  `显示全部 ${symbols.length} 只`,
                )}
          </button>
        )}
        <p className="research-meta">
          {t(
            "Contribution = summed daily P&L of the core system ÷ capital, in percent; classes sum their symbols.",
            "贡献 = 核心系统每日盈亏之和 ÷ 资金（百分比）；类别为其成员之和。",
          )}
        </p>
      </section>

      <section
        className="research-panel"
        aria-labelledby="strategy-quality-heading"
      >
        <h3 id="strategy-quality-heading" className="strategy-heading">
          {t("Data quality", "数据质量")}
        </h3>
        <dl className="strategy-facts">
          <div>
            <dt>{t("Failed to load", "加载失败")}</dt>
            <dd>
              {quality.failures.length
                ? quality.failures
                    .map((f) => `${f.symbol} (${f.message})`)
                    .join(" · ")
                : t("None", "无")}
            </dd>
          </div>
          <div>
            <dt>{t("Early history trimmed", "早期历史已截断")}</dt>
            <dd>
              {quality.trimmed.length
                ? quality.trimmed
                    .map((c) => {
                      const jump = signedPct(c.return);
                      return t(
                        `${c.symbol} before ${c.date} (${jump} in one session)`,
                        `${c.symbol} ${c.date} 之前（单日 ${jump}）`,
                      );
                    })
                    .join(" · ")
                : t("None", "无")}
            </dd>
          </div>
          <div>
            <dt>{t("Price jumps over 40%", "超过 40% 的价格跳变")}</dt>
            <dd>
              {quality.jumps.length
                ? quality.jumps
                    .map((j) => `${j.symbol} ${j.date} ${signedPct(j.return)}`)
                    .join(" · ")
                : t("None", "无")}
            </dd>
          </div>
          <div>
            <dt>{t("Short history", "历史较短")}</dt>
            <dd>
              {quality.shortHistory.length
                ? quality.shortHistory.join(" · ")
                : t("None", "无")}
            </dd>
          </div>
        </dl>
        <p className="research-meta">
          {t(
            "Bars are split-adjusted, price-only daily closes on SPY's session calendar; dividends are excluded and idle cash earns nothing. A one-session move above +300% or below −80% is treated as a different security, so the history before it is dropped; the symbol still trades on the rest.",
            "日线为按 SPY 交易日历对齐、拆股调整后的价格（不含分红），闲置现金不计利息。单日涨幅超过 +300% 或跌幅超过 −80% 视为不同证券，之前的历史被舍弃；该标的仍按其余历史正常交易。",
          )}
        </p>
      </section>
    </>
  );
}
