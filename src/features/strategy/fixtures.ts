/**
 * Typed Quant System API fixtures shared by unit tests and Playwright mocks.
 * Values are deterministic and shaped like a real run (two books, all
 * variants and benchmarks), but they are illustrations, not results.
 */
import {
  STRATEGY_ENGINE_VERSION,
  benchmarkIds,
  ruleFamilies,
  variantIds,
  type BacktestBookReport,
  type BacktestReport,
  type BacktestReportSummary,
  type BacktestRun,
  type BookSnapshot,
  type LatestSnapshot,
  type OutboxEntry,
  type PaperLedger,
  type PerformanceStats,
  type RuleFamily,
  type RuleId,
  type RunId,
  type Signal,
  type SignalRecord,
  type StrategyJob,
  type StrategyState,
  type SymbolChart,
  type SymbolRow,
} from "../../../shared/strategy";
import { ruleCatalog } from "../../../shared/strategyRules";

const round = (v: number, digits = 2) =>
  Math.round(v * 10 ** digits) / 10 ** digits;
/** Weekday sessions ending at `end`, oldest first. */
export function fixtureSessions(end: string, count: number) {
  const out: string[] = [];
  const day = new Date(`${end}T12:00:00Z`);
  while (out.length < count) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6)
      out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return out.reverse();
}

export const fixtureAsOf = "2026-10-07";
const families = (
  trend: number | null,
  sector: number | null,
  relative: number | null,
  reversion: number | null,
): Record<RuleFamily, number | null> => ({
  trend,
  sector_trend: sector,
  relative_momentum: relative,
  mean_reversion: reversion,
});
const rulesFor = (seed: number): Partial<Record<RuleId, number | null>> =>
  Object.fromEntries(
    ruleCatalog.map((rule, i) => [
      rule.id,
      round(
        Math.max(-20, Math.min(20, 9 * Math.sin(seed + i * 0.7) + seed)),
        1,
      ),
    ]),
  );

function row(
  symbol: string,
  cls: string,
  close: number,
  sigma: number,
  forecast: number | null,
  fam: Record<RuleFamily, number | null>,
  averageWeight: number | null,
  held: { shares: number; weight: number },
  extra: Partial<SymbolRow> = {},
): SymbolRow {
  const target =
    forecast === null || averageWeight === null
      ? null
      : round((averageWeight * Math.max(0, forecast)) / 10, 2);
  return {
    symbol,
    class: cls,
    close,
    sigma,
    forecast,
    families: fam,
    rules: rulesFor(forecast ?? 0),
    costFiltered: [],
    fdm: forecast === null ? null : 1.38,
    instrumentWeight: averageWeight === null ? null : 0.46,
    averageWeight,
    targetWeight: target,
    heldShares: held.shares,
    heldWeight: held.weight,
    eligible: true,
    ...extra,
  };
}

const stockRows: SymbolRow[] = [
  row(
    "NVDA",
    "semiconductors",
    188.42,
    48.6,
    14.2,
    families(15.1, 12.4, 9.8, 4.2),
    1.86,
    { shares: 0, weight: 0 },
  ),
  row(
    "AMD",
    "semiconductors",
    161.3,
    52.1,
    3.1,
    families(4.8, 12.4, -6.2, 0),
    1.71,
    { shares: 15.7364, weight: 2.51 },
  ),
  row(
    "INTC",
    "semiconductors",
    21.08,
    44.9,
    -7.4,
    families(-9.9, 12.4, -11.3, 0),
    2.02,
    { shares: 52.1094, weight: 1.09 },
  ),
  row(
    "MSFT",
    "mega-cap-tech",
    512.7,
    24.3,
    11.8,
    families(13.2, 8.1, 6.4, 9.6),
    3.84,
    { shares: 6.8851, weight: 3.49 },
  ),
  row("XOM", "energy", 112.55, 23.8, 6.5, families(5.9, 7.2, 4.4, 0), 2.97, {
    shares: 17.6203,
    weight: 1.96,
  }),
  row(
    "TECK",
    "energy",
    38.9,
    41.2,
    -2.2,
    families(-3.4, 7.2, -5.1, 0),
    2.14,
    { shares: 0, weight: 0 },
    { costFiltered: ["ewmac8", "mr5"] },
  ),
  row(
    "COST",
    "consumer-staples",
    931.2,
    19.7,
    8.9,
    families(9.4, 2.2, 10.8, 6.1),
    4.11,
    { shares: 3.9011, weight: 3.59 },
  ),
  row(
    "CRWV",
    "semiconductors",
    121.4,
    96.5,
    null,
    families(null, null, null, null),
    null,
    { shares: 0, weight: 0 },
    { eligible: false, reason: "warmup", sigma: null },
  ),
];

