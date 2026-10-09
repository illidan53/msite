import type {
  BacktestReport,
  BookSnapshot,
  PaperLedger,
  PerformanceStats,
  RunId,
  RunRecord,
  StrategyState,
} from "../../../shared/strategy";
import { EquityChart, seriesColors, seriesDashes } from "./EquityChart";
import { useStrategyFormat, type StrategyFormat } from "./format";
import {
  Empty,
  LatestGate,
  Pending,
  RunButton,
  reportPath,
  type RunControls,
  type TabId,
} from "./parts";
import { SignalTable } from "./SignalsTab";
import { useResource } from "./strategyApi";
import { benchmarkOrder, runLabels } from "./strategyText";

export function OverviewTab({
  book,
  state,
  controls,
  onOpen,
}: {
  book: string;
  state: StrategyState;
  controls: RunControls;
  onOpen: (tab: TabId) => void;
}) {
  return (
    <>
      <StatusPanel state={state} />
      <ReportOverview
        book={book}
        state={state}
        controls={controls}
        onOpen={onOpen}
      />
      <LatestGate book={book} controls={controls}>
        {(snapshot) => (
          <>
            <PaperPanel book={book} snapshot={snapshot} />
            <TodaySignals snapshot={snapshot} onOpen={onOpen} />
          </>
        )}
      </LatestGate>
    </>
  );
}

function weekday(day: number, locale: string) {
  // 1 January 2023 was a Sunday, matching weeklyDay 0.
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { weekday: "long", timeZone: "UTC" },
  );
}
function RunSummary({
  record,
  timezone,
}: {
  record: RunRecord | null;
  timezone: string;
}) {
  const { t, dateTime } = useStrategyFormat();
  if (!record) return <>{t("Never", "从未运行")}</>;
  const status = {
    complete: t("Complete", "完成"),
    skipped: t("Skipped · no new session", "跳过 · 无新交易日"),
    failed: t("Failed", "失败"),
  }[record.status];
  return (
    <>
      {dateTime(record.at, timezone)}
      <small>
        <span className={`research-status ${record.status}`}>{status}</span>{" "}
        {record.trigger === "manual"
          ? t("manual", "手动")
          : t("scheduled", "定时")}
        {record.asOf &&
          t(` · data as of ${record.asOf}`, ` · 数据截至 ${record.asOf}`)}
        {record.emailed && t(" · emailed", " · 已发邮件")}
        {record.message && ` · ${record.message}`}
      </small>
    </>
  );
}

