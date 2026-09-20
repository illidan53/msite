import type { MetricExplanation } from "../../shared/MetricHelp";
import type { Locale } from "../../shared/locale";

export function activityExplanations(locale: Locale) {
  const pick = (en: MetricExplanation, zh: MetricExplanation) =>
    locale === "en" ? en : zh;
  const priceReturn = (days: number) =>
    pick(
      {
        title: `${days}D price return`,
        meaning: `How much the ETF price changed over ${days} trading sessions.`,
        formula: `(Latest completed daily close ÷ close ${days} sessions earlier − 1) × 100%. Requires ${days + 1} daily closes.`,
        example: "A move from $100 to $105 is +5%.",
        caveat:
          "Split-adjusted prices exclude reinvested dividends. Today's daily bar is excluded, even after the close, to avoid partial or delayed data. Missing windows show —, not zero.",
      },
      {
        title: `${days} 日价格涨跌幅`,
        meaning: `观察 ETF 价格在 ${days} 个交易日内的变化。`,
        formula: `（最近已完成日 K 收盘价 ÷ 往前 ${days} 个交易日的收盘价 − 1）× 100%。需要 ${days + 1} 根日 K。`,
        example: "价格由 100 美元涨到 105 美元，涨幅为 +5%。",
        caveat:
          "价格已处理拆股，但不含分红再投资。为避开未完成或延迟更新的数据，当日日 K 即使收盘后也暂不纳入；窗口不足显示 —，不当作零。",
      },
    );
  return {
    priceReturn,
    relative: pick(
      {
        title: "20D relative to SPY",
        meaning:
          "Whether the ETF outperformed the S&P 500 proxy over the same dates.",
        formula:
          "ETF 20-session price return − SPY 20-session price return, in percentage points (pp). Dates must match.",
        example:
          "ETF +6%, SPY +4% → +2 pp. ETF −2%, SPY −5% → +3 pp, despite an absolute loss.",
        caveat:
          "Uses prices, not dividend-reinvested total returns. Relative strength is not net fund flow or a buy signal. Check each row's date before comparing.",
      },
      {
        title: "20 日相对 SPY",
        meaning: "观察 ETF 在相同日期区间内是否跑赢以 SPY 代表的标普 500。",
        formula:
          "ETF 的 20 日价格涨跌幅 − SPY 的 20 日价格涨跌幅，单位为百分点。两者日期必须匹配。",
        example:
          "ETF +6%、SPY +4% → 领先 2 个百分点。ETF −2%、SPY −5% 时也领先 3 个百分点，但仍亏损。",
        caveat:
          "采用价格涨跌，不含分红再投资；相对强弱不是资金净流入，也不是买入信号。跨标的比较时留意各行日期。",
      },
    ),
    rvol: pick(
      {
        title: "Relative volume (5/20)",
        meaning:
          "Whether recent trading volume is higher or lower than its earlier baseline.",
        formula:
          "Average volume over the latest 5 sessions ÷ average volume over the preceding 20 sessions. The windows do not overlap.",
        example:
          "Recent average 2 million shares, previous average 1 million → 2.00×.",
        caveat:
          "Measures activity, not buying direction. A zero denominator or an incomplete 25-session window produces —. A volume spike can accompany either a rise or a fall. Share splits can distort volume comparisons.",
      },
      {
        title: "量比（5/20）",
        meaning: "最近的成交量相较之前是否更活跃。",
        formula:
          "最近 5 个交易日的平均成交量 ÷ 再往前 20 个交易日的平均成交量。两个区间不重叠。",
        example: "最近平均每天 200 万股，此前平均 100 万股，量比为 2.00 倍。",
        caveat:
          "衡量活跃程度，不判断买卖方向。分母为 0 或不足 25 个交易日时显示 —；放量可能伴随上涨，也可能伴随下跌；拆股会影响成交量的可比性。",
      },
    ),
    cmf: pick(
      {
        title: "CMF (20)",
        meaning:
          "A volume-weighted measure of where prices close within each day's high–low range.",
        formula:
          "M = (2 × close − high − low) ÷ (high − low). CMF20 = Σ(M × volume) ÷ Σvolume over 20 sessions. If high = low, use M = 0.",
        example:
          "High $110, low $100, close $108 → M = 0.6. CMF weights such daily values by volume.",
        caveat:
          "Usually ranges from −1 to +1. Positive means closes skew toward daily highs; it is not measured capital inflow. Zero total volume or invalid OHLC data produces —.",
      },
      {
        title: "CMF（20 日）",
        meaning: "结合成交量，观察收盘价更常靠近当日最高价还是最低价。",
        formula:
          "M =（2 × 收盘价 − 最高价 − 最低价）÷（最高价 − 最低价）。CMF20 = 20 日 Σ（M × 成交量）÷ Σ成交量。最高价等于最低价时 M 记为 0。",
        example:
          "最高价 110、最低价 100、收盘价 108 美元，则 M = 0.6；再用各日成交量加权。",
        caveat:
          "通常介于 −1 到 +1。正值说明收盘位置更偏高，不能当作实际资金净流入。总成交量为 0 或价格数据异常时显示 —。",
      },
    ),
    span: pick(
      {
        title: "Range price change",
        meaning:
          "Price movement between the first and last available bars in the selected time span.",
        formula: "(Last bar close ÷ first bar close − 1) × 100%.",
        example: "First close $100, last close $105 → +5%.",
        caveat:
          "Actual endpoints depend on available bars. Split-adjusted, excludes dividends; not capital flow.",
      },
      {
        title: "区间涨跌幅",
        meaning: "观察所选时间区间内，当前可用价格历史从头到尾的变化。",
        formula: "（最后一根 K 线收盘价 ÷ 第一根 K 线收盘价 − 1）× 100%。",
        example: "首根收盘价 100 美元，末根 105 美元，则区间涨幅为 +5%。",
        caveat:
          "起止点取决于实际返回的 K 线。少于两根时无法计算；价格处理拆股，但不含分红再投资，也不是资金流量。",
      },
    ),
    dollarVolume: pick(
      {
        title: "Estimated dollar volume",
        meaning: "An approximation of trading activity in dollars.",
        formula:
          "Snapshot price × snapshot volume. The volume belongs to the snapshot session and does not change with the Time span selector.",
        example: "$50 per share × 1 million shares = $50 million.",
        caveat:
          "Not the exact sum of trade values and not net inflow. Every transaction has a buyer and a seller.",
      },
      {
        title: "估算成交额",
        meaning: "按快照报价折算成交量，粗略衡量交易活跃程度。",
        formula:
          "快照报价 × 快照成交量。成交量属于快照交易时段，不随时间区间选项变化。",
        example: "50 美元 × 100 万股 = 5,000 万美元。",
        caveat:
          "不是逐笔成交金额的精确合计，也不是资金净流入。每笔交易都有买卖双方。",
      },
    ),
  };
}