const stockSignals: Signal[] = [
  {
    id: `stocks:${fixtureAsOf}:NVDA`,
    book: "stocks",
    symbol: "NVDA",
    class: "semiconductors",
    asOf: fixtureAsOf,
    action: "entry",
    fromShares: 0,
    toShares: 13.4528,
    shares: 13.4528,
    price: 188.42,
    notional: 2534.78,
    fromWeight: 0,
    toWeight: 2.51,
    forecast: 14.2,
    drivers: [
      { rule: "breakout80", contribution: 1.31 },
      { rule: "ewmac16", contribution: 1.12 },
      { rule: "relmom40", contribution: 0.98 },
    ],
    reason: "forecast",
  },
  {
    id: `stocks:${fixtureAsOf}:AMD`,
    book: "stocks",
    symbol: "AMD",
    class: "semiconductors",
    asOf: fixtureAsOf,
    action: "trim",
    fromShares: 15.7364,
    toShares: 4.1172,
    shares: -11.6192,
    price: 161.3,
    notional: 1874.18,
    fromWeight: 2.51,
    toWeight: 0.66,
    forecast: 3.1,
    drivers: [
      { rule: "relmom80", contribution: -0.86 },
      { rule: "assettrend32", contribution: 0.79 },
      { rule: "ewmac64", contribution: 0.41 },
    ],
    reason: "forecast",
  },
  {
    id: `stocks:${fixtureAsOf}:INTC`,
    book: "stocks",
    symbol: "INTC",
    class: "semiconductors",
    asOf: fixtureAsOf,
    action: "exit",
    fromShares: 52.1094,
    toShares: 0,
    shares: -52.1094,
    price: 21.08,
    notional: 1098.47,
    fromWeight: 1.09,
    toWeight: 0,
    forecast: -7.4,
    drivers: [
      { rule: "relmom40", contribution: -1.2 },
      { rule: "breakout160", contribution: -0.71 },
      { rule: "ewmac32", contribution: -0.62 },
    ],
    reason: "forecast",
  },
  {
    id: `stocks:${fixtureAsOf}:MSFT`,
    book: "stocks",
    symbol: "MSFT",
    class: "mega-cap-tech",
    asOf: fixtureAsOf,
    action: "add",
    fromShares: 6.8851,
    toShares: 8.5823,
    shares: 1.6972,
    price: 512.7,
    notional: 870.15,
    fromWeight: 3.49,
    toWeight: 4.35,
    forecast: 11.8,
    drivers: [
      { rule: "mr5", contribution: 0.95 },
      { rule: "ewmac16", contribution: 0.88 },
      { rule: "assettrend16", contribution: 0.7 },
    ],
    reason: "forecast",
  },
];
const sectorSignals: Signal[] = [
  {
    id: `sectors:${fixtureAsOf}:XLE`,
    book: "sectors",
    symbol: "XLE",
    class: "SPDR sectors",
    asOf: fixtureAsOf,
    action: "entry",
    fromShares: 0,
    toShares: 98.1245,
    shares: 98.1245,
    price: 91.7,
    notional: 8998.02,
    fromWeight: 0,
    toWeight: 8.92,
    forecast: 9.4,
    drivers: [
      { rule: "ewmac32", contribution: 0.92 },
      { rule: "breakout40", contribution: 0.84 },
      { rule: "accel32", contribution: 0.31 },
    ],
    reason: "forecast",
  },
];
const sectorRows: SymbolRow[] = [
  row(
    "XLK",
    "SPDR sectors",
    271.4,
    22.4,
    12.6,
    families(13.4, 12.6, 0, 7.2),
    9.8,
    { shares: 44.1876, weight: 11.9 },
  ),
  row(
    "XLE",
    "SPDR sectors",
    91.7,
    21.1,
    9.4,
    families(10.1, 9.4, 0, 3.3),
    9.49,
    { shares: 0, weight: 0 },
  ),
  row("XLU", "SPDR sectors", 84.25, 16.2, 4.1, families(4.6, 4.1, 0, 0), 11.6, {
    shares: 56.4031,
    weight: 4.72,
  }),
  row(
    "XLP",
    "SPDR sectors",
    79.6,
    13.9,
    -3.8,
    families(-4.2, -3.8, 0, 0),
    12.4,
    { shares: 0, weight: 0 },
  ),
];

