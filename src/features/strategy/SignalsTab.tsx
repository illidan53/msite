import type {
  OutboxEntry,
  Signal,
  SignalRecord,
} from "../../../shared/strategy";
import { ruleById } from "../../../shared/strategyRules";
import { useStrategyFormat } from "./format";
import { ActionBadge, LatestGate, Pending, type RunControls } from "./parts";
import { useResource } from "./strategyApi";
import { reasonLabels } from "./strategyText";

export const signalsPath = "/strategy/signals?limit=200";
export const outboxPath = "/strategy/outbox";

export function SignalsTab({
  book,
  controls,
}: {
  book: string;
  controls: RunControls;
}) {
  const { t } = useStrategyFormat();
  return (
    <>
      <LatestGate book={book} controls={controls}>
        {(snapshot) => (
          <section
            className="research-panel"
            aria-labelledby="strategy-orders-heading"
          >
            <p className="eyebrow">
              {t(
                `Decided after the ${snapshot.asOf} close · fill at the next open`,
                `${snapshot.asOf} 收盘后决策 · 次日开盘成交`,
              )}
            </p>
            <h3 id="strategy-orders-heading" className="strategy-heading">
              {t("Latest orders", "最新订单")}
            </h3>
            {snapshot.signals.length ? (
              <SignalTable signals={snapshot.signals} />
            ) : (
              <p className="quant-model-empty">
                {t(
                  "No orders for the next open: every holding is inside its buffer.",
                  "次日开盘无订单：所有持仓都在缓冲带内。",
                )}
              </p>
            )}
            <p className="research-meta">
              {t(
                "Shares are fractional (0.0001). Notional uses the decision close; the fill is the next open. Drivers are the three rules contributing most to the combined forecast (weight × forecast × FDM). Signals are system output, not investment advice.",
                "股数为碎股（0.0001）。名义金额按决策日收盘价估算，实际按次日开盘价成交。驱动因素为对组合预测贡献最大的三条规则（权重 × 预测值 × FDM）。信号是系统输出，不构成投资建议。",
              )}
            </p>
          </section>
        )}
      </LatestGate>
      <SignalHistory book={book} />
      <Outbox />
    </>
  );
}

