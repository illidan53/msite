import type { ResearchReport } from "../../../shared/research";
type Pair = [string, string];
export interface DecisionRule {
  id: string;
  name: Pair;
  group: Pair;
  weight: number;
  unit: string;
  thresholds: Pair;
  score: (v: number) => number;
}
const bands = (v: number, low: number, high: number) =>
  v >= high ? 2 : v > low ? 1 : v <= -high ? -2 : v < -low ? -1 : 0;
export const decisionRules: DecisionRule[] = [
  {
    id: "distance200",
    name: ["Distance to SMA200", "距 200 日均线"],
    group: ["Trend", "趋势"],
    weight: 25,
    unit: "%",
    thresholds: [
      "≤−5: −2; (−5,−2): −1; [−2,2]: 0; (2,5): +1; ≥5: +2",
      "≤−5：−2；(−5,−2)：−1；[−2,2]：0；(2,5)：+1；≥5：+2",
    ],
    score: (v) => bands(v, 2, 5),
  },
  {
    id: "distance50",
    name: ["Distance to SMA50", "距 50 日均线"],
    group: ["Trend", "趋势"],
    weight: 20,
    unit: "%",
    thresholds: [
      "Same ±2 / ±5 bands as SMA200 distance",
      "同上，使用 ±2 / ±5 分界",
    ],
    score: (v) => bands(v, 2, 5),
  },
  {
    id: "return63",
    name: ["3M price return", "3 月价格收益"],
    group: ["Momentum", "动量"],
    weight: 20,
    unit: "%",
    thresholds: [
      "≤−15: −2; (−15,−5): −1; [−5,5]: 0; (5,15): +1; ≥15: +2",
      "≤−15：−2；(−15,−5)：−1；[−5,5]：0；(5,15)：+1；≥15：+2",
    ],
    score: (v) => bands(v, 5, 15),
  },
  {
    id: "excess",
    name: ["1Y benchmark excess", "1 年超额收益"],
    group: ["Relative strength", "相对强弱"],
    weight: 15,
    unit: "pp",
    thresholds: [
      "≤−10: −2; (−10,−3): −1; [−3,3]: 0; (3,10): +1; ≥10: +2",
      "≤−10：−2；(−10,−3)：−1；[−3,3]：0；(3,10)：+1；≥10：+2",
    ],
    score: (v) => bands(v, 3, 10),
  },
  {
    id: "macdNormalized",
    name: ["MACD histogram / close", "MACD 柱值 / 收盘价"],
    group: ["Momentum", "动量"],
    weight: 10,
    unit: "%",
    thresholds: [
      "≤−0.3: −2; (−0.3,−0.1): −1; [−0.1,0.1]: 0; (0.1,0.3): +1; ≥0.3: +2",
      "≤−0.3：−2；(−0.3,−0.1)：−1；[−0.1,0.1]：0；(0.1,0.3)：+1；≥0.3：+2",
    ],
    score: (v) => bands(v, 0.1, 0.3),
  },
  {
    id: "rsi",
    name: ["RSI (14)", "RSI（14）"],
    group: ["Momentum", "动量"],
    weight: 10,
    unit: "",
    thresholds: [
      "<40: −2; [40,45): −1; [45,55): 0; [55,70): +1; ≥70: 0 (heat filter)",
      "<40：−2；[40,45)：−1；[45,55)：0；[55,70)：+1；≥70：0（进入偏热过滤）",
    ],
    score: (v) => (v < 40 ? -2 : v < 45 ? -1 : v < 55 ? 0 : v < 70 ? 1 : 0),
  },
];
const riskRules = [
  {
    id: "vol60",
    name: ["60D annualized volatility", "60 日年化波动率"] as Pair,
    unit: "%",
    thresholds: [
      "<30: ×1; [30,50): ×0.75; ≥50: ×0.5",
      "<30：×1；[30,50)：×0.75；≥50：×0.5",
    ] as Pair,
    factor: (v: number) => (v >= 50 ? 0.5 : v >= 30 ? 0.75 : 1),
  },
  {
    id: "drawdown",
    name: ["Current drawdown", "当前回撤"] as Pair,
    unit: "%",
    thresholds: [
      ">−20: ×1; (−30,−20]: ×0.75; ≤−30: ×0.5",
      ">−20：×1；(−30,−20]：×0.75；≤−30：×0.5",
    ] as Pair,
    factor: (v: number) => (v <= -30 ? 0.5 : v <= -20 ? 0.75 : 1),
  },
  {
    id: "dollarVolume",
    name: ["20D dollar volume", "20 日平均成交额"] as Pair,
    unit: "USD",
    thresholds: [
      "≥10M: ×1; [1M,10M): ×0.75; <1M: ×0.5",
      "≥1000万：×1；[100万,1000万)：×0.75；<100万：×0.5",
    ] as Pair,
    factor: (v: number) => (v < 1e6 ? 0.5 : v < 1e7 ? 0.75 : 1),
  },
  {
    id: "rsi",
    name: ["RSI heat filter", "RSI 偏热过滤"] as Pair,
    unit: "",
    thresholds: [
      "<70: ×1; [70,80): ×0.75; ≥80: ×0.5",
      "<70：×1；[70,80)：×0.75；≥80：×0.5",
    ] as Pair,
    factor: (v: number) => (v >= 80 ? 0.5 : v >= 70 ? 0.75 : 1),
  },
];
export function scoreDecision(report: ResearchReport, now = Date.now()) {
  const get = (id: string) => {
    const v = report.metrics.find((m) => m.id === id)?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const rows = decisionRules.map((rule) => {
    const close = report.prices.at(-1),
      histogram = get("macdHistogram");
    const value =
      rule.id === "macdNormalized"
        ? close &&
          close.close > 0 &&
          close.date === report.sections.quant.asOf &&
          histogram !== null
          ? (histogram / close.close) * 100
          : null
        : get(rule.id);
    const score = value === null ? null : rule.score(value);
    return {
      ...rule,
      value,
      score,
      buy: score === null ? 0 : (Math.max(score, 0) / 2) * rule.weight,
      sell: score === null ? 0 : (Math.max(-score, 0) / 2) * rule.weight,
    };
  });
  const risks = riskRules.map((rule) => {
    const value = get(rule.id);
    return {
      ...rule,
      value,
      factor: value === null ? null : rule.factor(value),
    };
  });
  const coverage = rows.reduce(
    (sum, r) => sum + (r.value === null ? 0 : r.weight),
    0,
  );
  const factor = Math.min(
    1,
    ...risks.flatMap((r) => (r.factor === null ? [] : [r.factor])),
  );
  const rawBuy = rows.reduce((sum, r) => sum + r.buy, 0),
    sell = rows.reduce((sum, r) => sum + r.sell, 0),
    buy = rawBuy * factor,
    net = buy - sell;
  const cutoff = Date.parse(`${report.sections.quant.asOf}T00:00:00Z`);
  const stale =
    !Number.isFinite(cutoff) || now - cutoff > 7 * 86400000 || cutoff > now;
  const missing =
    coverage < 80 ||
    rows.slice(0, 2).some((r) => r.value === null) ||
    risks.some((r) => r.value === null);
  const ready =
    !stale && !missing && report.sections.quant.status === "complete";
  const conflict = rawBuy >= 20 && sell >= 20;
  const grade =
    !ready || conflict || Math.abs(net) < 20
      ? 0
      : Math.abs(net) >= 60
        ? 3
        : Math.abs(net) >= 40
          ? 2
          : 1;
  const side = !ready
    ? "unavailable"
    : conflict
      ? "conflict"
      : grade === 0
        ? "wait"
        : net > 0
          ? "buy"
          : "sell";
  return {
    rows,
    risks,
    coverage,
    factor,
    rawBuy,
    buy,
    sell,
    net,
    stale,
    missing,
    ready,
    conflict,
    grade,
    side,
  };
}