function snapshot(
  book: string,
  name: BookSnapshot["name"],
  rows: SymbolRow[],
  signals: Signal[],
  gross: number,
  overlay: BookSnapshot["overlay"],
): BookSnapshot {
  return {
    book,
    name,
    asOf: fixtureAsOf,
    configHash: "c9f2a41d",
    idm: book === "stocks" ? 2.31 : 1.62,
    fdm: 1.38,
    overlay,
    gross,
    rows,
    signals,
    paper: {
      inception: "2026-09-14",
      lastSession: fixtureAsOf,
      capital: 100000,
      equity: book === "stocks" ? 101234.56 : 99512.4,
      cash: book === "stocks" ? 14210.52 : 37950.1,
      dayReturn: book === "stocks" ? 0.42 : -0.18,
      totalReturn: book === "stocks" ? 1.23 : -0.49,
      benchmarkReturn: 0.87,
      positions: book === "stocks" ? 38 : 6,
      gross,
    },
  };
}

export const latestFixture: LatestSnapshot = {
  version: STRATEGY_ENGINE_VERSION,
  createdAt: "2026-10-08T11:02:14.000Z",
  asOf: fixtureAsOf,
  trigger: "schedule",
  books: [
    snapshot(
      "stocks",
      { en: "Stock book", zh: "个股组合" },
      stockRows,
      stockSignals,
      85.8,
      { multiplier: 1, limit: null },
    ),
    snapshot(
      "sectors",
      { en: "Sector ETF book", zh: "板块 ETF 组合" },
      sectorRows,
      sectorSignals,
      62.1,
      { multiplier: 0.94, limit: "gross" },
    ),
  ],
};

const statsBase: PerformanceStats = {
  start: "2024-11-05",
  end: "2026-10-02",
  sessions: 480,
  totalReturn: null,
  cagr: null,
  annualReturn: null,
  annualVol: null,
  sharpe: null,
  sharpeError: null,
  sortino: null,
  maxDrawdown: null,
  averageDrawdown: null,
  calmar: null,
  monthlySkew: null,
  lowerTail: null,
  upperTail: null,
  hitRate: null,
  turnover: null,
  annualCost: null,
  costSharpe: null,
  averageGross: null,
  overlayBinding: null,
  alpha: null,
  beta: null,
  correlation: null,
  alphaSpy: null,
  betaSpy: null,
};
/** [cagr, vol, sharpe, maxDrawdown, turnover, annualCost, averageGross] */
type Shape = [
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
];
const stockShapes: Record<RunId, Shape> = {
  core: [14.8, 16.4, 0.92, 13.2, 9.6, 0.31, 84.2],
  long_short: [9.1, 17.8, 0.58, 17.9, 14.1, 0.52, 112.4],
  trend_filter: [12.2, 17.2, 0.76, 15.4, 4.3, 0.12, 88.1],
  vol_attenuation: [15.3, 16.1, 0.96, 12.6, 10.2, 0.33, 82.7],
  whole_shares: [14.1, 16.6, 0.88, 13.5, 9.9, 0.34, 83.6],
  without_trend: [8.7, 15.9, 0.6, 16.8, 7.7, 0.25, 81.5],
  without_sector_trend: [14.2, 16.8, 0.88, 13.9, 9.1, 0.3, 84.9],
  without_relative_momentum: [13.7, 16.2, 0.87, 12.9, 8.8, 0.28, 83.1],
  without_mean_reversion: [15.1, 16.6, 0.93, 13.1, 7.2, 0.24, 85.3],
  spy_buy_hold: [15.9, 17.1, 0.94, 18.8, 0, 0, 100],
  equal_weight_buy_hold: [31.4, 24.2, 1.24, 22.6, 1.4, 0.04, 100],
  risk_parity_buy_hold: [18.2, 16.9, 1.06, 15.1, 2.2, 0.06, 88.4],
};
const sectorShapes: Record<RunId, Shape> = Object.fromEntries(
  Object.entries(stockShapes).map(([id, s]) => [
    id,
    id === "spy_buy_hold"
      ? s
      : [
          round(s[0] * 0.62),
          round(s[1] * 0.78),
          round(s[2] * 0.85),
          round(s[3] * 0.9),
          s[4],
          s[5],
          s[6],
        ],
  ]),
) as Record<RunId, Shape>;

