import { describe, expect, it } from "vitest";
import {
  STRATEGY_ENGINE_VERSION,
  type BacktestBookReport,
  type BacktestReport,
  type BookSnapshot,
  type LatestSnapshot,
  type PerformanceStats,
  type Signal,
} from "../../shared/strategy";
import {
  escapeHtml,
  renderFailure,
  renderSignalDigest,
  renderTest,
  renderWeeklyReport,
} from "./emails";

const baseUrl = "https://finance.nphunter.net";

const signal = (symbol: string, extra: Partial<Signal> = {}): Signal => ({
  id: `stocks:2026-10-07:${symbol}`,
  book: "stocks",
  symbol,
  class: "chips",
  asOf: "2026-10-07",
  action: "entry",
  fromShares: 0,
  toShares: 12.34567,
  shares: 12.34567,
  price: 100,
  notional: 1234.567,
  fromWeight: 0,
  toWeight: 1.2346,
  forecast: 8.456,
  drivers: [
    { rule: "ewmac16", contribution: 3.21 },
    { rule: "relmom40", contribution: -1.04 },
  ],
  reason: "forecast",
  ...extra,
});

const book = (
  id: string,
  name: BookSnapshot["name"],
  signals: Signal[],
  hash = "abc123def456",
  classes: BookSnapshot["classes"] = [],
): BookSnapshot => ({
  book: id,
  name,
  classes,
  asOf: "2026-10-07",
  configHash: hash,
  idm: 2.1,
  fdm: 1.3,
  overlay: { multiplier: 1, limit: null },
  gross: 85,
  rows: [],
  signals,
  paper: {
    inception: "2026-09-01",
    lastSession: "2026-10-07",
    capital: 100000,
    equity: 101234.5,
    cash: 15000,
    dayReturn: 0.12,
    totalReturn: 1.2345,
    benchmarkReturn: -0.8,
    positions: 12,
    gross: 85.2,
  },
});

const snapshot: LatestSnapshot = {
  version: STRATEGY_ENGINE_VERSION,
  createdAt: "2026-10-08T11:05:00.000Z",
  asOf: "2026-10-07",
  trigger: "schedule",
  books: [
    book(
      "stocks",
      { en: "Stock book", zh: "个股组合" },
      [
        signal("NVDA"),
        signal("AMD", { action: "trim", shares: -2, toShares: 8, fromShares: 10, notional: 300 }),
        signal("<b>X&Y</b>", {
          class: "<script>alert(1)</script>",
          action: "exit",
          reason: "removed",
          forecast: null,
          drivers: [],
        }),
      ],
      "abc123def456",
      [{ id: "chips", name: "Semiconductors" }],
    ),
    book("sectors", { en: "Sector ETF book", zh: "板块 ETF 组合" }, [signal("XLK", { book: "sectors", class: "class" })]),
  ],
};

/** A busy first run: `count` orders, each with every rule as a driver. */
function busyBook(count: number) {
  const rules = [
    "ewmac8", "ewmac16", "ewmac32", "ewmac64", "breakout40", "breakout80", "breakout160",
    "breakout320", "accel32", "accel64", "assettrend16", "assettrend32", "assettrend64",
    "relmom40", "relmom80", "mr5", "mr20",
  ] as const;
  const actions = ["entry", "add", "trim", "exit"] as const;
  const signals = Array.from({ length: count }, (_, k) =>
    signal(`S${String(k).padStart(3, "0")}`, {
      class: "industrials-defense",
      action: actions[k % 4],
      shares: k % 4 < 2 ? 123.4567 : -123.4567,
      notional: 1000 + ((k * 37) % count) * 100,
      fromWeight: 0.4512,
      toWeight: 0.4823,
      drivers: rules.map((rule, r) => ({ rule, contribution: r < 15 ? (17 - r) / 10 : 0 })),
    }),
  );
  return book("stocks", { en: "Stock book", zh: "个股组合" }, signals, "abc123def456", [
    { id: "industrials-defense", name: "Industrials, Space & Defense" },
  ]);
}

