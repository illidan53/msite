import { StrictMode } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BacktestBookReport,
  BacktestReport,
  SignalRecord,
  StrategyState,
} from "../../../shared/strategy";
import { ruleCatalog } from "../../../shared/strategyRules";
import { LanguageSwitcher, LocaleProvider } from "../../shared/locale";
import {
  chartFixture,
  jobFixture,
  latestFixture,
  outboxFixture,
  paperFixture,
  reportFixtures,
  reportSummariesFixture,
  signalsFixture,
  stateFixture,
} from "./fixtures";
import { QuantSystem } from "./QuantSystem";
import { api } from "./strategyApi";

type Reply = unknown;
type Handler = (path: string, method: string, body: unknown) => Reply;
const error = (status: number, code = "") => ({ __status: status, code });
/** Like the route: newest first, `limit` (default 200) applied, `book` ignored. */
const signalPage = (path: string, log: SignalRecord[]) => {
  const query = path.match(/^\/api\/strategy\/signals(?:\?(.*))?$/);
  if (!query) return undefined;
  return log.slice(
    0,
    Number(new URLSearchParams(query[1]).get("limit") ?? 200),
  );
};
/** Default fixture-backed API; `override` answers first when it returns something. */
function routes(canRun = false, override?: Handler): Handler {
  return (path, method, body) => {
    const custom = override?.(path, method, body);
    if (custom !== undefined) return custom;
    if (path === "/api/research/access")
      return { canRun, clientIp: canRun ? "70.111.76.119" : "198.51.100.7" };
    if (path === "/api/strategy/state") return stateFixture;
    if (path === "/api/strategy/latest") return latestFixture;
    if (path === "/api/strategy/reports") return reportSummariesFixture;
    const report = path.match(/^\/api\/strategy\/reports\/(.+)$/);
    if (report)
      return (
        reportFixtures.find((r) => r.id === decodeURIComponent(report[1])) ??
        error(404)
      );
    const paper = path.match(/^\/api\/strategy\/paper\/(.+)$/);
    if (paper) return paperFixture(paper[1]);
    const signals = signalPage(path, signalsFixture);
    if (signals) return signals;
    if (path === "/api/strategy/outbox") return outboxFixture;
    const chart = path.match(/^\/api\/strategy\/charts\/([^/]+)\/(.+)$/);
    if (chart) return chartFixture(chart[1], decodeURIComponent(chart[2]));
    return error(404);
  };
}
function mockApi(handler: Handler) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const result = handler(url, init?.method ?? "GET", body);
    if (result && typeof result === "object" && "__status" in result) {
      const { __status, code } = result as { __status: number; code: string };
      return { ok: false, status: __status, json: async () => ({ code }) };
    }
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const calls = (
  fetcher: ReturnType<typeof mockApi>,
  path: string,
  method = "GET",
) =>
  fetcher.mock.calls.filter(
    ([url, init]) => url === path && (init?.method ?? "GET") === method,
  ).length;
const renderPage = (strict = false) => {
  const page = (
    <LocaleProvider>
      <LanguageSwitcher />
      <QuantSystem />
    </LocaleProvider>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
};

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map([["msite-language", "en"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows status, benchmark KPIs, equity curves, paper record and today's signals read-only", async () => {
  const fetcher = mockApi(routes(false));
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "System status" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/only the site owner may start runs/),
  ).toBeInTheDocument();
  for (const name of ["Run daily", "Run backtest", "Send test email"])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: /Stock book/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText(/Configured · Amazon SES/)).toBeInTheDocument();
  expect(screen.getByText(/data as of 2026-10-07/)).toBeInTheDocument();

  const sharpe = (await screen.findByText("Sharpe ratio")).parentElement!;
  expect(within(sharpe).getByText("0.92")).toBeInTheDocument();
  expect(sharpe).toHaveTextContent("Risk parity 1.06 · SPY 0.94");
  const cagr = screen.getByText("CAGR").parentElement!;
  expect(within(cagr).getByText("+14.8%")).toBeInTheDocument();
  expect(
    screen.getByRole("img", {
      name: "Stock book: equity indexed to 100 at the start",
    }),
  ).toBeInTheDocument();
  const legend = screen.getAllByRole("list", { name: "Legend" })[0];
  expect(
    within(legend)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
  ).toEqual([
    "Core (live system)",
    "Risk-parity buy & hold",
    "SPY buy & hold",
    "Equal-weight buy & hold",
  ]);

  expect(
    await screen.findByRole("heading", { name: "Paper record" }),
  ).toBeInTheDocument();
  expect(screen.getByText("+1.23%")).toBeInTheDocument();
  expect(
    await screen.findByRole("img", {
      name: "Paper record: equity indexed to 100 at the start",
    }),
  ).toBeInTheDocument();
  const today = screen.getByRole("table", { name: "Signals" });
  const nvda = within(today).getByRole("row", { name: /NVDA/ });
  expect(nvda).toHaveTextContent("Entry");
  expect(nvda).toHaveTextContent("+13.4528");
  expect(nvda).toHaveTextContent("0.00% → 2.51%");
  expect(within(today).getAllByRole("row")).toHaveLength(5);
  // Overview never loads the other tabs' data.
  expect(
    fetcher.mock.calls.some(([url]) => url.startsWith("/api/strategy/signals")),
  ).toBe(false);
  expect(calls(fetcher, "/api/strategy/paper/stocks")).toBe(1);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});

