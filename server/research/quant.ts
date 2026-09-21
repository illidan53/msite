import type { PriceBar } from "../../shared/types";
import type { ResearchMetric } from "../../shared/research";
import { newYorkDate } from "../../shared/marketDate";
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const variance = (a: number[]) => {
  const avg = mean(a);
  return a.length < 2
    ? NaN
    : a.reduce((s, v) => s + (v - avg) ** 2, 0) / (a.length - 1);
};
const sd = (a: number[]) => Math.sqrt(variance(a));
const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);
export function closedBars(bars: PriceBar[], now = new Date()) {
  const today = newYorkDate(now);
  const unique = new Map<string, PriceBar>();
  for (const bar of bars) {
    if (!Number.isFinite(Date.parse(bar.timestamp))) continue;
    const date = newYorkDate(bar.timestamp);
    if (
      !date ||
      !today ||
      date >= today ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(
        Number.isFinite,
      ) ||
      bar.close <= 0 ||
      bar.low <= 0 ||
      bar.high < bar.low ||
      bar.close < bar.low ||
      bar.close > bar.high ||
      bar.volume < 0
    )
      continue;
    unique.set(date, bar);
  }
  return [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bar]) => bar);
}
export function calculateResearch(
  bars: PriceBar[],
  benchmark: PriceBar[],
  dateFor = newYorkDate,
) {
  const metrics: ResearchMetric[] = [];
  const add = (
    id: string,
    en: string,
    zh: string,
    value: number,
    unit: ResearchMetric["unit"],
    group: ResearchMetric["group"],
    note: string,
  ) =>
    metrics.push({
      id,
      en,
      zh,
      value: Number.isFinite(value) ? value : null,
      unit,
      group,
      note,
    });
  const closes = bars.map((b) => b.close),
    last = closes.at(-1) ?? NaN;
  const ret = (n: number) =>
    closes.length > n ? (last / closes.at(-n - 1)! - 1) * 100 : NaN;
  const returns = closes.slice(1).map((v, i) => v / closes[i] - 1);
  const daily = returns.slice(-252);
  const annual =
    closes.length >= 253 ? (last / closes.at(-253)! - 1) * 100 : NaN;
  for (const [n, en, zh] of [
    [21, "1M price return", "1 月价格收益"],
    [63, "3M price return", "3 月价格收益"],
    [126, "6M price return", "6 月价格收益"],
    [252, "1Y price return", "1 年价格收益"],
  ] as const)
    add(
      `return${n}`,
      en,
      zh,
      ret(n),
      "percent",
      "performance",
      `${n} sessions; split-adjusted price, excludes dividends / 交易日；拆股调整价格，不含分红`,
    );
  add(
    "cagr",
    "Annualized price return",
    "年化价格收益",
    closes.length >= 253
      ? ((last / closes[0]) ** (252 / (closes.length - 1)) - 1) * 100
      : NaN,
    "percent",
    "performance",
    "Available history, 252 sessions/year; excludes dividends / 可用历史，不含分红",
  );
  let peak = 0,
    maxDrawdown = 0,
    underwater = 0,
    longest = 0;
  const prices = bars.map((b) => {
    peak = Math.max(peak, b.close);
    const drawdown = (b.close / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    underwater = drawdown < 0 ? underwater + 1 : 0;
    longest = Math.max(longest, underwater);
    return { date: dateFor(b.timestamp)!, close: b.close, drawdown };
  });
  add(
    "maxDrawdown",
    "Maximum drawdown",
    "最大回撤",
    bars.length > 1 ? maxDrawdown : NaN,
    "percent",
    "risk",
    "Available history, closing prices / 可用历史收盘价",
  );
  add(
    "drawdown",
    "Current drawdown",
    "当前回撤",
    prices.at(-1)?.drawdown ?? NaN,
    "percent",
    "risk",
    "From highest close in available history / 相对可用历史最高收盘价",
  );
  add(
    "underwater",
    "Current underwater duration",
    "当前回撤持续时间",
    bars.length > 1 ? underwater : NaN,
    "days",
    "risk",
    "Trading sessions, may be unrecovered / 交易日；可能尚未恢复",
  );
  add(
    "longestDrawdown",
    "Longest underwater duration",
    "最长回撤持续时间",
    bars.length > 1 ? longest : NaN,
    "days",
    "risk",
    "Includes ongoing drawdown / 包含尚未恢复的回撤",
  );
  for (const n of [20, 60, 252])
    add(
      `vol${n}`,
      `${n}D volatility`,
      `${n} 日波动率`,
      returns.length >= n ? sd(returns.slice(-n)) * Math.sqrt(252) * 100 : NaN,
      "percent",
      "risk",
      "Sample SD of daily simple returns × √252 / 日简单收益样本标准差 × √252",
    );
  const validYear = daily.length === 252;
  const downside = Math.sqrt(mean(daily.map((r) => Math.min(0, r) ** 2)));
  add(
    "downside",
    "Downside volatility (1Y)",
    "下行波动率（1 年）",
    validYear ? downside * Math.sqrt(252) * 100 : NaN,
    "percent",
    "risk",
    "Target return 0; all 252 observations / 目标收益 0，全部 252 个样本",
  );
  add(
    "sharpe",
    "Sharpe (1Y, rf=0)",
    "Sharpe（1 年，rf=0）",
    validYear ? ratio(mean(daily), sd(daily)) * Math.sqrt(252) : NaN,
    "number",
    "risk",
    "Zero risk-free-rate assumption / 无风险利率假设为 0",
  );
  add(
    "sortino",
    "Sortino (1Y, target=0)",
    "Sortino（1 年，目标=0）",
    validYear ? ratio(mean(daily), downside) * Math.sqrt(252) : NaN,
    "number",
    "risk",
    "Zero target return / 目标收益为 0",
  );
  let yearPeak = 0,
    yearDD = 0;
  for (const c of closes.slice(-253)) {
    yearPeak = Math.max(yearPeak, c);
    yearDD = Math.min(yearDD, c / yearPeak - 1);
  }
  add(
    "calmar",
    "Calmar (1Y)",
    "Calmar（1 年）",
    ratio(annual / 100, -yearDD),
    "number",
    "risk",
    "1Y price return ÷ absolute 1Y max drawdown / 同期收益 ÷ 最大回撤绝对值",
  );
  const bench = new Map(benchmark.map((b) => [dateFor(b.timestamp), b.close]));
  const pairs: [number, number][] = [];
  for (let i = Math.max(1, bars.length - 252); i < bars.length; i++) {
    const p = bench.get(dateFor(bars[i - 1].timestamp)),
      c = bench.get(dateFor(bars[i].timestamp));
    if (p && c) pairs.push([returns[i - 1], c / p - 1]);
  }
  const x = pairs.map((p) => p[1]),
    y = pairs.map((p) => p[0]);
  const meanX = mean(x),
    meanY = mean(y);
  const covariance =
    pairs.length >= 60
      ? (mean(pairs.map(([a, b]) => (a - meanY) * (b - meanX))) *
          pairs.length) /
        (pairs.length - 1)
      : NaN;
  const beta = ratio(covariance, variance(x)),
    correlation = ratio(covariance, sd(x) * sd(y));
  const start = bars.at(-253),
    bStart = start ? bench.get(dateFor(start.timestamp)) : undefined,
    bLast = bars.at(-1)
      ? bench.get(dateFor(bars.at(-1)!.timestamp))
      : undefined;
  add(
    "excess",
    "1Y benchmark excess return",
    "1 年超额价格收益",
    bStart && bLast ? annual - (bLast / bStart - 1) * 100 : NaN,
    "percent",
    "performance",
    "Same endpoint dates; selected benchmark / 相同起止日；所选基准",
  );
  add(
    "beta",
    "Beta",
    "Beta",
    beta,
    "number",
    "risk",
    `Daily date-aligned regression; ${pairs.length} pairs, minimum 60 / 按日期配对，至少 60 组`,
  );
  add(
    "correlation",
    "Benchmark correlation",
    "基准相关性",
    correlation,
    "number",
    "risk",
    "Last 252 sessions, ≥60 pairs / 最近 252 日，至少 60 组",
  );
  add(
    "alpha",
    "Annualized regression alpha",
    "年化回归 Alpha",
    Number.isFinite(beta) ? (mean(y) - beta * mean(x)) * 252 * 100 : NaN,
    "percent",
    "risk",
    "OLS intercept × 252, rf=0; descriptive / OLS 截距 × 252，描述性统计",
  );
  add(
    "r2",
    "Regression R²",
    "回归 R²",
    correlation ** 2,
    "number",
    "risk",
    "Single benchmark regression / 单基准回归",
  );
  for (const n of [20, 50, 200]) {
    const sma = closes.length >= n ? mean(closes.slice(-n)) : NaN;
    add(
      `sma${n}`,
      `SMA ${n}`,
      `${n} 日均线`,
      sma,
      "usd",
      "trend",
      "Arithmetic mean of closing prices / 收盘价算术平均",
    );
    add(
      `distance${n}`,
      `Distance to SMA ${n}`,
      `距 ${n} 日均线`,
      (last / sma - 1) * 100,
      "percent",
      "trend",
      "Close / SMA − 1 / 收盘价 ÷ 均线 − 1",
    );
  }
  let gain = NaN,
    loss = NaN,
    atr = NaN;
  if (bars.length >= 15) {
    const diff = closes.slice(1).map((c, i) => c - closes[i]);
    gain = mean(diff.slice(0, 14).map((v) => Math.max(v, 0)));
    loss = mean(diff.slice(0, 14).map((v) => Math.max(-v, 0)));
    for (const d of diff.slice(14)) {
      gain = (gain * 13 + Math.max(d, 0)) / 14;
      loss = (loss * 13 + Math.max(-d, 0)) / 14;
    }
    const tr = bars
      .slice(1)
      .map((b, i) =>
        Math.max(
          b.high - b.low,
          Math.abs(b.high - closes[i]),
          Math.abs(b.low - closes[i]),
        ),
      );
    atr = mean(tr.slice(0, 14));
    for (const v of tr.slice(14)) atr = (atr * 13 + v) / 14;
  }
  add(
    "rsi",
    "RSI (14)",
    "RSI（14）",
    gain === 0 && loss === 0
      ? 50
      : loss === 0
        ? 100
        : 100 - 100 / (1 + gain / loss),
    "number",
    "trend",
    "Wilder smoothing / Wilder 平滑",
  );
  add(
    "atr",
    "ATR / price (14)",
    "ATR / 股价（14）",
    (atr / last) * 100,
    "percent",
    "risk",
    "Wilder true range / price / Wilder 真实波幅 ÷ 股价",
  );
  const ema = (a: number[], n: number) => {
    const out: number[] = [];
    if (a.length < n) return out;
    let v = mean(a.slice(0, n));
    out.push(v);
    for (const c of a.slice(n)) {
      v += ((c - v) * 2) / (n + 1);
      out.push(v);
    }
    return out;
  };
  const e12 = ema(closes, 12),
    e26 = ema(closes, 26),
    macd = e26.map((v, i) => e12[i + 14] - v),
    signal = ema(macd, 9);
  add(
    "macd",
    "MACD (12,26)",
    "MACD（12,26）",
    macd.at(-1) ?? NaN,
    "usd",
    "trend",
    "EMA12 − EMA26 / 12 日 EMA − 26 日 EMA",
  );
  add(
    "macdSignal",
    "MACD signal (9)",
    "MACD 信号（9）",
    signal.at(-1) ?? NaN,
    "usd",
    "trend",
    "EMA9 of MACD / MACD 的 9 日 EMA",
  );
  add(
    "macdHistogram",
    "MACD histogram",
    "MACD 柱值",
    (macd.at(-1) ?? NaN) - (signal.at(-1) ?? NaN),
    "usd",
    "trend",
    "MACD − signal / MACD − 信号线",
  );
  const recent = closes.slice(-20),
    mid = mean(recent),
    popSd = Math.sqrt(mean(recent.map((c) => (c - mid) ** 2)));
  add(
    "bbWidth",
    "Bollinger bandwidth",
    "布林带宽",
    recent.length === 20 ? ((4 * popSd) / mid) * 100 : NaN,
    "percent",
    "trend",
    "20 closes, population SD, ±2 SD / 20 日，总体标准差 ±2σ",
  );
  add(
    "bbPosition",
    "Bollinger %B",
    "布林带 %B",
    recent.length === 20
      ? ratio(last - (mid - 2 * popSd), 4 * popSd) * 100
      : NaN,
    "percent",
    "trend",
    "0%=lower band, 100%=upper band / 下轨 0%，上轨 100%",
  );
  add(
    "highDistance",
    "Distance from 52W high close",
    "距 52 周最高收盘价",
    closes.length >= 252
      ? (last / Math.max(...closes.slice(-252)) - 1) * 100
      : NaN,
    "percent",
    "trend",
    "252 sessions; closing prices / 252 个交易日收盘价",
  );
  const vols = bars.slice(-21, -1).map((b) => b.volume);
  add(
    "rvol",
    "Relative volume (1/20)",
    "相对成交量（1/20）",
    vols.length === 20 ? ratio(bars.at(-1)!.volume, mean(vols)) : NaN,
    "number",
    "liquidity",
    "Latest completed session / prior 20 average / 最近完整交易日 ÷ 前 20 日均值",
  );
  add(
    "dollarVolume",
    "Average dollar volume (20D)",
    "20 日平均成交额",
    bars.length >= 20
      ? mean(bars.slice(-20).map((b) => b.close * b.volume))
      : NaN,
    "usd",
    "liquidity",
    "Close × volume approximation / 收盘价 × 成交量估算",
  );
  return { metrics, prices: prices.slice(-252) };
}