function StatusPanel({ state }: { state: StrategyState }) {
  const { t, locale, dateTime } = useStrategyFormat();
  const { scheduler, email } = state;
  const tz = scheduler.timezone;
  const kind = {
    signals: t("signal digest", "信号摘要"),
    report: t("weekly report", "周报"),
    failure: t("failure alert", "失败提醒"),
    test: t("test email", "测试邮件"),
  };
  const sent = {
    sent: t("sent", "已发送"),
    failed: t("failed", "失败"),
    disabled: t("logged only", "仅记录"),
  };
  return (
    <section
      className="research-panel strategy-status"
      aria-labelledby="strategy-status-heading"
    >
      <h3 id="strategy-status-heading">{t("System status", "系统状态")}</h3>
      <dl className="strategy-facts">
        <div>
          <dt>{t("Last daily run", "上次每日运行")}</dt>
          <dd>
            <RunSummary record={scheduler.lastDaily} timezone={tz} />
          </dd>
        </div>
        <div>
          <dt>{t("Last backtest", "上次回测")}</dt>
          <dd>
            <RunSummary record={scheduler.lastBacktest} timezone={tz} />
          </dd>
        </div>
        <div>
          <dt>{t("Next runs", "下次运行")}</dt>
          <dd>
            {scheduler.enabled ? (
              <>
                {t("Daily", "每日")} {dateTime(scheduler.nextDaily, tz)}
                <small>
                  {t("Weekly backtest", "每周回测")}{" "}
                  {dateTime(scheduler.nextBacktest, tz)}
                </small>
              </>
            ) : (
              <>
                {t("Scheduler off on this server", "本服务器未启用定时任务")}
                <small>
                  {t(
                    `Production runs daily at ${scheduler.dailyAt} and backtests ${weekday(scheduler.weeklyDay, "en")} at ${scheduler.weeklyAt} (New York).`,
                    `生产环境每日 ${scheduler.dailyAt} 运行，每${weekday(scheduler.weeklyDay, locale)} ${scheduler.weeklyAt} 回测（纽约时间）。`,
                  )}
                </small>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("Email alerts", "邮件提醒")}</dt>
          <dd>
            {email.configured
              ? t(
                  `Configured · ${email.transport === "ses" ? "Amazon SES" : "SMTP"}`,
                  `已配置 · ${email.transport === "ses" ? "Amazon SES" : "SMTP"}`,
                )
              : t("Not configured", "未配置")}
            <small>
              {email.lastSent
                ? t(
                    `Last ${kind[email.lastSent.kind]} ${sent[email.lastSent.status]} ${dateTime(email.lastSent.at, tz)}`,
                    `最近一封${kind[email.lastSent.kind]}${sent[email.lastSent.status]}于 ${dateTime(email.lastSent.at, tz)}`,
                  )
                : t("No email recorded yet", "尚无邮件记录")}
            </small>
          </dd>
        </div>
      </dl>
      {state.lastFailure && (
        <p role="alert" className="research-notice">
          {t(
            `The last ${state.lastFailure.job} job failed ${dateTime(state.lastFailure.at, tz)}: ${state.lastFailure.message}`,
            `上次${state.lastFailure.job === "daily" ? "每日" : "回测"}任务于 ${dateTime(state.lastFailure.at, tz)} 失败：${state.lastFailure.message}`,
          )}
        </p>
      )}
    </section>
  );
}

const kpis: {
  key: keyof PerformanceStats;
  label: [string, string];
  format: (f: StrategyFormat, v: number | null) => string;
}[] = [
  {
    key: "sharpe",
    label: ["Sharpe ratio", "夏普比率"],
    format: (f, v) => f.number(v, 2),
  },
  {
    key: "cagr",
    label: ["CAGR", "年化复合收益"],
    format: (f, v) => f.signedPct(v),
  },
  {
    key: "maxDrawdown",
    label: ["Max drawdown", "最大回撤"],
    format: (f, v) => f.pct(v),
  },
  {
    key: "annualVol",
    label: ["Volatility", "年化波动率"],
    format: (f, v) => f.pct(v),
  },
];
const chartRuns: RunId[] = ["core", ...benchmarkOrder];

function ReportOverview({
  book,
  state,
  controls,
  onOpen,
}: {
  book: string;
  state: StrategyState;
  controls: RunControls;
  onOpen: (tab: TabId) => void;
}) {
  const format = useStrategyFormat();
  const { t, tr, dateTime } = format;
  const id = state.latestReport?.id ?? null;
  const path = id ? reportPath(id) : null;
  const report = useResource<BacktestReport>(path);
  if (!path)
    return (
      <Empty
        title={t("No backtest report yet", "尚无回测报告")}
        action={<RunButton job="backtest" controls={controls} />}
      >
        {t(
          "The weekly backtest re-runs the system and its variants against SPY, equal-weight and risk-parity buy-and-hold. It runs every Saturday morning.",
          "每周回测会重跑系统及其变体，并与 SPY、等权和风险平价买入持有比较。每周六上午自动运行。",
        )}
      </Empty>
    );
  if (report?.status !== "ready")
    return (
      <Pending path={path} resource={report} label={t("backtest", "回测")} />
    );
  const bookReport = report.value.books.find((b) => b.book === book);
  if (!bookReport) return null;
  const run = (id: RunId) => bookReport.runs.find((r) => r.id === id);
  const core = run("core");
  const parity = run("risk_parity_buy_hold");
  const spy = run("spy_buy_hold");
  return (
    <section
      className="research-panel strategy-kpi-panel"
      aria-labelledby="strategy-kpi-heading"
    >
      <div className="models-section-heading">
        <div>
          <p className="eyebrow">
            {t(
              `Backtest ${bookReport.window.start} – ${bookReport.window.end} · ${bookReport.window.sessions} sessions`,
              `回测 ${bookReport.window.start} – ${bookReport.window.end} · ${bookReport.window.sessions} 个交易日`,
            )}
          </p>
          <h3 id="strategy-kpi-heading">
            {t("Core system vs benchmarks", "核心系统与基准对比")}
          </h3>
        </div>
        <button type="button" onClick={() => onOpen("backtest")}>
          {t("Open backtest details", "查看回测详情")}
        </button>
      </div>
      <div className="ema-stat-grid strategy-kpis">
        {kpis.map((k) => {
          const value = (stats: PerformanceStats | undefined) =>
            k.format(format, (stats?.[k.key] as number | null) ?? null);
          return (
            <div key={k.key}>
              <span>{t(k.label[0], k.label[1])}</span>
              <strong>{value(core?.stats)}</strong>
              <small>
                {t("Risk parity", "风险平价")} {value(parity?.stats)} · SPY{" "}
                {value(spy?.stats)}
              </small>
            </div>
          );
        })}
      </div>
      <EquityChart
        dates={bookReport.dates}
        title={tr(bookReport.name)}
        series={chartRuns.flatMap((id, i) => {
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
        caption={t(
          `Price returns after costs, report of ${dateTime(report.value.createdAt, state.scheduler.timezone)}. The universe is today's watchlist, so buy-and-hold of the same names is flattered by survivorship; alpha is judged against risk-parity buy & hold.`,
          `扣除成本后的价格收益，报告生成于 ${dateTime(report.value.createdAt, state.scheduler.timezone)}。标的池为当前自选列表，同一批股票的买入持有受幸存者偏差抬高；超额收益以风险平价买入持有为基准判断。`,
        )}
      />
    </section>
  );
}

function PaperPanel({
  book,
  snapshot,
}: {
  book: string;
  snapshot: BookSnapshot;
}) {
  const { t, money, signedPct, pct, number, shares } = useStrategyFormat();
  const path = `/strategy/paper/${encodeURIComponent(book)}`;
  const ledger = useResource<PaperLedger>(path);
  const paper = snapshot.paper;
  const value = ledger?.status === "ready" ? ledger.value : null;
  const equity = value?.equity ?? [];
  const firstBenchmark = equity.find((e) => e.benchmark !== null)?.benchmark;
  const fills = value?.fills.slice(-8).reverse() ?? [];
  return (
    <section
      className="research-panel"
      aria-labelledby="strategy-paper-heading"
    >
      <p className="eyebrow">
        {t(
          `Forward paper trading since ${paper.inception}`,
          `自 ${paper.inception} 起的前向模拟交易`,
        )}
      </p>
      <h3 id="strategy-paper-heading" className="strategy-heading">
        {t("Paper record", "模拟交易记录")}
      </h3>
      <div className="ema-stat-grid strategy-kpis">
        <div>
          <span>{t("Equity", "净值")}</span>
          <strong>{money(paper.equity)}</strong>
          <small>
            {t("Capital", "初始资金")} {money(paper.capital)} ·{" "}
            {t("cash", "现金")} {money(paper.cash)}
          </small>
        </div>
        <div>
          <span>{t("Total return", "累计收益")}</span>
          <strong>{signedPct(paper.totalReturn, 2)}</strong>
          <small>SPY {signedPct(paper.benchmarkReturn, 2)}</small>
        </div>
        <div>
          <span>{t("Last session", "最近交易日")}</span>
          <strong>{signedPct(paper.dayReturn, 2)}</strong>
          <small>{paper.lastSession}</small>
        </div>
        <div>
          <span>{t("Positions", "持仓数")}</span>
          <strong>{number(paper.positions, 0)}</strong>
          <small>
            {t("Gross exposure", "总敞口")} {pct(paper.gross)}
          </small>
        </div>
      </div>
      {ledger?.status === "error" && ledger.error.status === 404 ? null : (
        <Pending
          path={path}
          resource={ledger}
          label={t("paper record", "模拟交易记录")}
        />
      )}
      {value && equity.length >= 2 ? (
        <EquityChart
          dates={equity.map((e) => e.date)}
          title={t("Paper record", "模拟交易记录")}
          series={[
            {
              id: "paper",
              label: t("Paper equity", "模拟净值"),
              values: equity.map((e) => (e.value / value.capital) * 100),
              color: seriesColors[0],
              width: 2.5,
            },
            {
              id: "spy",
              label: "SPY",
              values: equity.map((e) =>
                e.benchmark !== null && firstBenchmark
                  ? (e.benchmark / firstBenchmark) * 100
                  : null,
              ),
              color: seriesColors[2],
              dash: seriesDashes[1],
              width: 1.75,
            },
          ]}
          caption={t(
            "Orders are decided after each close and filled at the next open; the ledger is appended forward and never recomputed from history.",
            "每个收盘后决策、次日开盘成交；账本只向前追加，从不用历史重算。",
          )}
        />
      ) : (
        value && (
          <p className="research-meta">
            {t(
              "The paper curve appears after the second recorded session.",
              "记录满两个交易日后显示模拟净值曲线。",
            )}
          </p>
        )
      )}
      {fills.length > 0 && (
        <details className="models-method">
          <summary>{t("Recent paper fills", "最近模拟成交")}</summary>
          <div className="ema-table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("Date", "日期")}</th>
                  <th scope="col">{t("Side", "方向")}</th>
                  <th scope="col">{t("Symbol", "代码")}</th>
                  <th scope="col">{t("Shares", "股数")}</th>
                  <th scope="col">{t("Open price", "开盘价")}</th>
                  <th scope="col">{t("Cost", "成本")}</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <tr key={`${f.signalId}:${f.date}`}>
                    <td>{f.date}</td>
                    <td>
                      {f.side === "buy" ? t("Buy", "买入") : t("Sell", "卖出")}
                    </td>
                    <th scope="row">{f.symbol}</th>
                    <td>{shares(f.shares)}</td>
                    <td>{money(f.price, 2)}</td>
                    <td>{money(f.cost, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function TodaySignals({
  snapshot,
  onOpen,
}: {
  snapshot: BookSnapshot;
  onOpen: (tab: TabId) => void;
}) {
  const { t } = useStrategyFormat();
  return (
    <section
      className="research-panel"
      aria-labelledby="strategy-today-heading"
    >
      <div className="models-section-heading">
        <div>
          <p className="eyebrow">
            {t(
              `Decided after the ${snapshot.asOf} close · for the next open`,
              `${snapshot.asOf} 收盘后决策 · 次日开盘执行`,
            )}
          </p>
          <h3 id="strategy-today-heading">
            {t("Today's signals", "今日信号")}
          </h3>
        </div>
        <button type="button" onClick={() => onOpen("signals")}>
          {t("Signal history", "信号历史")}
        </button>
      </div>
      {snapshot.signals.length ? (
        <SignalTable signals={snapshot.signals} compact />
      ) : (
        <p className="quant-model-empty">
          {t(
            "No orders for the next open: every holding is inside its buffer.",
            "次日开盘无订单：所有持仓都在缓冲带内。",
          )}
        </p>
      )}
    </section>
  );
}