it("switches book and tabs in Chinese and remembers both", async () => {
  storage.set("msite-language", "zh");
  mockApi(routes(false));
  const user = userEvent.setup();
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "系统状态" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /板块 ETF 组合/ }));
  expect(storage.get("msite-strategy-book")).toBe("sectors");
  const today = await screen.findByRole("table", { name: "信号" });
  expect(within(today).getByRole("row", { name: /XLE/ })).toHaveTextContent(
    "建仓",
  );
  expect(
    await screen.findByRole("img", {
      name: "板块 ETF 组合：以起点为 100 的净值",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("核心系统与基准对比")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "持仓" }));
  expect(storage.get("msite-strategy-tab")).toBe("positions");
  expect(
    await screen.findByRole("heading", { name: "持仓与预测" }),
  ).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "持仓" });
  expect(within(table).getAllByRole("row")).toHaveLength(5);
  expect(screen.getByText(/触发：总敞口/)).toBeInTheDocument();
  cleanup();

  // A fresh visit opens the remembered book and tab.
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "持仓与预测" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "持仓" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: /板块 ETF 组合/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("lists latest orders with drivers, fill history and the email outbox", async () => {
  storage.set("msite-strategy-tab", "signals");
  const fetcher = mockApi(routes(false));
  renderPage();
  const orders = await screen.findByRole("table", { name: "Signals" });
  const nvda = within(orders).getByRole("row", { name: /NVDA/ });
  expect(nvda).toHaveTextContent("Breakout 80 +1.31");
  expect(nvda).toHaveTextContent("$2,535");
  // Class display names, not ids.
  expect(
    within(orders).getByRole("row", { name: /MSFT/ }),
  ).toHaveTextContent("MSFTMega-Cap Tech");
  expect(within(orders).getByRole("row", { name: /INTC/ })).toHaveTextContent(
    "Exit",
  );
  const history = await screen.findByRole("table", { name: "Signal history" });
  expect(within(history).getByRole("row", { name: /XOM/ })).toHaveTextContent(
    "Filled2026-10-07 @ $111.62",
  );
  expect(within(history).getByRole("row", { name: /SNDK/ })).toHaveTextContent(
    "Cancelled2026-10-06",
  );
  expect(within(history).getByRole("row", { name: /SNDK/ })).toHaveTextContent(
    "No longer eligible",
  );
  expect(within(history).getAllByRole("row", { name: /Pending/ })).toHaveLength(
    4,
  );
  // Sector signals stay with their own book.
  expect(within(history).queryByRole("row", { name: /XLE/ })).toBeNull();
  const outbox = await screen.findByRole("table", { name: "Email outbox" });
  expect(
    within(outbox).getByRole("row", { name: /\[量化信号\] 2026-10-07/ }),
  ).toHaveTextContent("Sent");
  expect(
    within(outbox).getByRole("row", { name: /\[测试\]/ }),
  ).toHaveTextContent("Logged only");
  expect(within(outbox).getByRole("row", { name: /失败/ })).toHaveTextContent(
    "MessageRejected",
  );
  expect(calls(fetcher, "/api/strategy/outbox")).toBe(1);
  expect(calls(fetcher, "/api/strategy/signals?book=stocks&limit=1000")).toBe(
    1,
  );
});