/** Orders with their sizing context; compact drops the driver breakdown. */
export function SignalTable({
  signals,
  compact = false,
}: {
  signals: Signal[];
  compact?: boolean;
}) {
  const { t, tr, signed, money, shares, pct } = useStrategyFormat();
  return (
    <div className="ema-table-wrap strategy-table-wrap" tabIndex={0}>
      <table aria-label={t("Signals", "信号")}>
        <thead>
          <tr>
            <th scope="col">{t("Action", "操作")}</th>
            <th scope="col">{t("Symbol", "代码")}</th>
            <th scope="col">{t("Shares", "股数")}</th>
            <th scope="col">{t("≈ Notional", "≈ 金额")}</th>
            <th scope="col">{t("Weight", "权重")}</th>
            <th scope="col">{t("Forecast", "预测值")}</th>
            {!compact && <th scope="col">{t("Drivers", "驱动因素")}</th>}
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={s.id}>
              <td>
                <ActionBadge action={s.action} />
                {s.reason !== "forecast" && (
                  <small>
                    {s.reason === "removed"
                      ? t("Removed from book", "已移出组合")
                      : t("No longer eligible", "不再合格")}
                  </small>
                )}
              </td>
              <th scope="row">
                {s.symbol}
                <small>{s.class}</small>
              </th>
              <td>{shares(s.shares)}</td>
              <td>{money(s.notional)}</td>
              <td>
                {pct(s.fromWeight, 2)} → {pct(s.toWeight, 2)}
              </td>
              <td>{signed(s.forecast, 1)}</td>
              {!compact && (
                <td>
                  <ul className="strategy-drivers">
                    {s.drivers.map((d) => (
                      <li key={d.rule}>
                        {tr(
                          ruleById[d.rule]?.label ?? { en: d.rule, zh: d.rule },
                        )}{" "}
                        <span>{signed(d.contribution, 2)}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalHistory({ book }: { book: string }) {
  const { t, tr, money, shares } = useStrategyFormat();
  const resource = useResource<SignalRecord[]>(signalsPath);
  const rows =
    resource?.status === "ready"
      ? resource.value.filter((s) => s.book === book)
      : [];
  const fill = (s: SignalRecord) =>
    !s.fill ? (
      <span className="research-status running">{t("Pending", "待成交")}</span>
    ) : "cancelled" in s.fill ? (
      <>
        <span className="research-status failed">
          {t("Cancelled", "已取消")}
        </span>
        <small>{s.fill.cancelled}</small>
      </>
    ) : (
      <>
        <span className="research-status complete">
          {t("Filled", "已成交")}
        </span>
        <small>
          {s.fill.date} @ {money(s.fill.price, 2)} · {t("cost", "成本")}{" "}
          {money(s.fill.cost, 2)}
        </small>
      </>
    );
  return (
    <section
      className="research-panel"
      aria-labelledby="strategy-history-heading"
    >
      <h3 id="strategy-history-heading" className="strategy-heading">
        {t("Signal history", "信号历史")}
      </h3>
      <Pending
        path={signalsPath}
        resource={resource}
        label={t("signal history", "信号历史")}
      />
      {resource?.status === "ready" &&
        (rows.length ? (
          <div
            className="ema-table-wrap strategy-table-wrap strategy-scroll"
            tabIndex={0}
          >
            <table aria-label={t("Signal history", "信号历史")}>
              <thead>
                <tr>
                  <th scope="col">{t("Decided", "决策日")}</th>
                  <th scope="col">{t("Action", "操作")}</th>
                  <th scope="col">{t("Symbol", "代码")}</th>
                  <th scope="col">{t("Shares", "股数")}</th>
                  <th scope="col">{t("Close", "收盘价")}</th>
                  <th scope="col">{t("Fill", "成交")}</th>
                  <th scope="col">{t("Emailed", "已发邮件")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>{s.asOf}</td>
                    <td>
                      <ActionBadge action={s.action} />
                      {s.reason === "ineligible" && (
                        <small>{t("No longer eligible", "不再合格")}</small>
                      )}
                    </td>
                    <th scope="row">{s.symbol}</th>
                    <td>{shares(s.shares)}</td>
                    <td>{money(s.price, 2)}</td>
                    <td>{fill(s)}</td>
                    <td>{s.emailed ? t("Yes", "是") : t("No", "否")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="quant-model-empty">
            {t(
              "No signals recorded for this book yet.",
              "该组合尚无信号记录。",
            )}
          </p>
        ))}
      <p className="research-meta">
        {t(
          `Ineligibility reasons: ${Object.values(reasonLabels)
            .map((r) => r.en.toLowerCase())
            .join(
              ", ",
            )}. Orders without a bar on the next session wait one session, then are cancelled.`,
          `不合格原因：${Object.values(reasonLabels)
            .map((r) => tr(r))
            .join("、")}。下一交易日没有行情的订单会等待一个交易日，之后取消。`,
        )}
      </p>
    </section>
  );
}

function Outbox() {
  const { t, dateTime } = useStrategyFormat();
  const resource = useResource<OutboxEntry[]>(outboxPath);
  const kind = (k: OutboxEntry["kind"]) =>
    ({
      signals: t("Signal digest", "信号摘要"),
      report: t("Weekly report", "周报"),
      failure: t("Failure alert", "失败提醒"),
      test: t("Test", "测试"),
    })[k];
  const status = (s: OutboxEntry["status"]) =>
    ({
      sent: t("Sent", "已发送"),
      failed: t("Failed", "失败"),
      disabled: t("Logged only", "仅记录"),
    })[s];
  return (
    <section
      className="research-panel"
      aria-labelledby="strategy-outbox-heading"
    >
      <h3 id="strategy-outbox-heading" className="strategy-heading">
        {t("Email outbox", "邮件发送记录")}
      </h3>
      <Pending
        path={outboxPath}
        resource={resource}
        label={t("outbox", "发送记录")}
      />
      {resource?.status === "ready" &&
        (resource.value.length ? (
          <div className="ema-table-wrap strategy-table-wrap" tabIndex={0}>
            <table aria-label={t("Email outbox", "邮件发送记录")}>
              <thead>
                <tr>
                  <th scope="col">{t("Time", "时间")}</th>
                  <th scope="col">{t("Kind", "类型")}</th>
                  <th scope="col">{t("Subject", "主题")}</th>
                  <th scope="col">{t("Status", "状态")}</th>
                </tr>
              </thead>
              <tbody>
                {resource.value.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.createdAt, "America/New_York")}</td>
                    <td>{kind(e.kind)}</td>
                    <th scope="row" className="strategy-subject">
                      {e.subject}
                    </th>
                    <td>
                      <span
                        className={`research-status ${e.status === "sent" ? "complete" : e.status === "failed" ? "failed" : ""}`}
                      >
                        {status(e.status)}
                      </span>
                      <small>
                        {e.transport === "ses"
                          ? "Amazon SES"
                          : e.transport === "smtp"
                            ? "SMTP"
                            : t("email off", "邮件未启用")}
                        {e.error && ` · ${e.error}`}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="quant-model-empty">
            {t("No email has been recorded yet.", "尚无邮件记录。")}
          </p>
        ))}
      <p className="research-meta">
        {t(
          "Recipients are configured on the server and are never shown here.",
          "收件人在服务器端配置，此处从不显示。",
        )}
      </p>
    </section>
  );
}
