import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Mail } from "lucide-react";
import type { OutboxEntry, StrategyState } from "../../../shared/strategy";
import "../research/research.css";
import "../models/models.css";
import "./strategy.css";
import { BacktestTab } from "./BacktestTab";
import { useStrategyFormat } from "./format";
import { OverviewTab } from "./OverviewTab";
import { RunButton, type JobKind, type RunControls, type TabId } from "./parts";
import { PositionsTab } from "./PositionsTab";
import { RulesTab } from "./RulesTab";
import { SignalsTab } from "./SignalsTab";
import {
  StrategyStoreContext,
  api,
  errorStatus,
  useStrategyStore,
} from "./strategyApi";
import { stepLabels } from "./strategyText";

const tabIds: TabId[] = [
  "overview",
  "signals",
  "positions",
  "backtest",
  "rules",
];
const tabKey = "msite-strategy-tab";
const bookKey = "msite-strategy-book";
function saved(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* Storage can be unavailable; fall back to defaults. */
    return null;
  }
}
function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Optional persistence. */
  }
}
type Action = JobKind | "email";

export function QuantSystem() {
  const { t, tr } = useStrategyFormat();
  const store = useStrategyStore();
  const [access, setAccess] = useState<{
    canRun: boolean;
    clientIp: string | null;
  } | null>(null);
  const [state, setState] = useState<StrategyState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabId>(() => {
    const value = saved(tabKey);
    return tabIds.includes(value as TabId) ? (value as TabId) : "overview";
  });
  const [savedBook, setSavedBook] = useState(() => saved(bookKey) ?? "");
  const [pending, setPending] = useState<Action | null>(null);
  const [failure, setFailure] = useState<{
    action: Action;
    status: number;
  } | null>(null);
  const [emailResult, setEmailResult] = useState<OutboxEntry | null>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const { refresh } = store;

  useEffect(() => {
    let active = true;
    void api<{ canRun: boolean; clientIp: string | null }>("/research/access")
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch(() => {
        if (active) setAccess({ canRun: false, clientIp: null });
      });
    void api<StrategyState>("/strategy/state")
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const jobId = state?.job?.id;
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<StrategyState>("/strategy/state");
        if (!active) return;
        setState(next);
        if (next.job) timer = setTimeout(poll, 1500);
        // The job finished: reload whatever the open tab shows.
        else refresh();
      } catch {
        if (active) timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId, refresh]);
  // Scheduled jobs start without this page's help: look for one every minute.
  useEffect(() => {
    if (jobId) return;
    const timer = setInterval(() => {
      api<StrategyState>("/strategy/state")
        .then((next) => {
          if (next.job) setState(next);
        })
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(timer);
  }, [jobId]);
  useEffect(() => save(tabKey, tab), [tab]);

  const books = state?.books ?? [];
  const book = books.find((b) => b.id === savedBook) ?? books[0] ?? null;
  const canRun = !!access?.canRun;
  const job = state?.job ?? null;
  const busy = !!job || pending !== null;

  async function run(kind: JobKind) {
    setPending(kind);
    setFailure(null);
    try {
      const next = await api<StrategyState>("/strategy/run", "POST", {
        job: kind,
      });
      setState(next);
      // A job that already finished never starts polling, so reload here.
      if (!next.job) refresh();
    } catch (error) {
      setFailure({ action: kind, status: errorStatus(error) });
    } finally {
      setPending(null);
    }
  }
  async function testEmail() {
    setPending("email");
    setFailure(null);
    setEmailResult(null);
    try {
      setEmailResult(
        await api<OutboxEntry>("/strategy/test-email", "POST", {}),
      );
      refresh();
      const next = await api<StrategyState>("/strategy/state").catch(
        () => null,
      );
      if (next) setState(next);
    } catch (error) {
      setFailure({ action: "email", status: errorStatus(error) });
    } finally {
      setPending(null);
    }
  }
  const controls: RunControls = {
    canRun,
    busy,
    running: job?.kind ?? (pending === "email" ? null : pending),
    run: (kind) => void run(kind),
  };
  const failureText = failure
    ? failure.status === 403
      ? t(
          "You are not authorized to run Quant System jobs.",
          "当前访客无权运行量化系统任务。",
        )
      : failure.status === 409
        ? t(
            "Another job is already running. Wait for it to finish.",
            "已有任务在运行，请等待其完成。",
          )
        : failure.status === 429
          ? failure.action === "email"
            ? t(
                "Test emails are limited to one per 10 minutes. Please retry later.",
                "测试邮件每 10 分钟最多 1 封，请稍后重试。",
              )
            : t(
                "Run limit reached (6 per hour, 24 per day). Please retry later.",
                "运行次数已达上限（每小时 6 次、每日 24 次），请稍后重试。",
              )
          : failure.action === "email"
            ? t("The test email could not be sent.", "测试邮件发送失败。")
            : t("The job could not be started.", "任务未能启动。")
    : "";
  const emailText = emailResult
    ? emailResult.status === "sent"
      ? t("Test email sent.", "测试邮件已发送。")
      : emailResult.status === "disabled"
        ? t(
            "Email is not configured on the server; the test message was logged to the outbox only.",
            "服务器未配置邮件，测试消息仅记录在发送记录中。",
          )
        : t(
            `The test email failed${emailResult.error ? `: ${emailResult.error}` : "."}`,
            `测试邮件发送失败${emailResult.error ? `：${emailResult.error}` : "。"}`,
          )
    : "";
  const tabLabels: Record<TabId, string> = {
    overview: t("Overview", "概览"),
    signals: t("Signals", "信号"),
    positions: t("Positions", "持仓"),
    backtest: t("Backtest", "回测"),
    rules: t("Rules", "规则"),
  };
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabIds.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? tabIds[(index + 1) % tabIds.length]
        : event.key === "ArrowLeft"
          ? tabIds[(index + tabIds.length - 1) % tabIds.length]
          : event.key === "Home"
            ? tabIds[0]
            : event.key === "End"
              ? tabIds[tabIds.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section
      className="research-page strategy-page"
      aria-label={t("Quant System workspace", "量化系统工作区")}
    >
      {access && !access.canRun && (
        <p className="research-notice" role="status">
          {t(
            "Signals, positions and reports are public; only the site owner may start runs.",
            "信号、持仓与报告公开可见；仅站长 可发起运行。",
          )}
        </p>
      )}
      <div className="research-toolbar strategy-toolbar">
        {books.length > 0 && book && (
          <div
            className="strategy-books"
            role="group"
            aria-label={t("Book", "组合")}
          >
            {books.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={b.id === book.id}
                onClick={() => {
                  setSavedBook(b.id);
                  save(bookKey, b.id);
                }}
              >
                {tr(b.name)}
                <small>
                  {t(
                    `${b.symbols} symbols · risk ${b.riskTarget}%`,
                    `${b.symbols} 只 · 风险 ${b.riskTarget}%`,
                  )}
                </small>
              </button>
            ))}
          </div>
        )}
        <p className="models-scan-status">
          {state?.latest
            ? t(
                `Signals as of ${state.latest.asOf} · ${state.latest.signals} orders across all books`,
                `信号截至 ${state.latest.asOf} · 所有组合共 ${state.latest.signals} 笔订单`,
              )
            : state
              ? t("No daily run yet.", "尚未运行每日信号。")
              : t("Loading status…", "正在加载状态…")}
          {state?.latestReport && (
            <>
              <br />
              {t(
                `Backtest data to ${state.latestReport.asOf}`,
                `回测数据截至 ${state.latestReport.asOf}`,
              )}
            </>
          )}
        </p>
        {canRun && state && (
          <div className="strategy-actions">
            <RunButton job="daily" controls={controls} />
            <RunButton job="backtest" controls={controls} />
            <button
              type="button"
              disabled={busy}
              onClick={() => void testEmail()}
            >
              <Mail size={16} aria-hidden="true" />
              {pending === "email"
                ? t("Sending…", "发送中…")
                : t("Send test email", "发送测试邮件")}
            </button>
          </div>
        )}
      </div>
      {job && (
        <div className="models-progress" role="status">
          <span>
            {job.kind === "daily"
              ? t("Daily signal run", "每日信号运行")
              : t("Backtest", "回测")}
            {" · "}
            {tr(stepLabels[job.step])}
            {job.total > 0 && ` ${job.done} / ${job.total}`}
            {t(
              " · results refresh when it finishes.",
              " · 完成后自动刷新结果。",
            )}
          </span>
          <progress
            value={job.done}
            max={job.total || 1}
            aria-label={t("Job progress", "任务进度")}
          />
        </div>
      )}
      {failureText && (
        <p role="alert" className="research-notice">
          {failureText}
        </p>
      )}
      {emailText && (
        <p role="status" className="research-notice">
          {emailText}
        </p>
      )}
      {loadError && !state ? (
        <p role="alert" className="research-notice">
          {t(
            "The Quant System status could not be loaded. Reload the page to retry.",
            "量化系统状态加载失败，请刷新页面重试。",
          )}
        </p>
      ) : !state || !book ? (
        <p className="quant-model-empty" role="status">
          {state
            ? t("No books are enabled.", "没有启用的组合。")
            : t("Loading the Quant System…", "正在加载量化系统…")}
        </p>
      ) : (
        <StrategyStoreContext.Provider value={store}>
          <div
            className="strategy-tabs"
            role="tablist"
            aria-label={t("Quant System sections", "量化系统栏目")}
          >
            {tabIds.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`strategy-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={tab === id ? `strategy-panel-${id}` : undefined}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={onTabKey}
              >
                {tabLabels[id]}
              </button>
            ))}
          </div>
          <div
            className="strategy-panel"
            role="tabpanel"
            id={`strategy-panel-${tab}`}
            aria-labelledby={`strategy-tab-${tab}`}
          >
            {tab === "overview" ? (
              <OverviewTab
                book={book.id}
                state={state}
                controls={controls}
                onOpen={setTab}
              />
            ) : tab === "signals" ? (
              <SignalsTab book={book.id} controls={controls} />
            ) : tab === "positions" ? (
              <PositionsTab book={book.id} controls={controls} />
            ) : tab === "backtest" ? (
              <BacktestTab book={book.id} state={state} controls={controls} />
            ) : (
              <RulesTab />
            )}
          </div>
        </StrategyStoreContext.Provider>
      )}
    </section>
  );
}