it("shows at most three drivers and class ids for records saved before the fixes", async () => {
  // Older daily runs stored every voting rule (17, zeros included) unsorted,
  // and snapshots without class names.
  const [nvda, ...rest] = latestFixture.books[0].signals;
  const drivers = ruleCatalog.map((rule, i) => ({
    rule: rule.id,
    contribution: [0.4, -2.1, 0, 1.7, 0.9, -1.8][i] ?? 0,
  }));
  const { classes: _names, ...legacy } = latestFixture.books[0];
  const latest = {
    ...latestFixture,
    books: [{ ...legacy, signals: [{ ...nvda, drivers }, ...rest] }],
  };
  storage.set("msite-strategy-tab", "signals");
  mockApi(
    routes(false, (path) =>
      path === "/api/strategy/latest" ? latest : undefined,
    ),
  );
  renderPage();
  const orders = await screen.findByRole("table", { name: "Signals" });
  const row = within(orders).getByRole("row", { name: /NVDA/ });
  expect(
    within(row)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
  ).toEqual(["EWMAC 16/64 -2.10", "Breakout 80 -1.80", "EWMAC 64/256 +1.70"]);
  expect(row).toHaveTextContent("NVDAsemiconductors");
});

it("keeps a quiet book's signal history when the busy book fills the log", async () => {
  const [stock] = signalsFixture;
  const sector = signalsFixture.find((s) => s.book === "sectors")!;
  const busy = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...stock,
      id: `stocks:busy:${i}`,
      symbol: `S${i}`,
    }));
  storage.set("msite-strategy-book", "sectors");
  storage.set("msite-strategy-tab", "signals");
  // Newest first: the stock book's daily trades sit ahead of older sector entries.
  const open = (log: SignalRecord[]) => {
    cleanup();
    const fetcher = mockApi(routes(false, (path) => signalPage(path, log)));
    renderPage();
    return fetcher;
  };

  const fetcher = open([...busy(250), sector]);
  const history = await screen.findByRole("table", { name: "Signal history" });
  expect(
    within(history).getByRole("row", { name: new RegExp(sector.symbol) }),
  ).toBeInTheDocument();
  expect(within(history).getAllByRole("row")).toHaveLength(2);
  expect(calls(fetcher, "/api/strategy/signals?book=sectors&limit=1000")).toBe(
    1,
  );
  expect(screen.queryByText(/Only the newest/)).not.toBeInTheDocument();

  // Past the route's 1000-record page the sector entry is out of reach: say so
  // instead of claiming the book has never traded.
  open([...busy(1000), sector]);
  expect(
    await screen.findByText(
      "No signals for this book among the newest 1,000 records.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("No signals recorded for this book yet."),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Only the newest 1,000 signal records are loaded/),
  ).toBeInTheDocument();
});