function run(
  id: RunId,
  shape: Shape,
  dates: string[],
  phase: number,
): BacktestRun {
  const [cagr, vol, sharpe, maxDrawdown, turnover, annualCost, averageGross] =
    shape;
  const drift = Math.log(1 + cagr / 100) / 256;
  const wobble = vol / 400;
  const curve = dates.map((_, t) =>
    round(
      100 *
        Math.exp(
          drift * t +
            wobble * (Math.sin(t / 23 + phase) - Math.sin(phase)) +
            (wobble / 2) * (Math.sin(t / 7 + phase * 2) - Math.sin(phase * 2)),
        ),
    ),
  );
  const yearly: BacktestRun["yearly"] = [];
  let base = 100;
  dates.forEach((date, t) => {
    const year = Number(date.slice(0, 4));
    const last =
      t === dates.length - 1 || dates[t + 1].slice(0, 4) !== date.slice(0, 4);
    if (!last) return;
    yearly.push({ year, return: round((curve[t] / base - 1) * 100) });
    base = curve[t];
  });
  const benchmark = (benchmarkIds as RunId[]).includes(id);
  return {
    id,
    kind: benchmark ? "benchmark" : "variant",
    curve,
    yearly,
    stats: {
      ...statsBase,
      start: dates[0],
      end: dates.at(-1)!,
      sessions: dates.length,
      totalReturn: round((curve.at(-1)! / 100 - 1) * 100),
      cagr,
      annualReturn: round(sharpe * vol),
      annualVol: vol,
      sharpe,
      sharpeError: 0.66,
      sortino: round(sharpe * 1.38),
      maxDrawdown,
      averageDrawdown: round(maxDrawdown / 4.2),
      calmar: round(cagr / maxDrawdown),
      monthlySkew: round(0.3 - sharpe / 5),
      lowerTail: 1.21,
      upperTail: 1.08,
      hitRate: round(51 + sharpe * 2, 1),
      turnover,
      annualCost,
      costSharpe: annualCost === null ? null : round(annualCost / vol, 3),
      averageGross,
      overlayBinding: benchmark && id !== "risk_parity_buy_hold" ? null : 3.4,
      alpha: id === "risk_parity_buy_hold" ? 0 : round((sharpe - 1.06) * 6),
      beta: id === "risk_parity_buy_hold" ? 1 : 0.71,
      correlation: id === "risk_parity_buy_hold" ? 1 : 0.78,
      alphaSpy: id === "spy_buy_hold" ? 0 : round((sharpe - 0.94) * 7),
      betaSpy: id === "spy_buy_hold" ? 1 : 0.64,
    },
  };
}

