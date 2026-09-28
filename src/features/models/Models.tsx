import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import {
  MAX_BREAKDOWN_RATE,
  quantModelIds,
  type ModelChartSet,
  type ModelFitTier,
  type ModelScanState,
  type QuantModelId,
} from "../../../shared/research";
import { etfName } from "../analytics/catalog";
import { ModelChart } from "../research/ModelChart";
import { ModelConsideration } from "../research/ModelConsideration";
import { useModelFormat } from "../research/ModelTables";
import "../research/research.css";
import "./models.css";
import {
  breakdownRate,
  expectedByChance,
  rankRows,
  sortRows,
  tierOrder,
  type FitRow,
  type SortKey,
} from "./fitRanking";
import { modelMeta } from "./modelMeta";

async function api<T>(path: string, method: "GET" | "POST" = "GET") {
  const response = await fetch(`/api${path}`, { method, cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}
const storageKey = "msite-models-selected";
function savedModel(): QuantModelId {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (quantModelIds.includes(saved as QuantModelId))
      return saved as QuantModelId;
  } catch {
    /* Storage can be unavailable; default to the first model. */
  }
  return "ema200";
}
const pad = (n: number) => String(n).padStart(2, "0");

export function Models() {
  const { t, tr, locale, number, signed } = useModelFormat();
  const [access, setAccess] = useState<{
    canRun: boolean;
    clientIp: string | null;
  } | null>(null);
  const [state, setState] = useState<ModelScanState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [model, setModel] = useState<QuantModelId>(savedModel);
  const [list, setList] = useState("all");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<ModelFitTier | null>(null);
  const [signalOnly, setSignalOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "fit",
    desc: true,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [charts, setCharts] = useState<
    Record<string, ModelChartSet | "error">
  >({});
  const [chartRetry, setChartRetry] = useState(0);
  const requested = useRef(new Set<string>());
  const autoStarted = useRef(false);
  const chartRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void api<{ canRun: boolean; clientIp: string | null }>("/research/access")
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch(() => {
        if (active) setAccess({ canRun: false, clientIp: null });
      });
    void api<ModelScanState>("/models/scan")
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
        const next = await api<ModelScanState>("/models/scan");
        if (!active) return;
        setState(next);
        setLoadError(false);
        if (next.job) timer = setTimeout(poll, 1500);
      } catch {
        if (active) timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  async function start() {
    setStarting(true);
    setStartError("");
    try {
      setState(await api<ModelScanState>("/models/scan", "POST"));
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  // The first scan runs automatically for authorized visitors; later rescans are manual.
  useEffect(() => {
    if (
      !access?.canRun ||
      !state ||
      state.scan ||
      state.job ||
      state.lastFailure ||
      autoStarted.current
    )
      return;
    autoStarted.current = true;
    void start();
  }, [access, state]);
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, model);
    } catch {
      /* Optional persistence. */
    }
  }, [model]);

  const scan = state?.scan ?? null;
  const meta = modelMeta[model];
  const ranked = useMemo(
    () => (scan ? rankRows(scan, model) : []),
    [scan, model],
  );
  const best = ranked[0];
  const chartRow =
    (picked && ranked.find((r) => r.symbol === picked)) || best;
  const chartKey = scan && chartRow ? `${scan.id}:${chartRow.symbol}` : "";
  const chart = charts[chartKey];
  useEffect(() => {
    if (!chartKey || requested.current.has(chartKey)) return;
    requested.current.add(chartKey);
    const symbol = chartKey.slice(chartKey.indexOf(":") + 1);
    void api<ModelChartSet>(`/models/charts/${encodeURIComponent(symbol)}`)
      .then((value) => setCharts((c) => ({ ...c, [chartKey]: value })))
      .catch(() => {
        requested.current.delete(chartKey);
        setCharts((c) => ({ ...c, [chartKey]: "error" }));
      });
  }, [chartKey, chartRetry]);

  const listName = (id: string) =>
    t(scan?.lists.find((l) => l.id === id)?.name ?? id);
  const describe = (row: Pick<FitRow, "symbol" | "lists">) =>
    row.lists.includes("etf")
      ? etfName(row.symbol, locale)
      : row.lists.map(listName).join(" · ");
  const tierLabel = (id: ModelFitTier) =>
    ({
      high: t("High fit", "高拟合"),
      moderate: t("Moderate", "中等"),
      low: t("Low", "低"),
      contrary: t("Contrary", "反向"),
      insufficient: t("Insufficient", "样本不足"),
    })[id];
  const tierNote = (id: ModelFitTier) =>
    ({
      high: meta.touch
        ? t(
            `95% interval above zero, events gained on average, ≤ ${MAX_BREAKDOWN_RATE}% breakdowns`,
            `95% 区间高于 0，事件平均收益为正，破位失败 ≤ ${MAX_BREAKDOWN_RATE}%`,
          )
        : t(
            "95% interval above zero and events gained on average",
            "95% 区间高于 0，且事件平均收益为正",
          ),
      moderate: meta.touch
        ? t(
            `Significant but > ${MAX_BREAKDOWN_RATE}% breakdowns, or advantage ≥ 1 standard error`,
            `显著但破位失败 > ${MAX_BREAKDOWN_RATE}%，或优势 ≥ 1 个标准误`,
          )
        : t(
            "Advantage ≥ 1 standard error; not yet significant",
            "优势 ≥ 1 个标准误，尚不显著",
          ),
      low: t(
        "No clear advantage over background days",
        "相对背景交易日无明显优势",
      ),
      contrary: t(
        "Interval below zero: events underperformed",
        "区间低于 0：事件表现更弱",
      ),
      insufficient: t(
        "Under 12 mature events or 252 background days",
        "成熟事件不足 12 次或背景日不足 252 天",
      ),
    })[id];
  const inList = ranked.filter((r) => list === "all" || r.lists.includes(list));
  const counts = Object.fromEntries(
    tierOrder.map((id) => [id, inList.filter((r) => r.fit.tier === id).length]),
  ) as Record<ModelFitTier, number>;
  const testable = inList.length - counts.insufficient;
  const expected = expectedByChance(testable);
  const needle = query.trim().toUpperCase();
  const visible = sortRows(
    inList.filter(
      (r) =>
        (!tier || r.fit.tier === tier) &&
        (!signalOnly || r.fit.signal) &&
        (!needle || r.symbol.includes(needle)),
    ),
    sort.key,
    sort.desc,
  );
  const signals = inList.filter((r) => r.fit.signal);
  const horizon = best?.fit.primaryHorizon ?? 0;
  const filtered = tier || list !== "all" || needle || signalOnly;
  function show(symbol: string) {
    setPicked(symbol);
    chartRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  const reading = (row: FitRow) =>
    meta.reading.signed
      ? signed(row.fit.reading, meta.reading.unit)
      : number(row.fit.reading, meta.reading.unit, model === "rsi2" ? 1 : 2);
  const lastSignal = (row: FitRow) =>
    row.fit.signal ? (
      <span className="quant-signal">{t("Today", "今日")}</span>
    ) : row.fit.lastEvent ? (
      <>
        {row.fit.lastEvent}
        {row.fit.sessionsSince !== null && (
          <small>
            {t(
              `${row.fit.sessionsSince} sessions ago`,
              `${row.fit.sessionsSince} 个交易日前`,
            )}
          </small>
        )}
      </>
    ) : (
      "—"
    );
  const breakdowns = (row: FitRow) =>
    row.fit.breakdowns ? (
      <>
        <span
          className={
            (breakdownRate(row.fit) ?? 0) > MAX_BREAKDOWN_RATE
              ? "models-fragile"
              : undefined
          }
        >
          {number(breakdownRate(row.fit), "%", 0)}
        </span>
        <small>
          {row.fit.breakdowns.failed} / {row.fit.breakdowns.mature}
        </small>
      </>
    ) : (
      "—"
    );
  const interval = (row: FitRow) =>
    row.fit.interval
      ? `${number(row.fit.interval[0])} ~ ${number(row.fit.interval[1])}`
      : "—";
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (sort.desc ? "descending" : "ascending") : undefined
        }
      >
        <button
          type="button"
          className="models-sort"
          onClick={() =>
            setSort((s) => ({
              key,
              // Fewer breakdowns is better, so it starts ascending like symbols.
              desc:
                s.key === key
                  ? !s.desc
                  : key !== "symbol" && key !== "breakdownRate",
            }))
          }
        >
          {label}
          <Icon size={13} aria-hidden="true" />
        </button>
      </th>
    );
  };
  const job = state?.job;
  const running = starting || !!job;
  const errorText =
    startError === "403"
      ? t(
          "Your IP is not authorized to run model scans.",
          "当前 IP 无权运行模型扫描。",
        )
      : startError === "429"
        ? t(
            "Scan capacity reached (4 per hour, 12 per day). Please retry later.",
            "扫描次数已达上限（每小时 4 次、每日 12 次），请稍后重试。",
          )
        : startError
          ? t("The scan could not be started.", "扫描未能启动。")
          : "";

  return (
    <section
      className="research-page models-page"
      aria-label={t("Model fit workspace", "模型拟合工作区")}
    >
      {access && !access.canRun && (
        <p className="research-notice" role="status">
          {t(
            "Only authorized IP addresses may run a scan. The latest results remain available.",
            "仅白名单 IP 可运行扫描，仍可查看最近一次结果。",
          )}
          {access.clientIp && (
            <>
              {" "}
              {t("Your IP:", "当前 IP：")} {access.clientIp}
            </>
          )}
        </p>
      )}
      <div className="research-toolbar models-toolbar">
        <label className="models-picker">
          {t("Model", "模型")}
          <select
            aria-label={t("Model", "模型")}
            value={model}
            onChange={(e) => {
              setModel(e.target.value as QuantModelId);
              // Each model opens on its own best-fit example.
              setPicked(null);
            }}
          >
            {quantModelIds.map((id) => (
              <option key={id} value={id}>
                {pad(modelMeta[id].index)} · {tr(modelMeta[id].title)}
              </option>
            ))}
          </select>
        </label>
        <p className="models-scan-status">
          {scan ? (
            <>
              {t(
                `${scan.rows.length} symbols scanned`,
                `已扫描 ${scan.rows.length} 只标的`,
              )}
              {scan.failures.length > 0 &&
                t(
                  ` · ${scan.failures.length} unavailable`,
                  ` · ${scan.failures.length} 只不可用`,
                )}
              <br />
              {t("Daily data as of", "日线数据截至")} {scan.asOf} ·{" "}
              {t("scanned", "扫描于")}{" "}
              {new Date(scan.completedAt).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </>
          ) : (
            t("No scan results yet.", "暂无扫描结果。")
          )}
        </p>
        <button
          type="button"
          className="research-run"
          disabled={running || !access?.canRun}
          onClick={() => void start()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {running
            ? t("Scanning…", "扫描中…")
            : scan
              ? t("Rescan all symbols", "重新扫描全部标的")
              : t("Scan all symbols", "扫描全部标的")}
        </button>
      </div>
      {job && (
        <div className="models-progress" role="status">
          <span>
            {job.total
              ? t(
                  `Scanning ${job.done} / ${job.total} symbols with all four models…`,
                  `正在用四个模型扫描 ${job.done} / ${job.total} 只标的…`,
                )
              : t("Preparing the symbol list…", "正在准备标的列表…")}
            {scan &&
              t(
                " The previous results stay visible until it finishes.",
                " 完成前继续显示上一次结果。",
              )}
          </span>
          <progress
            value={job.done}
            max={job.total || 1}
            aria-label={t("Scan progress", "扫描进度")}
          />
        </div>
      )}
      {errorText && (
        <p role="alert" className="research-notice">
          {errorText}
        </p>
      )}
      {state?.lastFailure && !job && (
        <p role="alert" className="research-notice">
          {t(
            `The last scan failed (${state.lastFailure.message}).`,
            `上一次扫描失败（${state.lastFailure.message}）。`,
          )}{" "}
          {scan
            ? t("Earlier results are shown.", "下方为此前的结果。")
            : t(
                "Check the market data connection and retry.",
                "请检查行情数据连接后重试。",
              )}
        </p>
      )}
      {loadError && !state ? (
        <p role="alert" className="research-notice">
          {t(
            "Model results could not be loaded. Reload the page to retry.",
            "模型结果加载失败，请刷新页面重试。",
          )}
        </p>
      ) : !scan ? (
        <div className="research-empty">
          <ScanSearch size={32} aria-hidden="true" />
          <h3>
            {t(
              "Every model. Every symbol on this site.",
              "每个模型，覆盖本站每只标的。",
            )}
          </h3>
          <p>
            {!state
              ? t("Loading model results…", "正在加载模型结果…")
              : job
                ? t(
                    "The first scan is running. Results appear here when it finishes.",
                    "首次扫描正在运行，完成后结果会显示在这里。",
                  )
                : t(
                    "An authorized IP runs one scan of all watchlist symbols and sector ETFs; the results are saved for every visitor.",
                    "由白名单 IP 对全部自选列表标的与板块 ETF 运行一次扫描，结果保存后所有访客可见。",
                  )}
          </p>
        </div>
      ) : (
        <>
          <section
            className="research-panel research-my-quant models-overview"
            aria-labelledby="models-model-heading"
          >
            <p className="eyebrow">
              {t(
                `Model ${pad(meta.index)} · ${horizon}-session primary test`,
                `模型 ${pad(meta.index)} · ${horizon} 日主检验`,
              )}
            </p>
            <h3 id="models-model-heading">
              <ScanSearch size={22} aria-hidden="true" />
              {tr(meta.title)}
            </h3>
            <p className="quant-model-intro">{tr(meta.intro)}</p>
            <div
              className="models-tiers"
              role="group"
              aria-label={t("Filter the list by fit", "按拟合度筛选列表")}
            >
              {tierOrder.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`models-tier-tile ${id}`}
                  aria-pressed={tier === id}
                  onClick={() => setTier(tier === id ? null : id)}
                >
                  <strong>{counts[id]}</strong>
                  <span>{tierLabel(id)}</span>
                  <small>{tierNote(id)}</small>
                </button>
              ))}
            </div>
            <p className="research-meta">
              {t(
                `${testable} of ${inList.length} symbols have enough history to test. Even with no real effect, about ${number(expected, "", 1)} could reach High fit by chance at a 95% interval, so treat this list as a screen, not confirmation.`,
                `${inList.length} 只标的中有 ${testable} 只历史足够检验。即使模型完全无效，在 95% 区间下也约有 ${number(expected, "", 1)} 只会偶然显示为高拟合；请把列表当作筛选线索，而非确认。`,
              )}
            </p>
            {signals.length > 0 && (
              <div className="models-signals">
                <span>
                  {t("Signal on the latest session", "最新交易日触发")}
                </span>
                {signals.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => show(r.symbol)}
                  >
                    {r.symbol}
                    <span className={`models-tier ${r.fit.tier}`}>
                      {tierLabel(r.fit.tier)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {chartRow && (
            <section
              ref={chartRef}
              className="research-panel models-sample"
              aria-labelledby="models-sample-heading"
            >
              <div className="models-section-heading">
                <div>
                  <p className="eyebrow">
                    {chartRow.rank === 1 && chartRow.fit.tier === "insufficient"
                      ? t(
                          "Sample chart · no symbol has enough evidence yet",
                          "图线样例 · 暂无标的证据充足",
                        )
                      : chartRow.rank === 1
                        ? t(
                            "Sample chart · best fit for this model",
                            "图线样例 · 本模型拟合度最高",
                          )
                        : t(
                            `Sample chart · fit rank ${chartRow.rank} of ${ranked.length}`,
                            `图线样例 · 拟合排名 ${chartRow.rank} / ${ranked.length}`,
                          )}
                  </p>
                  <h3 id="models-sample-heading">
                    {chartRow.symbol}{" "}
                    <small className="models-sample-name">
                      {describe(chartRow)}
                    </small>
                  </h3>
                </div>
                <div className="models-sample-actions">
                  <span className={`models-tier ${chartRow.fit.tier}`}>
                    {tierLabel(chartRow.fit.tier)}
                  </span>
                  {chartRow.rank !== 1 && best && (
                    <button type="button" onClick={() => setPicked(null)}>
                      {t(
                        `Back to best fit (${best.symbol})`,
                        `回到最高拟合（${best.symbol}）`,
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="ema-stat-grid models-sample-stats">
                <div>
                  <span>{t("Fit score", "拟合分")}</span>
                  <strong>{signed(chartRow.fit.score)}</strong>
                  <small>
                    {t(
                      "Advantage in standard errors",
                      "优势相当于几个标准误",
                    )}
                  </small>
                </div>
                <div>
                  <span>
                    {t(
                      `${chartRow.fit.primaryHorizon}D advantage`,
                      `${chartRow.fit.primaryHorizon} 日收益优势`,
                    )}
                  </span>
                  <strong>{signed(chartRow.fit.lift, " pp")}</strong>
                  <small>
                    {t("95% interval", "95% 区间")} {interval(chartRow)}
                  </small>
                </div>
                <div>
                  <span>
                    {t("Mature events / background days", "成熟事件 / 背景日")}
                  </span>
                  <strong>
                    {chartRow.fit.events} / {chartRow.fit.controls}
                  </strong>
                  <small>
                    {t(
                      `Event mean ${signed(chartRow.fit.meanReturn, "%")} · win rate ${number(chartRow.fit.positiveRate, "%", 0)}`,
                      `事件均值 ${signed(chartRow.fit.meanReturn, "%")} · 上涨比例 ${number(chartRow.fit.positiveRate, "%", 0)}`,
                    )}
                  </small>
                </div>
                {meta.touch && (
                  <div>
                    <span>{t("Support breakdowns", "破位失败")}</span>
                    <strong
                      className={
                        (breakdownRate(chartRow.fit) ?? 0) > MAX_BREAKDOWN_RATE
                          ? "models-fragile"
                          : undefined
                      }
                    >
                      {number(breakdownRate(chartRow.fit), "%", 0)}
                    </strong>
                    <small>
                      {chartRow.fit.breakdowns &&
                        t(
                          `${chartRow.fit.breakdowns.failed} of ${chartRow.fit.breakdowns.mature} events closed below ${tr(meta.touch.lowerEdge)}, not back at ${meta.touch.line} within 20 sessions`,
                          `${chartRow.fit.breakdowns.mature} 次中 ${chartRow.fit.breakdowns.failed} 次收盘跌破${tr(meta.touch.lowerEdge)}，20 日内未收回 ${meta.touch.line}`,
                        )}
                    </small>
                  </div>
                )}
                <div>
                  <span>{t("Latest signal", "最近一次信号")}</span>
                  <strong className="ema-interval">
                    {lastSignal(chartRow)}
                  </strong>
                  <small>
                    {tr(meta.reading.label)} {reading(chartRow)}
                    {chartRow.fit.regime === false &&
                      t(" · trend filter off", " · 趋势过滤未满足")}
                  </small>
                </div>
              </div>
              {chart === undefined ? (
                <p className="quant-model-empty" role="status">
                  {t("Loading chart…", "正在加载图表…")}
                </p>
              ) : chart === "error" ? (
                <div className="quant-model-error">
                  <p role="alert">
                    {t("The chart could not be loaded.", "图表加载失败。")}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCharts((c) => {
                        const next = { ...c };
                        delete next[chartKey];
                        return next;
                      });
                      setChartRetry((n) => n + 1);
                    }}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    {t("Retry", "重试")}
                  </button>
                </div>
              ) : (
                <ModelChart
                  dates={chart.dates}
                  close={chart.close}
                  chart={chart.models[model]}
                  lines={meta.lines}
                  legend={tr(meta.legend)}
                  title={`${chartRow.symbol} · ${tr(meta.title)}`}
                />
              )}
              <p className="research-meta">
                {t(
                  "Select any symbol in the fit list to show its chart. Dots mark signals the model counted; a signal is a historical-study condition, not a buy recommendation.",
                  "在拟合列表中点击任意代码即可切换图表。圆点为模型计入的信号；信号只代表满足历史研究条件，不是买入建议。",
                )}
              </p>
            </section>
          )}

          <section
            className="research-panel models-fit"
            aria-labelledby="models-fit-heading"
          >
            <div className="models-section-heading">
              <div>
                <p className="eyebrow">
                  {t("Ranked from best to worst fit", "按拟合度从高到低排序")}
                </p>
                <h3 id="models-fit-heading">
                  {t("Fit across all site symbols", "全站标的拟合度")}
                </h3>
              </div>
              <span className="research-meta" role="status">
                {t(
                  `${visible.length} of ${ranked.length} shown`,
                  `显示 ${visible.length} / ${ranked.length} 只`,
                )}
              </span>
            </div>
            <div className="models-filters">
              <label>
                {t("List", "列表")}
                <select value={list} onChange={(e) => setList(e.target.value)}>
                  <option value="all">{t("All symbols", "全部标的")}</option>
                  {scan.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t(l.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Find symbol", "查找代码")}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={20}
                  spellCheck={false}
                  placeholder="NVDA"
                />
              </label>
              <label className="models-check">
                <input
                  type="checkbox"
                  checked={signalOnly}
                  onChange={(e) => setSignalOnly(e.target.checked)}
                />
                {t("Signal today only", "仅看今日触发")}
              </label>
              {filtered && (
                <button
                  type="button"
                  onClick={() => {
                    setTier(null);
                    setList("all");
                    setQuery("");
                    setSignalOnly(false);
                  }}
                >
                  {t("Clear filters", "清除筛选")}
                </button>
              )}
            </div>
            <p className="research-meta">
              {t(
                `Primary test: ${horizon}-session endpoint return after the next open, events versus same-regime background days; the advantage shows its 95% interval below. Rank 1 is the best fit.`,
                `主检验：次日开盘入场后 ${horizon} 日终点收益，事件对比同一市况下的背景交易日；优势下方为其 95% 区间。排名 1 为拟合度最高。`,
              )}
            </p>
            <div className="ema-table-wrap models-table-wrap" tabIndex={0}>
              <table
                aria-label={t(
                  `${tr(meta.title)} fit list`,
                  `${tr(meta.title)}拟合列表`,
                )}
              >
                <thead>
                  <tr>
                    {header("fit", "#")}
                    {header("symbol", t("Symbol", "代码"))}
                    <th scope="col">{t("Fit", "拟合度")}</th>
                    {header("score", t("Fit score", "拟合分"))}
                    {header(
                      "lift",
                      t(`${horizon}D advantage`, `${horizon} 日优势`),
                    )}
                    {header("events", t("Events", "事件数"))}
                    {header(
                      "meanReturn",
                      t(`${horizon}D mean`, `${horizon} 日均值`),
                    )}
                    {header("positiveRate", t("Win rate", "上涨比例"))}
                    {header("hitRate", t("Hit +5%", "达 +5%"))}
                    {meta.touch &&
                      header("breakdownRate", t("Breaks", "破位失败"))}
                    {header("reading", tr(meta.reading.label))}
                    {header("lastEvent", t("Last signal", "最近信号"))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.symbol}
                      className={
                        row.symbol === chartRow?.symbol
                          ? "is-selected"
                          : undefined
                      }
                    >
                      <td className="models-rank">{row.rank}</td>
                      <th scope="row">
                        <button
                          type="button"
                          className="models-symbol"
                          aria-pressed={row.symbol === chartRow?.symbol}
                          aria-label={t(
                            `Show ${row.symbol} chart`,
                            `查看 ${row.symbol} 图表`,
                          )}
                          onClick={() => show(row.symbol)}
                        >
                          {row.symbol}
                        </button>
                        <small>{describe(row)}</small>
                      </th>
                      <td>
                        <span className={`models-tier ${row.fit.tier}`}>
                          {tierLabel(row.fit.tier)}
                        </span>
                      </td>
                      <td>{signed(row.fit.score)}</td>
                      <td>
                        {signed(row.fit.lift, " pp")}
                        <small>{interval(row)}</small>
                      </td>
                      <td>{row.fit.events}</td>
                      <td>{signed(row.fit.meanReturn, "%")}</td>
                      <td>{number(row.fit.positiveRate, "%", 0)}</td>
                      <td>{number(row.fit.hitRate, "%", 0)}</td>
                      {meta.touch && <td>{breakdowns(row)}</td>}
                      <td>{reading(row)}</td>
                      <td>{lastSignal(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <p className="models-none">
                  {t(
                    "No symbols match these filters.",
                    "没有符合筛选条件的标的。",
                  )}
                </p>
              )}
            </div>
            <details className="models-method">
              <summary>{t("How fit is ranked", "拟合度如何计算")}</summary>
              <ul>
                <li>
                  {t(
                    "Each symbol runs the same pre-registered rules as My Quant in Dig Deep: completed, split-adjusted daily bars for up to five years; entry at the next open; events compared with same-regime background days.",
                    "每只标的都运行与深度研究中“我的量化”相同的预设规则：最多五年、已完成、拆股调整的日线；次日开盘入场；事件与同一市况下的背景交易日比较。",
                  )}
                </li>
                <li>
                  {t(
                    "Advantage = event mean − background mean of the primary-horizon endpoint return. The 95% interval comes from a 42-session block bootstrap.",
                    "优势 = 主检验窗口终点收益的事件均值 − 背景均值；95% 区间来自 42 日分块重采样。",
                  )}
                </li>
                <li>
                  {t(
                    "Fit score = advantage ÷ bootstrap standard error (interval width ÷ 3.92). About ±1.96 matches the interval edge.",
                    "拟合分 = 优势 ÷ 重采样标准误（区间宽度 ÷ 3.92）；约 ±1.96 对应区间边界。",
                  )}
                </li>
                {meta.touch && (
                  <li>
                    {t(
                      `Support breakdown (touch models): a close below ${tr(meta.touch.lowerEdge)} during the touch session or the next 20 that has not closed back at ${meta.touch.line} when that window ends. Returns still enter at the next open, so a gap through support can show a gain from the lower entry; the breakdown rate records that the line did not hold. High fit also requires at most ${MAX_BREAKDOWN_RATE}% breakdowns; otherwise a significant result is shown as Moderate. Red dots on the chart mark these events.`,
                      `破位失败（触碰类模型）：触碰当日至其后 20 日内收盘跌破${tr(meta.touch.lowerEdge)}，且到窗口结束仍未收盘收回 ${meta.touch.line}。收益仍按次日开盘入场计算，因此跳空击穿支撑后可能因入场价更低而显示为盈利；破位失败率记录的是“均线没有守住”。高拟合还要求破位失败率 ≤ ${MAX_BREAKDOWN_RATE}%，否则即使显著也只显示为“中等”。图中红点即为这类事件。`,
                    )}
                  </li>
                )}
                <li>
                  {t(
                    "Ranking: fit tier first, then fit score, then the number of mature events. Win rate is the share of events with a positive endpoint return; +5% hit rate counts events whose daily high reached entry × 1.05 within the window.",
                    "排序：先按拟合档位，再按拟合分，最后按成熟事件数。上涨比例 = 终点收益为正的事件占比；+5% 达成率 = 窗口内日内最高价达到入场价 ×1.05 的事件占比。",
                  )}
                </li>
                <li>
                  {t(
                    "Symbols are scanned independently and many move together, so several High results can share one market episode. Historical and descriptive; not investment advice.",
                    "各标的独立计算，但很多股票同涨同跌，多个高拟合结果可能来自同一段行情。结果为历史描述，不构成投资建议。",
                  )}
                </li>
              </ul>
            </details>
            {scan.failures.length > 0 && (
              <details className="models-method">
                <summary>
                  {t(
                    `${scan.failures.length} ${scan.failures.length === 1 ? "symbol" : "symbols"} could not be scanned`,
                    `${scan.failures.length} 只标的无法扫描`,
                  )}
                </summary>
                <p>
                  {scan.failures
                    .map((f) => `${f.symbol} (${f.message})`)
                    .join(" · ")}
                </p>
              </details>
            )}
          </section>

          <section
            className="research-panel models-rules"
            aria-labelledby="models-rules-heading"
          >
            <h3 id="models-rules-heading">
              {t("Rules & considerations", "规则与考量")}
            </h3>
            <ModelConsideration notes={meta.notes} />
          </section>
        </>
      )}
    </section>
  );
}