it("sorts and filters positions and drills into a symbol chart", async () => {
  storage.set("msite-strategy-tab", "positions");
  const fetcher = mockApi(routes(false));
  const user = userEvent.setup();
  renderPage();
  const table = await screen.findByRole("table", { name: "Positions" });
  const symbols = () =>
    within(table)
      .getAllByRole("button", { name: /^Show .+ chart$/ })
      .map((b) => b.textContent);
  // Largest target first; ties by symbol; missing targets last.
  expect(symbols()).toEqual([
    "MSFT",
    "COST",
    "NVDA",
    "XOM",
    "AMD",
    "INTC",
    "TECK",
    "CRWV",
  ]);
  await user.click(within(table).getByRole("button", { name: "Symbol" }));
  expect(symbols()).toEqual([
    "AMD",
    "COST",
    "CRWV",
    "INTC",
    "MSFT",
    "NVDA",
    "TECK",
    "XOM",
  ]);
  expect(
    within(table).getByRole("button", { name: "Symbol" }).closest("th"),
  ).toHaveAttribute("aria-sort", "ascending");
  await user.click(within(table).getByRole("button", { name: "Forecast" }));
  expect(symbols()[0]).toBe("NVDA");
  expect(
    within(within(table).getByRole("row", { name: /CRWV/ })).getByText(
      "Warming up",
    ),
  ).toBeInTheDocument();

  // Options show class names; their values stay the ids.
  const options = within(screen.getByLabelText("Class")).getAllByRole(
    "option",
  ) as HTMLOptionElement[];
  expect(options.map((o) => [o.value, o.textContent])).toEqual([
    ["all", "All classes"],
    ["consumer-staples", "Consumer Staples"],
    ["energy", "Energy"],
    ["mega-cap-tech", "Mega-Cap Tech"],
    ["semiconductors", "Semiconductors"],
  ]);
  expect(within(table).getByRole("row", { name: /MSFT/ })).toHaveTextContent(
    "MSFTMega-Cap Tech",
  );
  await user.selectOptions(screen.getByLabelText("Class"), "energy");
  expect(symbols()).toEqual(["XOM", "TECK"]);
  await user.selectOptions(screen.getByLabelText("Class"), "all");
  await user.selectOptions(screen.getByLabelText("Status"), "ineligible");
  expect(symbols()).toEqual(["CRWV"]);
  await user.selectOptions(screen.getByLabelText("Status"), "held");
  expect(symbols()).toHaveLength(5);
  await user.selectOptions(screen.getByLabelText("Status"), "all");

  expect(
    within(within(table).getByRole("row", { name: /NVDA/ })).getByRole("img"),
  ).toHaveAccessibleName(
    "Absolute trend +15.1 · Sector trend +12.4 · Relative momentum +9.8 · Trend-gated mean reversion +4.2",
  );
  await user.click(
    within(table).getByRole("button", { name: "Show NVDA chart" }),
  );
  expect(
    await screen.findByRole("img", {
      name: "NVDA · Quant System: close, combined forecast and target weight",
    }),
  ).toBeInTheDocument();
  expect(calls(fetcher, "/api/strategy/charts/stocks/NVDA")).toBe(1);
  expect(
    screen.getByRole("heading", { name: "NVDA" }).previousElementSibling,
  ).toHaveTextContent(/^Semiconductors$/);
  const rules = screen.getByRole("table", { name: "NVDA rule forecasts" });
  expect(within(rules).getAllByRole("row")).toHaveLength(
    ruleCatalog.length + 1,
  );
  // A row click works too, and cost-filtered rules are flagged.
  await user.click(
    within(within(table).getByRole("row", { name: /XOM/ })).getByText("Energy"),
  );
  expect(
    await screen.findByRole("img", { name: /^XOM · Quant System/ }),
  ).toBeInTheDocument();
  await user.click(
    within(table).getByRole("button", { name: "Show TECK chart" }),
  );
  const teck = await screen.findByRole("table", {
    name: "TECK rule forecasts",
  });
  expect(within(teck).getAllByText("Too costly · not voting")).toHaveLength(2);
});