function bookReport(
  book: "stocks" | "sectors",
  dates: string[],
  shift: number,
): BacktestBookReport {
  const shapes = book === "stocks" ? stockShapes : sectorShapes;
  const ids: RunId[] = [...variantIds, ...benchmarkIds];
  const stocks = book === "stocks";
  return {
    book,
    name: stocks
      ? { en: "Stock book", zh: "个股组合" }
      : { en: "Sector ETF book", zh: "板块 ETF 组合" },
    riskTarget: stocks ? 20 : 15,
    capital: 100000,
    universe: {
      symbols: stocks ? 226 : 11,
      eligibleAtStart: stocks ? 191 : 11,
      classes: stocks
        ? [
            { id: "semiconductors", name: "Semiconductors", symbols: 24 },
            { id: "mega-cap-tech", name: "Mega-cap Tech", symbols: 12 },
            { id: "energy", name: "Energy", symbols: 19 },
            { id: "consumer-staples", name: "Consumer Staples", symbols: 18 },
          ]
        : [{ id: "SPDR sectors", name: "SPDR sectors", symbols: 11 }],
    },
    window: {
      dataStart: "2021-10-07",
      start: dates[0],
      end: dates.at(-1)!,
      sessions: dates.length,
    },
    dates,
    runs: ids.map((id, i) =>
      run(
        id,
        shapes[id].map((v, k) =>
          k === 2 && v !== null ? round(v + shift) : v,
        ) as Shape,
        dates,
        i * 0.9,
      ),
    ),
    tests: {
      sharpeDifferences: [
        {
          a: "core",
          b: "risk_parity_buy_hold",
          difference: -0.14,
          interval: [-0.71, 0.42],
          z: -0.61,
          p: 0.542,
        },
        {
          a: "core",
          b: "spy_buy_hold",
          difference: -0.02,
          interval: [-0.88, 0.79],
          z: -0.05,
          p: 0.96,
        },
        {
          a: "core",
          b: "equal_weight_buy_hold",
          difference: -0.32,
          interval: [-1.02, 0.31],
          z: -1.12,
          p: 0.263,
        },
      ],
      families: [
        {
          family: "trend",
          difference: 0.32,
          interval: [0.08, 0.57],
          status: "adds",
        },
        {
          family: "sector_trend",
          difference: 0.04,
          interval: [-0.12, 0.2],
          status: "neutral",
        },
        {
          family: "relative_momentum",
          difference: 0.05,
          interval: [-0.09, 0.19],
          status: "neutral",
        },
        {
          family: "mean_reversion",
          difference: -0.06,
          interval: [-0.11, -0.01],
          status: "detracts",
        },
      ],
      deflatedSharpe: {
        probability: 0.71,
        trials: 41,
        effectiveTrials: 12.6,
        benchmarkSharpe: 0.48,
      },
      overfitting: { probability: 0.18, splits: 252, variants: 9 },
    },
    rules: ruleCatalog.map((rule, i) => ({
      id: rule.id,
      family: rule.family,
      scalar: rule.scalar ?? 8.42,
      scalarSource: rule.scalar === null ? "pooled" : "book",
      meanAbsForecast: rule.id === "mr20" ? 13.6 : round(9.2 + (i % 5) * 0.4),
      turnover: round(
        rule.id.startsWith("mr")
          ? 58 - i
          : 256 / ((rule.params.fast ?? rule.params.horizon ?? 32) * 0.9),
        1,
      ),
      costPassRate:
        rule.id === "mr5" ? 61.5 : rule.id === "ewmac8" ? 88.2 : 100,
      sharpe: round(0.15 + 0.03 * (i % 6)),
      longOnlySharpe: round(0.28 + 0.02 * (i % 7)),
      correlationToTrend:
        rule.family === "trend"
          ? round(0.62 + (i % 4) * 0.08)
          : round(0.1 + (i % 3) * 0.12),
      weight: round(rule.weight, 2),
    })),
    classes: stocks
      ? [
          {
            id: "semiconductors",
            name: "Semiconductors",
            contribution: 9.82,
            averageWeight: 14.6,
          },
          {
            id: "mega-cap-tech",
            name: "Mega-cap Tech",
            contribution: 6.11,
            averageWeight: 9.8,
          },
          {
            id: "energy",
            name: "Energy",
            contribution: -1.34,
            averageWeight: 6.2,
          },
          {
            id: "consumer-staples",
            name: "Consumer Staples",
            contribution: 2.05,
            averageWeight: 7.4,
          },
        ]
      : [
          {
            id: "SPDR sectors",
            name: "SPDR sectors",
            contribution: 8.7,
            averageWeight: 64.2,
          },
        ],
    symbols: (stocks ? stockRows : sectorRows).map((r, i) => ({
      symbol: r.symbol,
      class: r.class,
      contribution: round(3.1 - i * 0.74),
      averageWeight: round(2.4 - i * 0.12),
      trades: 18 + i * 3,
    })),
    idm: { last: stocks ? 2.31 : 1.62, average: stocks ? 2.24 : 1.58 },
    fdm: { last: 1.38, average: 1.35 },
    warnings: stocks
      ? [
          { code: "forecast_scale", detail: "mr20 mean |f| 13.6" },
          { code: "family_detracts", detail: "mean_reversion" },
          { code: "data_failures", detail: "1 symbol" },
        ]
      : [],
    dataQuality: stocks
      ? {
          failures: [{ symbol: "NVTS", message: "PROVIDER_404" }],
          jumps: [{ symbol: "SMCI", date: "2025-02-18", return: 41.6 }],
          shortHistory: ["CRWV", "SNDK"],
        }
      : { failures: [], jumps: [], shortHistory: [] },
  };
}

