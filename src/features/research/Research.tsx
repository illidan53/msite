import { useEffect, useRef, useState } from "react";
import { Play, RefreshCw, FileText, ExternalLink } from "lucide-react";
import type {
  ResearchReport,
  ResearchModule,
  ResearchMetric,
  ResearchSection,
} from "../../../shared/research";
import { useLocale } from "../../shared/locale";
import "./research.css";
import { DecisionSection } from "./DecisionSection";
import { MetricHistory } from "./MetricHistory";
import { MetricHelp } from "../../shared/MetricHelp";
import { metricAssessment, researchMetricGuide } from "./metricGuides";
type Summary = Pick<
  ResearchReport,
  "id" | "symbol" | "benchmark" | "createdAt" | "status" | "module"
>;
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/research${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "FORBIDDEN"
        : response.status === 429
          ? "LIMIT"
          : response.status === 404
            ? "NOT_FOUND"
            : "REQUEST_FAILED",
    );
  return response.json() as Promise<T>;
}
const labels = {
  quant: ["Quantitative analysis", "量化分析"],
  fundamentals: ["Fundamentals", "基本面"],
  news: ["News & catalysts", "新闻与催化因素"],
  ai: ["AI interpretation", "AI 综合解读"],
} as const;
const messages: Record<string, [string, string]> = {
  AI_NOT_CONFIGURED: [
    "AI interpretation will be available after the server model service is configured. Quantitative results and news are available independently.",
    "AI 解读将在服务器配置模型服务后启用。量化结果和新闻可独立使用。",
  ],
  AI_NO_EVIDENCE: [
    "Not enough source data for an AI report.",
    "暂无足够的来源数据供 AI 解读。",
  ],
  ETF_FEED_REQUIRED: [
    "ETF expense ratio, holdings, AUM and NAV require a separate data feed. These values are unavailable; company financial ratios are not applied to ETFs.",
    "ETF 费率、持仓、规模与净值需要额外数据源，当前暂无这些数据；不套用公司财务比率。",
  ],
  FINANCIALS_ENTITLEMENT: [
    "The current data subscription does not grant access to all financial statements or ratios. Available profile data is shown below.",
    "当前数据订阅未授权全部财报或财务比率，下方展示已获取的资料。",
  ],
  FINANCIALS_INCOMPLETE: [
    "Some financial data is unavailable. Missing values are not estimated.",
    "部分财务数据不可用，缺失值不做估算。",
  ],
  BENCHMARK_UNAVAILABLE: [
    "Benchmark history is unavailable; relative metrics are blank.",
    "基准历史不可用，相关指标留空。",
  ],
  NEWS_30D: [
    "Up to 20 most recent articles in the last 30 days. Provider updates may be hourly.",
    "最近 30 天内最多 20 条新闻，数据源可能按小时更新。",
  ],
  NO_NEWS_30D: [
    "No articles returned for the last 30 days.",
    "最近 30 天暂无返回的相关新闻。",
  ],
  INTERRUPTED: [
    "The server restarted during this run. Run again to retry.",
    "服务器在运行时重启，请重新 Run。",
  ],
  FETCH_FAILED: [
    "The data service could not be reached. Retry this module.",
    "暂时无法访问数据服务，请重试此模块。",
  ],
  STORAGE_ERROR: [
    "The report could not be saved. Retry later.",
    "报告保存失败，请稍后重试。",
  ],
  UNSUPPORTED_TYPE: [
    "The provider has not identified this instrument as a common stock or ETF. Financial ratios are unavailable.",
    "数据源未将此标的识别为普通股或 ETF，财务比率暂无数据。",
  ],
};
export function Research() {
  const { t, locale } = useLocale();
  const [selectedMetric, setSelectedMetric] = useState<ResearchMetric | null>(
    null,
  );
  const tr = (pair: readonly [string, string]) => t(pair[0], pair[1]);
  const [symbol, setSymbol] = useState("AAPL"),
    [benchmark, setBenchmark] = useState("SPY");
  const [report, setReport] = useState<ResearchReport | null>(null),
    [history, setHistory] = useState<Summary[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [access, setAccess] = useState<{
    canRun: boolean;
    clientIp: string | null;
  } | null>(null);
  const generation = useRef(0);
  const refreshHistory = () =>
    request<Summary[]>("")
      .then(setHistory)
      .catch(() => {});
  useEffect(() => {
    let active = true;
    void request<{ canRun: boolean; clientIp: string | null }>("/access")
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch(() => {
        if (active) setAccess({ canRun: false, clientIp: null });
      });
    void request<Summary[]>("")
      .then((v) => {
        if (active) setHistory(v);
      })
      .catch(() => {
        if (active) setError("HISTORY_FAILED");
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!report || report.status !== "running") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<ResearchReport>(`/${report.id}`);
        if (!active) return;
        setReport(next);
        setError("");
        if (next.status === "running") timer = setTimeout(poll, 1500);
        else void refreshHistory();
      } catch {
        if (active) {
          setError("POLL_FAILED");
          timer = setTimeout(poll, 4000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [report?.id, report?.status]);
  const running = busy || report?.status === "running";
  async function run(module: ResearchModule = "all") {
    if (!access?.canRun) {
      setError("FORBIDDEN");
      return;
    }
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await request<ResearchReport>("", {
        symbol: module === "all" ? symbol : report?.symbol,
        benchmark: module === "all" ? benchmark : report?.benchmark,
        locale,
        module,
        ...(module !== "all" ? { baseId: report?.id } : {}),
      });
      if (token === generation.current) {
        setReport(next);
        void refreshHistory();
      }
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function load(id: string) {
    if (!id) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await request<ResearchReport>(`/${id}`);
      if (token === generation.current) {
        setReport(next);
        setSymbol(next.symbol);
        setBenchmark(next.benchmark);
      }
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  function status(s: ResearchSection) {
    return tr(
      (
        {
          pending: ["Waiting", "等待中"],
          running: ["Running", "运行中"],
          complete: ["Ready", "已完成"],
          unavailable: ["Limited coverage", "数据未就绪"],
          failed: ["Failed", "失败"],
        } as const
      )[s.status],
    );
  }
  function message(s: ResearchSection) {
    if (!s.message) return "";
    if (messages[s.message]) return tr(messages[s.message]);
    if (s.message.startsWith("PROVIDER_"))
      return t(
        `Data provider returned ${s.message.slice(9)}. Check access or retry later.`,
        `数据服务返回 ${s.message.slice(9)}，请检查权限或稍后重试。`,
      );
    return s.message;
  }
  function sectionHeader(module: keyof typeof labels) {
    const s = report!.sections[module];
    return (
      <>
        <div className="research-section-heading">
          <div>
            <h3>{tr(labels[module])}</h3>
            <span className={`research-status ${s.status}`}>{status(s)}</span>
          </div>
          <button
            type="button"
            disabled={running || !access?.canRun}
            onClick={() => void run(module)}
            aria-label={t(
              `Refresh ${labels[module][0]}`,
              `刷新${labels[module][1]}`,
            )}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {t("Refresh", "刷新")}
          </button>
        </div>
        <p className="research-meta">
          {s.asOf && (
            <>
              {t("Data as of", "数据截至")} {formatDate(s.asOf, locale)} ·{" "}
            </>
          )}
          {s.fetchedAt && (
            <>
              {t("Fetched", "获取时间")} {formatDate(s.fetchedAt, locale)}
            </>
          )}
        </p>
        {s.message && <p className="research-notice">{message(s)}</p>}
      </>
    );
  }
  return (
    <section
      className="research-page"
      aria-label={t("Dig Deep research", "深度研究")}
    >
      {access && !access.canRun && (
        <p className="research-notice" role="status">
          {t(
            "Only authorized IP addresses may run or refresh research. Saved reports remain available.",
            "仅白名单 IP 可运行或刷新分析，仍可查看已有报告。",
          )}
          {access.clientIp && (
            <>
              {" "}
              {t("Your IP:", "当前 IP：")} {access.clientIp}
            </>
          )}
        </p>
      )}
      <form
        className="research-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label>
          {t("Symbol", "标的代码")}
          <input
            aria-label={t("Symbol", "标的代码")}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            pattern="[A-Za-z0-9.\-]+"
            maxLength={20}
            required
            disabled={running || !access?.canRun}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <label>
          {t("Benchmark", "对比基准")}
          <input
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
            pattern="[A-Za-z0-9.\-]+"
            maxLength={20}
            required
            disabled={running || !access?.canRun}
            spellCheck={false}
          />
        </label>
        <button
          className="research-run"
          type="submit"
          disabled={running || !access?.canRun}
        >
          <Play size={16} aria-hidden="true" />
          {running
            ? t("Running…", "运行中…")
            : t("Run analysis", "Run 完整分析")}
        </button>
        <label className="research-history">
          {t("Saved reports", "历史报告")}
          <select
            value={report?.id ?? ""}
            disabled={busy}
            onChange={(e) => void load(e.target.value)}
          >
            <option value="">{t("Select a report", "选择报告")}</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.symbol} / {h.benchmark} · {formatDate(h.createdAt, locale)} ·{" "}
                {tr(
                  (
                    {
                      running: ["Running", "运行中"],
                      complete: ["Complete", "完成"],
                      partial: ["Partial", "部分完成"],
                      failed: ["Failed", "失败"],
                    } as const
                  )[h.status],
                )}
              </option>
            ))}
          </select>
        </label>
      </form>
      {error && (
        <p role="alert" className="research-notice">
          {error === "FORBIDDEN"
            ? t(
                "Your IP is not authorized to run research.",
                "当前 IP 无权运行分析。",
              )
            : error === "LIMIT"
              ? t(
                  "Analysis capacity reached (2 simultaneous, 12/hour, 60/day). Please retry later.",
                  "达到分析运行上限（同时 2 个、每小时 12 次、每日 60 次），请稍后重试。",
                )
              : error === "POLL_FAILED"
                ? t(
                    "Connection interrupted. Reconnecting to the running report…",
                    "连接中断，正在重新连接运行中的报告…",
                  )
                : error === "HISTORY_FAILED"
                  ? t(
                      "Could not load report history. Reload the page to retry.",
                      "历史报告加载失败，请刷新页面重试。",
                    )
                  : t(
                      "The request failed. Please try again.",
                      "请求失败，请重试。",
                    )}
        </p>
      )}
      {!report ? (
        <div className="research-empty">
          <FileText size={32} aria-hidden="true" />
          <h3>
            {t(
              "One symbol. A complete research snapshot.",
              "一个标的，一份研究快照。",
            )}
          </h3>
          <p>
            {t(
              "Enter a US stock or ETF and run price, risk, trend, fundamentals and news analysis. Reports are saved with their data timestamps.",
              "输入美股或 ETF 代码，生成价格、风险、趋势、基本面与新闻分析，报告连同各项数据时间一起保存。",
            )}
          </p>
          <div className="research-preview">
            {Object.values(labels).map((l) => (
              <span key={l[0]}>{tr(l)}</span>
            ))}
          </div>
          <p>
            {t(
              "AI interpretation is enabled when a server model service is configured. Data coverage depends on the subscription.",
              "服务器配置模型服务后启用 AI 解读，数据覆盖取决于订阅权限。",
            )}
          </p>
        </div>
      ) : (
        <>
          <header className="research-report-heading">
            <div>
              <p className="eyebrow">
                {report.kind === "etf"
                  ? "ETF"
                  : report.kind === "stock"
                    ? t("STOCK", "股票")
                    : t("INSTRUMENT", "标的")}{" "}
                · {report.symbol} / {report.benchmark}
              </p>
              <h2>{report.name || report.symbol}</h2>
              <p className="research-meta">
                {t("Report created", "报告生成时间")}{" "}
                {formatDate(report.createdAt, locale)}
              </p>
            </div>
            <p role="status" aria-live="polite">
              {tr(
                (
                  {
                    running: ["Analysis in progress", "分析进行中"],
                    complete: ["Analysis complete", "分析完成"],
                    partial: [
                      "Available results ready · coverage is incomplete",
                      "可用结果已完成 · 部分数据未就绪",
                    ],
                    failed: [
                      "Analysis failed · retry available",
                      "分析失败 · 可重试",
                    ],
                  } as const
                )[report.status],
              )}
            </p>
          </header>
          <nav
            className="research-progress"
            aria-label={t("Analysis progress", "分析进度")}
          >
            <a href="#research-decision">
              <span>{t("Buy / sell reference", "买卖决策参考")}</span>
              <small>{t("Rule model", "规则模型")}</small>
            </a>
            {Object.entries(labels).map(([key, label]) => (
              <a key={key} href={`#research-${key}`}>
                <span>{tr(label)}</span>
                <small>
                  {status(report.sections[key as keyof typeof labels])}
                </small>
              </a>
            ))}
          </nav>
          <DecisionSection report={report} />
          <section id="research-quant" className="research-panel">
            {sectionHeader("quant")}
            <p className="research-metric-legend">
              {t(
                "Green: positive direction · Red: negative direction / high risk · Amber: review. Reference ranges, not trading signals. Tap ⓘ for guidance.",
                "绿：正向读数 · 红：负向读数 / 高风险 · 琥珀：需留意。区间仅供参考，不是买卖信号；点击 ⓘ 查看新手说明。",
              )}
            </p>
            <p className="research-meta">
              {t(
                "Split-adjusted daily prices, excluding dividends and the current trading day. Risk uses up to 252 sessions; drawdowns use available history (up to 5 years). All values describe historical observations.",
                "拆股调整日线，不含分红及当日未确认数据。风险指标使用最近最多 252 日；回撤使用可用历史（最多 5 年）。所有数值描述历史观测。",
              )}
            </p>
            {report.prices.length > 1 && <PricePlot prices={report.prices} />}
            {(["performance", "risk", "trend", "liquidity"] as const).map(
              (group) => (
                <MetricGroup
                  key={group}
                  onSelect={setSelectedMetric}
                  metrics={report.metrics.filter((m) => m.group === group)}
                  title={tr(
                    (
                      {
                        performance: [
                          "Returns & relative performance",
                          "收益与相对表现",
                        ],
                        risk: ["Risk & drawdown", "风险与回撤"],
                        trend: ["Trend & momentum", "趋势与动量"],
                        liquidity: ["Volume & liquidity", "成交量与流动性"],
                      } as const
                    )[group],
                  )}
                />
              ),
            )}
          </section>
          <div className="research-columns">
            <section id="research-fundamentals" className="research-panel">
              {sectionHeader("fundamentals")}
              <p className="research-metric-legend">
                {t(
                  "Green: positive direction · Red: negative direction / high risk · Amber: review. Reference ranges, not trading signals. Tap ⓘ for guidance.",
                  "绿：正向读数 · 红：负向读数 / 高风险 · 琥珀：需留意。区间仅供参考，不是买卖信号；点击 ⓘ 查看新手说明。",
                )}
              </p>
              {report.description && (
                <details>
                  <summary>
                    {t("Business / fund profile", "公司 / 基金简介")}
                  </summary>
                  <p>{report.description}</p>
                </details>
              )}
              {report.homepage && (
                <a href={report.homepage} target="_blank" rel="noreferrer">
                  {t("Official website", "官方网站")}{" "}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
              {report.financialPeriod && (
                <p className="research-meta">
                  {t("Fiscal period ended", "财报期间截至")}{" "}
                  {report.financialPeriod} · {t("Latest filing", "最近申报")}{" "}
                  {report.filingDate ?? "—"}
                </p>
              )}
              <MetricGroup
                onSelect={setSelectedMetric}
                metrics={report.metrics.filter(
                  (m) => m.group === "fundamentals",
                )}
              />
              <p className="research-meta">
                {t(
                  "Source: Polygon / Massive ticker reference and financials. Historical valuation percentiles, ROIC and cash-flow growth require additional datasets and are not calculated in this version.",
                  "来源：Polygon / Massive 标的资料与财务数据。历史估值分位、ROIC 和现金流增长需要额外数据，本版暂不计算。",
                )}
              </p>
            </section>
            <section id="research-ai" className="research-panel">
              {sectionHeader("ai")}
              {report.narrative && (
                <>
                  <p className="research-meta">
                    {report.model} ·{" "}
                    {t(
                      "Generated interpretation; verify against sources.",
                      "模型生成解读，请结合来源核实。",
                    )}
                  </p>
                  <div className="research-narrative">{report.narrative}</div>
                </>
              )}
            </section>
          </div>
          <section id="research-news" className="research-panel">
            {sectionHeader("news")}
            <ol className="research-news">
              {report.news.map((n, i) => (
                <li key={`${n.url}-${i}`}>
                  <p className="research-meta">
                    [{i + 1}] {n.publisher} ·{" "}
                    {formatDate(n.publishedAt, locale)}
                  </p>
                  <a href={n.url} target="_blank" rel="noreferrer">
                    {n.title}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  {n.description && <p>{n.description}</p>}
                </li>
              ))}
            </ol>
            <p className="research-meta">
              {t(
                "Source: Polygon / Massive news feed. Headlines may mention several companies; inclusion does not establish an effect on the price.",
                "来源：Polygon / Massive 新闻数据。新闻可能涉及多家公司，收录不代表已确认对价格的影响。",
              )}
            </p>
          </section>
        </>
      )}
      {selectedMetric && report && (
        <MetricHistory
          key={`${report.id}-${selectedMetric.id}`}
          metric={selectedMetric}
          report={report}
          canRun={Boolean(access?.canRun)}
          onClose={() => setSelectedMetric(null)}
          onLoaded={(next) =>
            setReport((current) => (current?.id === next.id ? next : current))
          }
        />
      )}
    </section>
  );
}
function MetricGroup({
  metrics,
  title,
  onSelect,
}: {
  metrics: ResearchMetric[];
  title?: string;
  onSelect: (metric: ResearchMetric) => void;
}) {
  const { locale, t } = useLocale();
  if (!metrics.length) return null;
  return (
    <div className="research-metric-group">
      {title && <h4>{title}</h4>}

      <dl className="research-metrics">
        {metrics.map((m) => (
          <div
            key={m.id}
            data-metric={m.id}
            className={`research-tone-${metricAssessment(m).tone}`}
          >
            <dt>
              <span>{m[locale]}</span>
              <MetricHelp metric={researchMetricGuide(m, locale)} />
            </dt>
            <dd>
              {m.value === null || !Number.isFinite(m.value) ? (
                <span className="research-unavailable">
                  {t("Unavailable", "暂无数据")}
                </span>
              ) : (
                new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
                  maximumFractionDigits: 2,
                  notation:
                    m.unit === "usd" && Math.abs(m.value) > 1e6
                      ? "compact"
                      : "standard",
                }).format(m.value) +
                (m.unit === "percent"
                  ? "%"
                  : m.unit === "usd"
                    ? " USD"
                    : m.unit === "days"
                      ? t(" sessions", " 日")
                      : "")
              )}
            </dd>
            <dd className="research-metric-reading">
              {metricAssessment(m).label[locale === "zh" ? 1 : 0]}
            </dd>
            <dd className="research-history-action">
              <button
                type="button"
                aria-label={t(`History of ${m.en}`, `${m.zh}的历史`)}
                aria-haspopup="dialog"
                onClick={() => onSelect(m)}
              >
                {t("View history", "查看历史")}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function PricePlot({ prices }: { prices: ResearchReport["prices"] }) {
  const { t } = useLocale();
  const lo = Math.min(...prices.map((p) => p.close)),
    hi = Math.max(...prices.map((p) => p.close));
  const points = prices
    .map(
      (p, i) =>
        `${12 + (i / (prices.length - 1)) * 776},${150 - ((p.close - lo) / (hi - lo || 1)) * 130}`,
    )
    .join(" ");
  return (
    <figure className="research-chart">
      <figcaption>
        {t(
          "Closing price · latest 252 sessions",
          "收盘价 · 最近最多 252 个交易日",
        )}
        <span>
          {prices[0].date} → {prices.at(-1)!.date}
        </span>
      </figcaption>
      <svg
        viewBox="0 0 800 170"
        role="img"
        aria-label={t(
          `Closing price from ${prices[0].close} to ${prices.at(-1)!.close} USD`,
          `收盘价从 ${prices[0].close} 至 ${prices.at(-1)!.close} 美元`,
        )}
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="research-meta">
        {t("Range", "区间")} {lo.toFixed(2)}–{hi.toFixed(2)} USD ·{" "}
        {t("Last close", "最新收盘")} {prices.at(-1)!.close.toFixed(2)} USD
      </div>
    </figure>
  );
}
function formatDate(value: string, locale: string) {
  if (value.length === 10) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : value;
}