it("shows the backtest report with tests, diagnostics and attribution in Chinese", async () => {
  storage.set("msite-language", "zh");
  storage.set("msite-strategy-tab", "backtest");
  const fetcher = mockApi(routes(false));
  const user = userEvent.setup();
  renderPage();
  const stats = await screen.findByRole("table", { name: "回测统计" });
  expect(within(stats).getAllByRole("row")).toHaveLength(13);
  const core = within(stats).getByRole("row", { name: /核心（实盘系统）/ });
  expect(core).toHaveTextContent("+14.8%");
  expect(core).toHaveTextContent("0.92 ± 0.66");
  expect(
    within(stats).getByRole("row", { name: /风险平价买入持有/ }),
  ).toHaveTextContent("基准");
  expect(screen.getByRole("table", { name: "年度收益" })).toBeInTheDocument();
  const families = screen.getByRole("table", { name: "规则族准入" });
  expect(
    within(families).getByRole("row", { name: /顺势均值回归/ }),
  ).toHaveTextContent("拖累");
  expect(
    within(families).getByRole("row", { name: /绝对趋势/ }),
  ).toHaveTextContent("有贡献");
  expect(screen.getByText("通缩夏普概率").parentElement).toHaveTextContent(
    "71.0%",
  );
  expect(screen.getByText("过拟合概率 PBO").parentElement).toHaveTextContent(
    "18.0%",
  );
  const rules = screen.getByRole("table", { name: "规则诊断" });
  expect(within(rules).getAllByRole("row")).toHaveLength(
    ruleCatalog.length + 1,
  );
  const mr20 = within(rules).getByRole("row", {
    name: /顺势均值回归（SMA20）/,
  });
  expect(mr20).toHaveTextContent("跨标的汇总");
  // Gated rules are flagged on their gate-open mean, not the zero-heavy one.
  const flagged = (row: HTMLElement) =>
    [...row.querySelectorAll(".strategy-negative")].map((e) => e.textContent);
  expect(flagged(mr20)).toEqual(["门控开启 13.6"]);
  expect(mr20).toHaveTextContent("3.6门控开启 13.6");
  const mr5 = within(rules).getByRole("row", { name: /顺势均值回归（com 5）/ });
  expect(mr5).toHaveTextContent("3.1门控开启 9.8");
  expect(flagged(mr5)).toEqual([]);
  expect(flagged(rules)).toEqual(["门控开启 13.6"]);
  expect(
    within(screen.getByRole("list", { name: "警示" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent),
  ).toEqual([
    "有规则的平均 |预测值| 超出 7–13 顺势均值回归（SMA20） 13.6（门控开启日）",
    "有规则族拖累表现 顺势均值回归",
    "部分标的数据加载失败 NVTS",
    "早期历史已在单日断点处截断 META",
    "存在超过 40% 的单日价格跳变 SMCI 2025-02-18 +41.6%",
  ]);
  expect(screen.getByRole("table", { name: "类别归因" })).toHaveTextContent(
    "Semiconductors",
  );
  expect(
    within(screen.getByRole("table", { name: "个股归因" })).getByRole("row", {
      name: /MSFT/,
    }),
  ).toHaveTextContent("MSFTMega-Cap Tech");
  // Trimmed symbols loaded and trade: they are not load failures.
  const fact = (term: string) => screen.getByText(term).nextElementSibling;
  expect(fact("加载失败")).toHaveTextContent(/^NVTS \(PROVIDER_404\)$/);
  expect(fact("早期历史已截断")).toHaveTextContent(
    /^META 2022-06-09 之前（单日 \+1,394\.7%）$/,
  );

  await user.selectOptions(screen.getByLabelText("对比变体"), "without_trend");
  expect(
    within(screen.getAllByRole("list", { name: "图例" })[0]).getByText(
      "剔除绝对趋势",
    ),
  ).toBeInTheDocument();
  const picker = screen.getByLabelText("报告");
  // Short labels led by the data cut-off fit a phone-width picker; the run
  // time of the selected report is spelled out beside it.
  expect(
    within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent),
  ).toEqual(["数据至 2026-10-02", "数据至 2026-09-25"]);
  expect(screen.getByText(/定时运行。/)).toHaveTextContent(
    /^2026年10月3日.*09:00 定时运行。/,
  );
  await user.selectOptions(picker, "bt-20260926");
  await waitFor(() =>
    expect(calls(fetcher, "/api/strategy/reports/bt-20260926")).toBe(1),
  );
  expect(
    await screen.findByText(/评估区间 .* – 2026-09-25/),
  ).toBeInTheDocument();
});

it("labels locale-neutral warning details in either language and reads older reports", async () => {
  const [current, older] = reportFixtures;
  const withBook = (
    report: BacktestReport,
    change: (book: BacktestBookReport) => BacktestBookReport,
  ) => ({ ...report, books: [change(report.books[0]), report.books[1]] });
  const latest = withBook(current, (book) => ({
    ...book,
    warnings: [
      { code: "forecast_scale", detail: "ewmac64 6.9, mr5 16.0" },
      { code: "cost_budget", detail: "0.42/0.92" },
      { code: "short_window", detail: "312" },
      { code: "history_trimmed", detail: "COHR, META" },
      {
        code: "price_jumps",
        detail: "LUNR 2023-02-16 +251.4%, COHR 2022-09-08 -83.8%, … +64",
      },
      { code: "family_detracts", detail: "mean_reversion, trend" },
    ],
  }));
  // Saved before the contract change: English details, trimmed symbols
  // reported as failures and no gate-open means.
  const legacy = withBook(older, (book) => {
    const { trimmed: _trimmed, ...quality } = book.dataQuality;
    return {
      ...book,
      rules: book.rules.map(({ gateOpenMeanAbsForecast: _gate, ...r }) =>
        r.id === "ewmac64" ? { ...r, meanAbsForecast: 6.9 } : r,
      ),
      warnings: [
        { code: "forecast_scale", detail: "mr20 16.0 (gate open)" },
        { code: "cost_budget", detail: "cost 0.42 SR vs Sharpe 0.92" },
        { code: "short_window", detail: "312 evaluation sessions" },
        {
          code: "price_jumps",
          detail: "LUNR 2023-02-16 251.4129%, … 74 in total",
        },
      ],
      dataQuality: {
        ...quality,
        failures: [
          ...quality.failures,
          {
            symbol: "COHR",
            message:
              "History before 2022-09-08 dropped (-83.7503% in one session)",
          },
        ],
      },
    } as BacktestBookReport;
  });
  // Two manual runs on the same data need their run times to tell apart.
  const [currentSummary, olderSummary] = reportSummariesFixture;
  const manual = (id: string, createdAt: string) => ({
    ...currentSummary,
    id,
    createdAt,
    trigger: "manual",
  });
  const summaries = [
    currentSummary,
    manual("bt-manual-1", "2026-10-02T22:00:00.000Z"),
    manual("bt-manual-2", "2026-10-02T23:30:00.000Z"),
    olderSummary,
  ];
  storage.set("msite-strategy-tab", "backtest");
  mockApi(
    routes(false, (path) =>
      path === "/api/strategy/reports"
        ? summaries
        : path === `/api/strategy/reports/${current.id}`
          ? latest
          : path === `/api/strategy/reports/${older.id}`
            ? legacy
            : undefined,
    ),
  );
  const user = userEvent.setup();
  renderPage();
  const warnings = async (name: string) =>
    within(await screen.findByRole("list", { name }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
  expect(
    within(await screen.findByLabelText("Report"))
      .getAllByRole("option")
      .map((o) => o.textContent),
  ).toEqual([
    "Data to 2026-10-02",
    "Data to 2026-10-02 · manual · Oct 2, 2026, 7:30 PM EDT",
    "Data to 2026-10-02 · manual · Oct 2, 2026, 6:00 PM EDT",
    "Data to 2026-09-25",
  ]);
  expect(screen.getByText(/^Scheduled run/)).toHaveTextContent(
    "Scheduled run Oct 3, 2026, 9:00 AM EDT. Price returns after costs.",
  );
  expect(await warnings("Warnings")).toEqual([
    "A rule's mean |forecast| is outside 7–13 EWMAC 64/256 6.9, Trend-gated reversion (com 5) 16.0 on gate-open sessions",
    "Costs exceed one-third of the core Sharpe ratio cost 0.42 SR vs Sharpe 0.92",
    "Evaluation window under two years 312 evaluation sessions",
    "Early history trimmed at a one-session break COHR, META",
    "Daily price jumps over 40% LUNR 2023-02-16 +251.4%, COHR 2022-09-08 -83.8%, … 64 more",
    "A rule family detracts Trend-gated mean reversion, Absolute trend",
  ]);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Language" }),
    "zh",
  );
  expect(await warnings("警示")).toEqual([
    "有规则的平均 |预测值| 超出 7–13 EWMAC 64/256 均线交叉 6.9、顺势均值回归（com 5） 16.0（门控开启日）",
    "成本超过核心夏普比率的三分之一 成本 0.42 SR，夏普 0.92",
    "评估窗口不足两年 评估期 312 个交易日",
    "早期历史已在单日断点处截断 COHR、META",
    "存在超过 40% 的单日价格跳变 LUNR 2023-02-16 +251.4%、COHR 2022-09-08 -83.8%、… 另有 64 处",
    "有规则族拖累表现 顺势均值回归、绝对趋势",
  ]);

  await user.selectOptions(screen.getByLabelText("报告"), older.id);
  expect(await screen.findByText(/评估区间 .* – 2026-09-25/)).toBeVisible();
  expect(await warnings("警示")).toEqual([
    "有规则的平均 |预测值| 超出 7–13 顺势均值回归（SMA20） 16.0（门控开启日）",
    "成本超过核心夏普比率的三分之一 成本 0.42 SR，夏普 0.92",
    "评估窗口不足两年 评估期 312 个交易日",
    "存在超过 40% 的单日价格跳变 LUNR 2023-02-16 +251.4%、… 共 74 处",
  ]);
  const fact = (term: string) => screen.getByText(term).nextElementSibling;
  expect(fact("加载失败")).toHaveTextContent(/^NVTS \(PROVIDER_404\)$/);
  expect(fact("早期历史已截断")).toHaveTextContent(
    /^COHR 2022-09-08 之前（单日 -83\.8%）$/,
  );
  // Without gate-open means, other rules are still checked on their mean,
  // and the gated ones are not flagged for their closed-gate zeros.
  const rules = screen.getByRole("table", { name: "规则诊断" });
  expect(
    [...rules.querySelectorAll(".strategy-negative")].map(
      (e) => e.closest("tr")?.querySelector("th")?.firstChild?.textContent,
    ),
  ).toEqual(["EWMAC 64/256 均线交叉"]);
  expect(
    within(rules).getByRole("row", { name: /顺势均值回归（SMA20）/ }),
  ).not.toHaveTextContent("门控开启");
});

it("explains every rule and the framework with the book source", async () => {
  storage.set("msite-strategy-tab", "rules");
  mockApi(routes(false));
  const user = userEvent.setup();
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "Trading rules" }),
  ).toBeInTheDocument();
  for (const rule of ruleCatalog)
    expect(
      screen.getByRole("heading", { name: rule.label.en }),
    ).toBeInTheDocument();
  expect(screen.getAllByText(/raw = /)).toHaveLength(ruleCatalog.length);
  // Every rule card names its AFTS source.
  expect(screen.getAllByText("AFTS Strategy 21")).toHaveLength(4);
  expect(screen.getByText(/ISBN 9780857199683/)).toHaveTextContent(
    "Advanced Futures Trading Strategies (Harriman House, 2023)",
  );
  expect(screen.getByText(/remain on Analytics → Models/)).toBeInTheDocument();
  const framework = screen.getByRole("heading", {
    name: "The framework",
  }).parentElement!;
  for (const title of [
    "Volatility",
    "Forecast scaling & caps",
    "Combination & FDM",
    "IDM & position sizing",
    "Buffering & execution",
    "Costs & speed limits",
    "Risk overlay",
    "Long-only floor",
    "Evaluation & tests",
    "Survivorship bias",
    "Price-only data",
  ])
    expect(within(framework).getByText(title)).toBeInTheDocument();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Language" }),
    "zh",
  );
  expect(
    await screen.findByRole("heading", { name: "交易规则" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "突破 80 日" }),
  ).toBeInTheDocument();
  expect(screen.getByText("幸存者偏差")).toBeInTheDocument();
}, 10000);