export function reportFixture(
  id = "bt-20261003",
  asOf = "2026-10-02",
  createdAt = "2026-10-03T13:00:00.000Z",
  shift = 0,
): BacktestReport {
  const dates = fixtureSessions(asOf, 480);
  return {
    version: STRATEGY_ENGINE_VERSION,
    id,
    createdAt,
    completedAt: createdAt.replace("13:00:00", "13:06:41"),
    trigger: "schedule",
    asOf,
    configHash: "c9f2a41d",
    books: [
      bookReport("stocks", dates, shift),
      bookReport("sectors", dates, shift),
    ],
  };
}
const summaryOf = (report: BacktestReport): BacktestReportSummary => ({
  id: report.id,
  createdAt: report.createdAt,
  asOf: report.asOf,
  trigger: report.trigger,
  books: report.books.map((b) => {
    const core = b.runs.find((r) => r.id === "core")!.stats;
    return {
      book: b.book,
      sharpe: core.sharpe,
      cagr: core.cagr,
      maxDrawdown: core.maxDrawdown,
    };
  }),
});
export const reportFixtures: BacktestReport[] = [
  reportFixture(),
  reportFixture("bt-20260926", "2026-09-25", "2026-09-26T13:00:00.000Z", -0.04),
];
export const reportSummariesFixture = reportFixtures.map(summaryOf);

export const outboxFixture: OutboxEntry[] = [
  {
    id: "mail-4",
    createdAt: "2026-10-08T11:02:20.000Z",
    kind: "signals",
    subject: "[量化信号] 2026-10-07 · 个股 4 / 板块 1",
    status: "sent",
    transport: "ses",
  },
  {
    id: "mail-3",
    createdAt: "2026-10-03T13:06:45.000Z",
    kind: "report",
    subject: "[量化周报] 2026-10-02",
    status: "sent",
    transport: "ses",
  },
  {
    id: "mail-2",
    createdAt: "2026-10-01T15:30:00.000Z",
    kind: "failure",
    subject: "[量化任务失败] daily",
    status: "failed",
    transport: "ses",
    error: "MessageRejected",
  },
  {
    id: "mail-1",
    createdAt: "2026-09-30T18:11:09.000Z",
    kind: "test",
    subject: "[测试] msite signals",
    status: "disabled",
    transport: "none",
  },
];

export const stateFixture: StrategyState = {
  version: STRATEGY_ENGINE_VERSION,
  books: [
    {
      id: "stocks",
      name: { en: "Stock book", zh: "个股组合" },
      symbols: 226,
      capital: 100000,
      riskTarget: 20,
    },
    {
      id: "sectors",
      name: { en: "Sector ETF book", zh: "板块 ETF 组合" },
      symbols: 11,
      capital: 100000,
      riskTarget: 15,
    },
  ],
  scheduler: {
    enabled: true,
    timezone: "America/New_York",
    dailyAt: "07:00",
    weeklyDay: 6,
    weeklyAt: "09:00",
    lastDaily: {
      at: "2026-10-08T11:02:14.000Z",
      trigger: "schedule",
      status: "complete",
      asOf: fixtureAsOf,
      emailed: true,
    },
    lastBacktest: {
      at: "2026-10-03T13:06:41.000Z",
      trigger: "schedule",
      status: "complete",
      asOf: "2026-10-02",
      emailed: true,
    },
    nextDaily: "2026-10-09T11:00:00.000Z",
    nextBacktest: "2026-10-10T13:00:00.000Z",
  },
  email: {
    configured: true,
    transport: "ses",
    lastSent: {
      at: "2026-10-08T11:02:20.000Z",
      kind: "signals",
      status: "sent",
    },
  },
  latest: {
    asOf: fixtureAsOf,
    createdAt: latestFixture.createdAt,
    signals: stockSignals.length + sectorSignals.length,
  },
  latestReport: reportSummariesFixture[0],
  job: null,
  lastFailure: null,
};
export const jobFixture = (
  kind: StrategyJob["kind"] = "daily",
  done = 120,
): StrategyJob => ({
  id: `job-${kind}`,
  kind,
  trigger: "manual",
  startedAt: "2026-10-08T15:00:00.000Z",
  step: "fetch",
  done,
  total: 249,
});