describe("signal digest", () => {
  it("uses the spec subject in both locales", () => {
    expect(renderSignalDigest(snapshot, { locale: "zh", baseUrl }).subject).toBe(
      "[量化信号] 2026-10-07 · 个股组合 3 / 板块 ETF 组合 1",
    );
    expect(renderSignalDigest(snapshot, { locale: "en", baseUrl }).subject).toBe(
      "[Quant signals] 2026-10-07 · Stock book 3 / Sector ETF book 1",
    );
  });

  it("renders orders, the paper summary, disclaimers, the hash and the site link (zh)", () => {
    const { text, html } = renderSignalDigest(snapshot, { locale: "zh", baseUrl });
    for (const body of [text, html]) {
      expect(body).toContain("建仓");
      expect(body).toContain("减仓");
      expect(body).toContain("清仓 (已移出组合)");
      expect(body).toContain("+12.3457");
      expect(body).toContain("0.00% → 1.23%");
      expect(body).toContain("ewmac16 +3.2, relmom40 -1.0");
      expect(body).toContain("模拟盘");
      expect(body).toContain("+1.23%");
      expect(body).toContain("-0.80%");
      expect(body).toContain("不构成投资建议");
      expect(body).toContain("拆股调整");
      expect(body).toContain("配置哈希: abc123def456");
    }
    expect(text).toContain("https://finance.nphunter.net/");
    expect(html).toContain('href="https://finance.nphunter.net/"');
  });

  it("puts the disclaimer, hash and link above the order tables and in the footer", () => {
    const { html } = renderSignalDigest(snapshot, { locale: "zh", baseUrl });
    const firstTable = html.indexOf("<table");
    const lastTable = html.lastIndexOf("</table>");
    for (const needle of ["不构成投资建议", "配置哈希: abc123def456", 'href="https://finance.nphunter.net/"']) {
      expect(html.indexOf(needle)).toBeGreaterThan(-1);
      expect(html.indexOf(needle)).toBeLessThan(firstTable);
      expect(html.lastIndexOf(needle)).toBeGreaterThan(lastTable);
    }
  });

  it("heads every plain-text block with its columns", () => {
    const zh = renderSignalDigest(snapshot, { locale: "zh", baseUrl }).text.split("\n");
    const header = zh.indexOf("操作 | 代码 | 类别 | 股数 | 约合金额 | 权重 | 预测 | 主要驱动");
    expect(header).toBeGreaterThan(-1);
    expect(zh[header + 1]).toMatch(/^- 建仓 \| NVDA \| Semiconductors \|/);
    const en = renderSignalDigest(snapshot, { locale: "en", baseUrl }).text.split("\n");
    expect(en.filter((l) => l === "Action | Symbol | Class | Shares | ≈ Notional | Weight | Forecast | Drivers")).toHaveLength(2);
  });

  it("shows at most the three largest non-zero drivers", () => {
    const noisy: LatestSnapshot = {
      ...snapshot,
      books: [
        book("stocks", { en: "Stock book", zh: "个股组合" }, [
          signal("NVDA", {
            drivers: [
              { rule: "mr5", contribution: 0 },
              { rule: "ewmac8", contribution: 0.4 },
              { rule: "relmom40", contribution: -1.6 },
              { rule: "mr20", contribution: 0.02 },
              { rule: "ewmac16", contribution: 2.1 },
              { rule: "accel64", contribution: 0.9 },
            ],
          }),
        ]),
      ],
    };
    const { text, html } = renderSignalDigest(noisy, { locale: "en", baseUrl });
    for (const body of [text, html]) {
      expect(body).toContain("ewmac16 +2.1, relmom40 -1.6, accel64 +0.9");
      expect(body).not.toMatch(/ewmac8|mr5|mr20/);
    }
  });

  it("stays under Gmail's clipping size on a 100-order first run", () => {
    const busy: LatestSnapshot = {
      ...snapshot,
      books: [busyBook(100), snapshot.books[1]],
    };
    for (const locale of ["zh", "en"] as const) {
      const { text, html } = renderSignalDigest(busy, { locale, baseUrl });
      expect(Buffer.byteLength(html)).toBeLessThan(100_000);
      // The stock book lists 40 order rows plus its paper row; the sector book follows.
      const stockSection = html.slice(0, html.indexOf(locale === "zh" ? "板块 ETF 组合 ·" : "Sector ETF book ·"));
      expect(stockSection.match(/<tr valign="top"/g)).toHaveLength(40 + 1);
      expect(html).toContain("XLK");
      // S000 has the smallest notional.
      expect(text).not.toContain("S000");
      // Drivers stay at three even when a signal carries every rule.
      expect(html).toContain("ewmac8 +1.7, ewmac16 +1.6, ewmac32 +1.5<");
      expect(html).not.toContain("ewmac64 +1.4");
    }
    const { text } = renderSignalDigest(busy, { locale: "zh", baseUrl });
    expect(text).toContain("共 100 笔订单：建仓 25 · 加仓 25 · 减仓 25 · 清仓 25。");
    expect(text).toContain("下表列出金额最大的 40 笔，其余 60 笔请在量化系统页面查看。");
    expect(text).toContain("Industrials, Space & Defense");
    // The 40 largest by notional, largest first: $10,900 down to $7,000.
    const rows = text.split("\n").filter((l) => l.startsWith("- ") && l.includes("Industrials"));
    expect(rows).toHaveLength(40);
    expect(rows[0]).toContain("US$10,900");
    expect(rows[39]).toContain("US$7,000");
    const en = renderSignalDigest(busy, { locale: "en", baseUrl }).text;
    expect(en).toContain("100 orders: Entry 25 · Add 25 · Trim 25 · Exit 25.");
    expect(en).toContain("The 40 largest by notional are listed; 60 more are on the Quant System page.");
  });

  it("lists every order up to the cap without a summary", () => {
    const full: LatestSnapshot = { ...snapshot, books: [busyBook(40)] };
    const { text } = renderSignalDigest(full, { locale: "en", baseUrl });
    expect(text.split("\n").filter((l) => l.startsWith("- ") && l.includes("Industrials"))).toHaveLength(40);
    expect(text).not.toContain("orders:");
  });

  it("renders English copy with Intl numbers", () => {
    const { text, html } = renderSignalDigest(snapshot, { locale: "en", baseUrl: `${baseUrl}///` });
    expect(text).toContain("Entry | NVDA | Semiconductors | +12.3457 | $1,235 | 0.00% → 1.23% | 8.5 | ewmac16 +3.2, relmom40 -1.0");
    expect(text).toContain("Equity $101,235");
    const unnamed = { ...snapshot.books[0], classes: undefined } as unknown as BookSnapshot;
    expect(renderSignalDigest({ ...snapshot, books: [unnamed] }, { locale: "en", baseUrl }).text).toContain(
      "Entry | NVDA | chips |",
    );
    expect(html).toContain("not investment advice");
    expect(html).toContain("split-adjusted price returns");
    expect(html).toContain("Config hash: abc123def456");
    expect(html).toContain('href="https://finance.nphunter.net/"');
  });

  it("escapes every data value and uses inline-styled tables only", () => {
    const { html } = renderSignalDigest(snapshot, { locale: "en", baseUrl });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>X");
    expect(html).toContain("&lt;b&gt;X&amp;Y&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<style|class=/);
    expect(html).toMatch(/<table [^>]*style="/);
  });

  it("says when a book has no orders and lists every distinct hash", () => {
    const quiet: LatestSnapshot = {
      ...snapshot,
      books: [snapshot.books[0], { ...snapshot.books[1], signals: [], configHash: "fff000" }],
    };
    const { subject, text } = renderSignalDigest(quiet, { locale: "zh", baseUrl });
    expect(subject).toBe("[量化信号] 2026-10-07 · 个股组合 3 / 板块 ETF 组合 0");
    expect(text).toContain("本组合今日无订单。");
    expect(text).toContain("配置哈希: abc123def456, fff000");
  });

  it("never links anywhere but an http(s) site", () => {
    const { html } = renderSignalDigest(snapshot, { locale: "en", baseUrl: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://finance.nphunter.net/"');
  });
});

const stats = (sharpe: number | null, cagr: number | null): PerformanceStats => ({
  start: "2023-01-03",
  end: "2026-10-07",
  sessions: 950,
  totalReturn: 40,
  cagr,
  annualReturn: 12,
  annualVol: 18.5,
  sharpe,
  sharpeError: 0.5,
  sortino: 1,
  maxDrawdown: 22.4,
  averageDrawdown: 5,
  calmar: 0.5,
  monthlySkew: 0,
  lowerTail: 1,
  upperTail: 1,
  hitRate: 52,
  turnover: 10,
  annualCost: 0.4,
  costSharpe: 0.02,
  averageGross: 90,
  overlayBinding: 5,
  alpha: 1,
  beta: 0.8,
  correlation: 0.7,
  alphaSpy: 2,
  betaSpy: 0.9,
});

const reportBook = (id: string, name: BacktestBookReport["name"], sharpe: number): BacktestBookReport => ({
  book: id,
  name,
  riskTarget: 0.2,
  capital: 100000,
  universe: { symbols: 10, eligibleAtStart: 9, classes: [] },
  window: { dataStart: "2021-10-08", start: "2023-01-03", end: "2026-10-07", sessions: 950 },
  dates: [],
  runs: [
    { id: "core", kind: "variant", stats: stats(sharpe, 14.2), yearly: [], curve: [] },
    { id: "spy_buy_hold", kind: "benchmark", stats: stats(0.7, 11), yearly: [], curve: [] },
    { id: "risk_parity_buy_hold", kind: "benchmark", stats: stats(0.6, null), yearly: [], curve: [] },
  ],
  tests: {
    sharpeDifferences: [],
    families: [
      { family: "trend", difference: 0.12, interval: [0.01, 0.25], status: "adds" },
      { family: "mean_reversion", difference: -0.05, interval: null, status: "insufficient" },
    ],
    deflatedSharpe: { probability: 0.83, trials: 13, effectiveTrials: 6, benchmarkSharpe: 0.4 },
    overfitting: { probability: 0.21, splits: 252, variants: 9 },
  },
  rules: [],
  classes: [],
  symbols: [],
  idm: { last: 2, average: 2 },
  fdm: { last: 1.2, average: 1.2 },
  // Locale-neutral details, in the formats documented on BacktestWarning.
  warnings: [
    { code: "forecast_scale", detail: "ewmac64 6.9, mr20 16.0" },
    { code: "cost_budget", detail: "0.12/1.42" },
    { code: "short_window", detail: "312" },
    { code: "data_failures", detail: "ZZZ, QQQ" },
    { code: "history_trimmed", detail: "META 2022-06-09 +1394.7%, COHR 2022-09-08 -83.8%" },
    { code: "price_jumps", detail: "LUNR 2023-02-16 +251.4%, APLD 2022-07-19 +100.0%, … +64" },
    { code: "family_detracts", detail: "sector_trend, mean_reversion" },
  ],
  dataQuality: { failures: [], trimmed: [], jumps: [], shortHistory: [] },
});

const report: BacktestReport = {
  version: STRATEGY_ENGINE_VERSION,
  id: "r1",
  createdAt: "2026-10-10T13:00:00.000Z",
  completedAt: "2026-10-10T13:05:00.000Z",
  trigger: "schedule",
  asOf: "2026-10-09",
  configHash: "abc123def456",
  books: [
    reportBook("stocks", { en: "Stock book", zh: "个股组合" }, 0.853),
    { ...reportBook("sectors", { en: "Sector ETF book", zh: "板块 ETF 组合" }, 0.6), warnings: [] },
  ],
};

describe("weekly report", () => {
  it("summarises core against the benchmarks with admission and warnings (zh)", () => {
    const { subject, text, html } = renderWeeklyReport(report, { locale: "zh", baseUrl });
    expect(subject).toBe("[量化周报] 2026-10-09 · 个股组合 夏普 0.85 / 板块 ETF 组合 夏普 0.60");
    for (const body of [text, html]) {
      expect(body).toContain("核心系统");
      expect(body).toContain("风险平价买入持有");
      expect(body).toContain("14.2%");
      expect(body).toContain("22.4%");
      expect(body).toContain("绝对趋势");
      expect(body).toContain("增益");
      expect(body).toContain("样本不足");
      expect(body).toContain("紧缩夏普概率: 83%");
      expect(body).toContain("无警告。");
      expect(body).toContain("不构成投资建议");
      expect(body).toContain("配置哈希: abc123def456");
    }
    expect(text).toContain("[+0.01, +0.25]");
    expect(text).toContain("SPY 买入持有 | 0.70 | 11.0%");
    expect(text).not.toContain("等权买入持有");
  });

  it("heads the plain-text run and family rows with their columns", () => {
    const lines = renderWeeklyReport(report, { locale: "zh", baseUrl }).text.split("\n");
    const runs = lines.indexOf("方案 | 夏普 | 年化复合收益 | 最大回撤 | 波动率");
    expect(lines[runs + 1]).toBe("- 核心系统 | 0.85 | 14.2% | 22.4% | 18.5%");
    const families = lines.indexOf("规则族 | 夏普差 | 95% 区间 | 准入结论");
    expect(lines[families + 1]).toBe("- 绝对趋势 | +0.12 | [+0.01, +0.25] | 增益");
    const en = renderWeeklyReport(report, { locale: "en", baseUrl }).text.split("\n");
    expect(en.filter((l) => l === "Run | Sharpe | CAGR | Max drawdown | Vol")).toHaveLength(2);
    expect(en.filter((l) => l === "Family | ΔSharpe | 95% interval | Admission")).toHaveLength(2);
  });

  it("labels every warning in the email locale (zh)", () => {
    const { text, html } = renderWeeklyReport(report, { locale: "zh", baseUrl });
    const lines = [
      "平均 |预测值| 超出 7–13: ewmac64 6.9, mr20 16.0（mr20 按趋势门控开启的交易日计算）",
      "成本超过核心夏普的三分之一: 成本折合夏普 0.12，核心夏普 1.42",
      "评估区间不足两年: 312 个交易日",
      "数据加载失败的标的: ZZZ, QQQ",
      "早期历史已在异常价位截断: META 2022-06-09 +1,394.7%, COHR 2022-09-08 -83.8%",
      "单日价格变动超过 40%: LUNR 2023-02-16 +251.4%, APLD 2022-07-19 +100.0%, … 另有 64 项",
      "拖累表现的规则族: 板块趋势、顺势均值回归",
    ];
    for (const line of lines) {
      expect(text).toContain(`- ${line}`);
      expect(html).toContain(`<li>${escapeHtml(line)}</li>`);
    }
    for (const body of [text, html])
      expect(body).not.toMatch(/in total|gate open|sector_trend|mean_reversion|sessions|数据获取失败/);
  });

  it("renders English copy", () => {
    const { subject, text } = renderWeeklyReport(report, { locale: "en", baseUrl });
    expect(subject).toBe("[Quant weekly] 2026-10-09 · Stock book Sharpe 0.85 / Sector ETF book Sharpe 0.60");
    expect(text).toContain("Risk-parity buy & hold | 0.60 | — | 22.4% | 18.5%");
    for (const line of [
      "Mean |forecast| outside 7–13: ewmac64 6.9, mr20 16.0 (mr20 measured on sessions with the trend gate open)",
      "Costs above a third of the core Sharpe: cost 0.12 in Sharpe units vs core Sharpe 1.42",
      "Evaluation window under two years: 312 sessions",
      "Symbols that failed to load: ZZZ, QQQ",
      "Early history trimmed at a bad print: META 2022-06-09 +1,394.7%, COHR 2022-09-08 -83.8%",
      "One-session price moves over 40%: LUNR 2023-02-16 +251.4%, APLD 2022-07-19 +100.0%, … and 64 more",
      "Rule families that detract: Sector trend, Trend-gated mean reversion",
    ])
      expect(text).toContain(`- ${line}`);
    expect(text).toContain("not investment advice");
    expect(text).toContain("https://finance.nphunter.net/");
  });

  it("omits the gate note without a gated rule and shows unparsed details as sent", () => {
    const odd: BacktestReport = {
      ...report,
      books: [
        {
          ...report.books[0],
          warnings: [
            { code: "forecast_scale", detail: "ewmac64 6.9" },
            { code: "short_window", detail: "950 < 1000 <sessions>" },
            { code: "family_detracts", detail: "constructor" },
          ],
        },
      ],
    };
    const { text, html } = renderWeeklyReport(odd, { locale: "en", baseUrl });
    expect(text).toContain("- Mean |forecast| outside 7–13: ewmac64 6.9\n");
    expect(text).toContain("- Evaluation window under two years: 950 < 1000 <sessions>");
    expect(text).toContain("- Rule families that detract: constructor");
    expect(html).toContain("&lt;sessions&gt;");
  });
});

describe("failure and test messages", () => {
  it("states the job, message and next retry in New York time", () => {
    const zh = renderFailure(
      { job: "daily", message: "Polygon 503 <upstream>", nextRetry: "2026-10-08T11:30:00.000Z" },
      { locale: "zh", baseUrl, configHash: "abc123def456" },
    );
    expect(zh.subject).toBe("[量化系统] 每日信号失败");
    expect(zh.text).toContain("下次重试: 2026-10-08 07:30 (纽约时间)");
    expect(zh.text).toContain("配置哈希: abc123def456");
    expect(zh.html).toContain("Polygon 503 &lt;upstream&gt;");
    expect(zh.html).toContain("不构成投资建议");
    const en = renderFailure(
      { job: "backtest", message: "boom", nextRetry: null },
      { locale: "en", baseUrl },
    );
    expect(en.subject).toBe("[Quant system] Weekly backtest failed");
    expect(en.text).toContain("No more automatic retries today.");
    expect(en.text).toContain("split-adjusted");
  });

  it("confirms the transport in a test message", () => {
    const zh = renderTest({ locale: "zh", baseUrl, transport: "ses", configHash: "abc123def456" });
    expect(zh.subject).toBe("[量化系统] 测试邮件");
    expect(zh.text).toContain("传输方式：ses");
    expect(zh.html).toContain("配置哈希: abc123def456");
    const en = renderTest({ locale: "en", baseUrl, transport: "<smtp>" });
    expect(en.subject).toBe("[Quant system] Test email");
    expect(en.html).toContain("transport: &lt;smtp&gt;");
    expect(en.html).toContain("not investment advice");
  });

  it("escapes all HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