it("offers the first daily run on an empty system and explains rejected runs", async () => {
  const empty: StrategyState = {
    ...stateFixture,
    latest: null,
    latestReport: null,
    scheduler: {
      ...stateFixture.scheduler,
      enabled: false,
      lastDaily: null,
      lastBacktest: null,
      nextDaily: null,
      nextBacktest: null,
    },
    email: { configured: false, transport: "none", lastSent: null },
  };
  const responses = [429, 409, 403];
  const fetcher = mockApi(
    routes(true, (path, method) => {
      if (path === "/api/strategy/state") return empty;
      if (path === "/api/strategy/latest")
        return error(404, "STRATEGY_NOT_RUN");
      if (path === "/api/strategy/reports") return [];
      if (path === "/api/strategy/run" && method === "POST")
        return error(responses.shift() ?? 500);
      return undefined;
    }),
  );
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText("No daily run yet")).toBeInTheDocument();
  expect(screen.getByText("No backtest report yet")).toBeInTheDocument();
  expect(screen.getByText("Not configured")).toBeInTheDocument();
  expect(screen.getByText("Scheduler off on this server")).toBeInTheDocument();
  expect(screen.queryByText(/only the site owner/)).not.toBeInTheDocument();
  // Toolbar plus the empty-state shortcut.
  expect(screen.getAllByRole("button", { name: "Run daily" })).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "Run daily" })[1]);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Run limit reached (6 per hour, 24 per day)",
  );
  await user.click(screen.getAllByRole("button", { name: "Run backtest" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Another job is already running",
  );
  const [, run] = fetcher.mock.calls.at(-1)!;
  expect(run?.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(String(run?.body))).toEqual({ job: "backtest" });
  await user.click(screen.getAllByRole("button", { name: "Run daily" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "You are not authorized",
  );
  await user.click(screen.getByRole("tab", { name: "Positions" }));
  expect(await screen.findByText("No daily run yet")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Backtest" }));
  expect(await screen.findByText("No backtest report yet")).toBeInTheDocument();
  expect(calls(fetcher, "/api/strategy/latest")).toBe(1);
});

it("polls state while a job runs, stops when it finishes and reloads the data", async () => {
  let current: StrategyState = stateFixture;
  let polls = 0;
  const fetcher = mockApi(
    routes(true, (path, method) => {
      if (path === "/api/strategy/run" && method === "POST") {
        current = { ...stateFixture, job: jobFixture("backtest", 0) };
        return current;
      }
      if (path === "/api/strategy/state" && current.job) {
        polls++;
        if (polls >= 2) current = stateFixture;
        else current = { ...current, job: jobFixture("backtest", 120) };
        return current;
      }
      return undefined;
    }),
  );
  const user = userEvent.setup();
  renderPage(true);
  await screen.findByRole("table", { name: "Signals" });
  const latestBefore = calls(fetcher, "/api/strategy/latest");
  await user.click(screen.getByRole("button", { name: "Run backtest" }));
  expect(
    await screen.findByRole("button", { name: "Running…" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Run daily" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Send test email" }),
  ).toBeDisabled();
  expect(
    await screen.findByText(/Backtest · Fetching daily bars/),
  ).toBeInTheDocument();
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Run backtest" }),
      ).toBeEnabled(),
    { timeout: 6000 },
  );
  await waitFor(() =>
    expect(calls(fetcher, "/api/strategy/latest")).toBeGreaterThan(
      latestBefore,
    ),
  );
  const stateCalls = calls(fetcher, "/api/strategy/state");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  expect(calls(fetcher, "/api/strategy/state")).toBe(stateCalls);
  expect(calls(fetcher, "/api/strategy/run", "POST")).toBe(1);
  expect(polls).toBe(2);
}, 15000);

it("sends every POST as JSON, with an empty object when there is no body", async () => {
  const fetcher = mockApi(() => ({}));
  await api("/strategy/test-email", "POST");
  await api("/strategy/state");
  const [[, post], [, get]] = fetcher.mock.calls;
  expect(post).toMatchObject({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(get).not.toHaveProperty("body");
  expect(get).not.toHaveProperty("headers");
});

it("sends a test email and reports what happened", async () => {
  let sent = 0;
  const fetcher = mockApi(
    routes(true, (path, method) => {
      if (path === "/api/strategy/test-email" && method === "POST")
        return ++sent === 1
          ? {
              id: "mail-5",
              createdAt: "2026-10-08T16:00:00.000Z",
              kind: "test",
              subject: "[测试] msite signals",
              status: "disabled",
              transport: "none",
            }
          : error(429);
      return undefined;
    }),
  );
  storage.set("msite-strategy-tab", "signals");
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("table", { name: "Email outbox" });
  await user.click(screen.getByRole("button", { name: "Send test email" }));
  expect(
    await screen.findByText(/test message was logged to the outbox only/),
  ).toBeInTheDocument();
  await waitFor(() => expect(calls(fetcher, "/api/strategy/outbox")).toBe(2));
  // A JSON body forces a CORS preflight, so other sites cannot send this POST.
  const [, init] = fetcher.mock.calls.find(
    ([url]) => url === "/api/strategy/test-email",
  )!;
  expect(init).toMatchObject({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await user.click(screen.getByRole("button", { name: "Send test email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "one per 10 minutes",
  );
});

it("explains a daily run waiting for the pre-open run instead of showing its code", async () => {
  const waiting: StrategyState = {
    ...stateFixture,
    latest: null,
    scheduler: {
      ...stateFixture.scheduler,
      lastDaily: {
        at: "2026-10-09T02:51:59.177Z",
        trigger: "schedule",
        status: "skipped",
        asOf: "2026-10-07",
        message: "INCEPTION_WAITS_FOR_PRE_OPEN",
      },
    },
  };
  mockApi(
    routes(false, (path) =>
      path === "/api/strategy/state"
        ? waiting
        : path === "/api/strategy/latest"
          ? error(404)
          : undefined,
    ),
  );
  renderPage();
  expect(
    await screen.findByText(/paper trading starts at the next pre-open run/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/INCEPTION_WAITS_FOR_PRE_OPEN/)).toBeNull();
});