const history: SignalRecord[] = [...stockSignals, ...sectorSignals].map(
  (s) => ({ ...s, emailed: true }),
);
export const signalsFixture: SignalRecord[] = [
  ...history,
  {
    ...stockSignals[3],
    id: "stocks:2026-10-06:XOM",
    symbol: "XOM",
    class: "energy",
    asOf: "2026-10-06",
    action: "entry",
    fromShares: 0,
    toShares: 17.6203,
    shares: 17.6203,
    price: 111.4,
    notional: 1962.9,
    fromWeight: 0,
    toWeight: 1.96,
    forecast: 6.5,
    fill: { date: fixtureAsOf, price: 111.62, cost: 0.98 },
    emailed: true,
  },
  {
    ...stockSignals[2],
    id: "stocks:2026-10-02:SNDK",
    symbol: "SNDK",
    asOf: "2026-10-02",
    action: "exit",
    reason: "ineligible",
    fill: { cancelled: "2026-10-06" },
    emailed: false,
  },
];

const paperDates = fixtureSessions(fixtureAsOf, 18);
export const paperFixture = (book = "stocks"): PaperLedger => ({
  version: 1,
  book,
  inception: paperDates[0],
  capital: 100000,
  configHash: "c9f2a41d",
  cash: book === "stocks" ? 14210.52 : 37950.1,
  positions: Object.fromEntries(
    (book === "stocks" ? stockRows : sectorRows)
      .filter((r) => r.heldShares > 0)
      .map((r) => [
        r.symbol,
        {
          symbol: r.symbol,
          shares: r.heldShares,
          averageCost: round((r.close ?? 0) * 0.97),
          lastClose: r.close ?? 0,
          lastDate: fixtureAsOf,
        },
      ]),
  ),
  pending: (book === "stocks" ? stockSignals : sectorSignals).map((s) => ({
    signalId: s.id,
    symbol: s.symbol,
    shares: s.shares,
    decidedAt: s.asOf,
    waited: 0,
  })),
  lastSession: fixtureAsOf,
  equity: paperDates.map((date, t) => ({
    date,
    value: round(
      100000 *
        (1 +
          (book === "stocks" ? 0.0123 : -0.0049) * (t / 17) +
          0.004 * Math.sin(t / 2.5)),
    ),
    benchmark: round(
      668.2 * (1 + 0.0087 * (t / 17) + 0.003 * Math.sin(t / 3 + 1)),
    ),
  })),
  fills: [
    {
      date: fixtureAsOf,
      symbol: "XOM",
      side: "buy",
      shares: 17.6203,
      price: 111.62,
      cost: 0.98,
      signalId: "stocks:2026-10-06:XOM",
    },
  ],
  events: [
    { date: paperDates[0], kind: "inception", detail: "Paper ledger opened" },
  ],
});

/** Latest 252 sessions of one symbol, as /api/strategy/charts/:book/:symbol returns. */
export function chartFixture(book: string, symbol: string): SymbolChart {
  const dates = fixtureSessions(fixtureAsOf, 252);
  const row = latestFixture.books
    .find((b) => b.book === book)
    ?.rows.find((r) => r.symbol === symbol);
  const seed = [...symbol].reduce((s, c) => s + c.charCodeAt(0), 0) % 7;
  // Curves end exactly at the snapshot row, so the drill-down matches the table.
  const last = row?.forecast ?? 3;
  const age = (t: number) => t - (dates.length - 1);
  const forecast = dates.map((_, t) =>
    t < 20
      ? null
      : round(
          Math.max(
            -20,
            Math.min(
              20,
              last + 11 * Math.sin(age(t) / 31 + seed) - 11 * Math.sin(seed),
            ),
          ),
          1,
        ),
  );
  const averageWeight = row?.averageWeight ?? 1.9;
  return {
    book,
    symbol,
    asOf: fixtureAsOf,
    dates,
    close: dates.map((_, t) =>
      round(
        (row?.close ?? 100) *
          Math.exp(
            0.0009 * age(t) +
              0.08 * (Math.sin(age(t) / 30 + seed) - Math.sin(seed)),
          ),
      ),
    ),
    forecast,
    families: Object.fromEntries(
      ruleFamilies.map((family) => [
        family,
        forecast.map((f) =>
          f === null
            ? null
            : round(
                Math.max(
                  -20,
                  Math.min(20, f - last + (row?.families[family] ?? last)),
                ),
                1,
              ),
        ),
      ]),
    ) as Record<RuleFamily, (number | null)[]>,
    targetWeight: forecast.map((f) =>
      f === null ? null : round((Math.max(0, f) / 10) * averageWeight),
    ),
  };
}
