import type { ResearchMetric } from "../../../shared/research";
import type { MetricExplanation } from "../../shared/MetricHelp";

type Pair = [string, string];
type Guide = { meaning: Pair; formula: Pair; example: Pair; caveat: Pair };
const guides: Record<string, Guide> = {};
function add(
  ids: string,
  meaning: Pair,
  formula: Pair,
  example: Pair,
  caveat: Pair,
) {
  for (const id of ids.split(" "))
    guides[id] = { meaning, formula, example, caveat };
}
add(
  "return21 return63 return126 return252",
  [
    "Shows how much the price changed over the named period. Compare periods to see whether gains are recent or sustained.",
    "看这段时间价格涨跌多少；对比不同期限，可以分辨上涨是最近发生还是持续已久。",
  ],
  [
    "(Latest close / close N sessions ago − 1) × 100%; N = 21, 63, 126 or 252.",
    "（最新收盘价 ÷ N 个交易日前收盘价 − 1）× 100%；N 为 21、63、126 或 252。",
  ],
  ["From $100 to $110 is +10%.", "从 100 美元涨到 110 美元，收益为 +10%。"],
  [
    "Split-adjusted prices exclude dividends and costs. A past gain does not predict the next one.",
    "价格已做拆股调整，但不含股息和交易费用。过去上涨不代表接下来还会涨。",
  ],
);
add(
  "cagr",
  [
    "Turns the available multi-year price change into an equivalent yearly compound rate.",
    "把多年的价格变化换算成每年复利增长速度，方便比较不同长度的历史。",
  ],
  [
    "[(Last / first close)^(252 / session intervals) − 1] × 100%.",
    "［（末价 ÷ 初价）^(252 ÷ 交易日间隔数) − 1］× 100%。",
  ],
  [
    "A 21% gain over two years is about 10% a year.",
    "两年累计上涨 21%，相当于每年复利约 10%。",
  ],
  [
    "Uses available history, up to five years; excludes dividends and hides the bumps along the way.",
    "使用最多五年的可用历史，不含股息；年化数字会掩盖中间的大起大落。",
  ],
);
add(
  "maxDrawdown drawdown",
  [
    "Measures the fall from a previous closing-price peak. Current drawdown describes today; maximum drawdown is the worst historical fall.",
    "衡量从先前收盘高点跌了多少。当前回撤看现在离高点多远；最大回撤看历史最痛的一次下跌。",
  ],
  [
    "(Close / highest prior close − 1) × 100%; maximum drawdown is the minimum across the sample.",
    "（收盘价 ÷ 此前最高收盘价 − 1）× 100%；最大回撤取样本中最小值。",
  ],
  [
    "A fall from $100 to $75 is −25%; recovering needs a 33.3% gain.",
    "从 100 跌到 75 是 −25%；想回到 100，需要再涨 33.3%。",
  ],
  [
    "Reference colors: −10% or worse is notable; −20% or worse is deep. These are site conventions, not loss limits. Future losses can be larger.",
    "本站参考：≤ −10% 为明显回撤，≤ −20% 为深度回撤。这不是止损线，未来可能跌得更多。",
  ],
);
add(
  "underwater longestDrawdown",
  [
    "Counts how long the price stays below its previous peak. Useful for thinking about patience and when you may need the money.",
    "看价格多久没回到前高，帮助你考虑能否承受漫长等待，以及这笔钱何时要用。",
  ],
  [
    "Consecutive trading sessions below the running closing peak; current or longest stretch.",
    "连续低于此前收盘高点的交易日数；分别统计当前这段或历史最长一段。",
  ],
  [
    "252 underwater sessions means roughly a trading year below the peak.",
    "水下 252 个交易日，大约就是一年没有回到前高。",
  ],
  [
    "Trading sessions are not calendar days. The longest stretch includes unfinished recoveries; there is no universal acceptable duration.",
    "这里是交易日，不是自然日。最长一段可能尚未结束，没有通用的“等多久就安全”。",
  ],
);
add(
  "vol20 vol60 vol252",
  [
    "Measures how widely daily returns swing, expressed at a yearly scale. Higher volatility means a bumpier ride in both directions.",
    "衡量每日涨跌有多剧烈，并换算成年化尺度。越高表示上下波动越大，持有体验越颠簸。",
  ],
  [
    "Sample standard deviation of daily returns × √252 × 100%, over the named window.",
    "对应窗口内日收益率的样本标准差 × √252 × 100%。",
  ],
  [
    "40% volatility describes larger typical swings than 15%, not an expected 40% loss.",
    "40% 波动率通常比 15% 更颠簸，但不表示一定会亏 40%。",
  ],
  [
    "Site reference bands: below 15% low, 15–30% medium, 30–50% elevated, 50%+ high. Compare the same window and similar assets; these are not forecasts.",
    "本站参考：<15% 较低，15%–<30% 中等，30%–<50% 较高，≥50% 高波动。应比较相同窗口、同类资产，这不是预测。",
  ],
);
add(
  "downside",
  [
    "Focuses on negative daily returns instead of all price movement. Helps compare how severe the downside bumps have been.",
    "只关注下跌方向的日收益，帮助比较向下颠簸的程度。",
  ],
  [
    "√mean(min(daily return, 0)²) × √252 × 100%; 252 sessions, zero target.",
    "过去 252 日中 min（日收益, 0）的平方均值开根号，再 × √252 × 100%；目标收益为 0。",
  ],
  [
    "With identical gains, larger losing days increase downside deviation.",
    "上涨情况相同，亏损日跌得更狠，下行波动率就更高。",
  ],
  [
    "No universal high/low cutoff; compare similar assets over the same dates. This is not maximum possible loss.",
    "没有通用高低线，要与同类资产、相同区间比较；它不是最大可能亏损。",
  ],
);
add(
  "sharpe sortino calmar",
  [
    "Compares return with risk taken. Sharpe uses all volatility, Sortino only downside deviation, and Calmar the worst drawdown.",
    "看承担风险换来了多少收益。夏普用整体波动作代价，索提诺用下行波动，卡玛用最大回撤。",
  ],
  [
    "Sharpe = mean daily return / daily SD × √252; Sortino uses downside RMS instead of SD; Calmar = one-year price return / absolute one-year maximum drawdown.",
    "夏普 = 日均收益 ÷ 日标准差 × √252；索提诺把标准差换成下行均方根；卡玛 = 一年价格收益 ÷ 同期最大回撤绝对值。",
  ],
  [
    "A 20% annual return and 10% maximum drawdown give Calmar = 2.",
    "一年涨 20%、同期最大回撤 10%，卡玛比率就是 2。",
  ],
  [
    "Higher is better only with comparable windows and assumptions. Zero target/risk-free rate here; a negative value means negative return. Tiny denominators can inflate ratios; missing is not zero.",
    "只有区间和口径可比时才是越高越好。本站无风险/目标收益取 0；负值表示收益为负。分母很小会放大比率，缺失不等于 0。",
  ],
);
add(
  "excess",
  [
    "Shows whether the stock or ETF beat your chosen benchmark over one year.",
    "看过去一年是否跑赢你选的基准，帮助区分“跟着市场涨”和相对领先。",
  ],
  [
    "Asset one-year price return − benchmark one-year price return, in percentage points.",
    "个股/ETF 一年价格收益率 − 基准同期价格收益率，差值单位为百分点。",
  ],
  [
    "Asset +15%, benchmark +10%: excess = +5 percentage points.",
    "资产涨 15%、基准涨 10%，超额收益为 +5 个百分点。",
  ],
  [
    "Outperformance may involve more risk. The benchmark and matching dates matter; dividends are excluded.",
    "跑赢也可能是承担了更高风险。基准选择和日期对齐很重要，计算不含股息。",
  ],
);
add(
  "beta",
  [
    "Estimates how sensitively returns moved with the chosen benchmark. Useful for checking market exposure.",
    "估计它对所选基准涨跌有多敏感，用来了解组合的市场暴露。",
  ],
  [
    "Covariance(asset, benchmark) / variance(benchmark), using matched daily returns.",
    "对齐日期后的资产与基准日收益协方差 ÷ 基准日收益方差。",
  ],
  [
    "Beta 1.5 suggests an average 1.5% move associated with a 1% benchmark move in the fitted history.",
    "Beta 为 1.5，表示在历史拟合中，基准变动 1% 对应资产平均约 1.5% 的变动。",
  ],
  [
    "Above 1 means more sensitivity; below 0 means inverse association. It is not a guaranteed daily move and does not capture all risk.",
    ">1 表示对基准更敏感，<0 表示反向关联。不是每天都会按此比例涨跌，也不代表全部风险。",
  ],
);
add(
  "correlation r2",
  [
    "Correlation measures whether daily moves align. R² measures how much variation a simple benchmark regression describes.",
    "相关系数看日涨跌是否同步；R² 看单一基准的回归能解释多少历史波动。",
  ],
  [
    "Correlation ranges from −1 to +1; R² = correlation², from 0 to 1.",
    "相关系数范围 −1 到 +1；R² = 相关系数²，范围 0 到 1。",
  ],
  [
    "Correlation −0.8 means strong opposite movement; R² is 0.64 (64%).",
    "相关系数 −0.8 表示较强反向变动，对应 R² 为 0.64，也就是 64%。",
  ],
  [
    "High is not inherently good or bad. Correlation can change during stress; R² does not prove causation.",
    "高低不是好坏。压力时期相关性会改变，R² 也不能证明因果关系。",
  ],
);
add(
  "alpha",
  [
    "Estimates the part of historical return not explained by a simple benchmark regression.",
    "估计历史收益中，简单基准回归没解释掉的那部分。可辅助看相对表现。",
  ],
  [
    "Daily regression intercept × 252 × 100%; zero risk-free rate.",
    "日收益回归截距 × 252 × 100%；无风险利率按 0 处理。",
  ],
  [
    "Daily intercept 0.01% becomes about 2.52% annualized alpha.",
    "日截距 0.01%，换算成年化 Alpha 约 2.52%。",
  ],
  [
    "Positive does not prove skill or future excess return; the benchmark and omitted risks can change the result.",
    "正值不证明投资能力，也不保证未来超额收益；基准和遗漏的风险因素都会影响结果。",
  ],
);
add(
  "sma20 sma50 sma200",
  [
    "Smooths daily noise into an average price. Short windows respond faster; long windows describe slower trends.",
    "把每天的噪声平滑成平均价格。短均线反应快，长均线用来观察更长期方向。",
  ],
  [
    "Mean closing price over the latest 20, 50 or 200 sessions.",
    "最近 20、50 或 200 个交易日收盘价的算术平均。",
  ],
  [
    "Closes of 10, 11 and 12 have a three-day average of 11.",
    "三个收盘价为 10、11、12，三日均线就是 11。",
  ],
  [
    "An absolute dollar price is not cheap or expensive by itself. Compare price with the average; averages lag turning points.",
    "单看多少美元无法判断贵便宜，要结合现价与均线位置；均线在转折时会滞后。",
  ],
);
add(
  "distance20 distance50 distance200",
  [
    "Shows how far the latest close sits above or below its moving average. Helps read trend position.",
    "看现价高于或低于均线多少，帮助判断价格处于趋势的什么位置。",
  ],
  [
    "(Latest close / moving average − 1) × 100%.",
    "（最新收盘价 ÷ 对应均线 − 1）× 100%。",
  ],
  [
    "Price 110, average 100: distance = +10%.",
    "现价 110、均线 100，距离为 +10%。",
  ],
  [
    "Positive is above the average, not a buy signal. Large distances can persist; there is no universal reversal threshold.",
    "正值表示在均线上方，不代表应该买。偏离可能持续，没有通用的必然反转线。",
  ],
);
add(
  "rsi",
  [
    "Compares recent upward and downward price changes to describe momentum, on a 0–100 scale.",
    "比较最近上涨和下跌的力度，用 0–100 描述动量强弱。",
  ],
  [
    "14-session Wilder smoothing; RSI = 100 − 100 / (1 + average gain / average loss).",
    "使用 14 日 Wilder 平滑；RSI = 100 − 100 ÷（1 + 平均涨幅 ÷ 平均跌幅）。",
  ],
  [
    "RSI 78 falls in the hot zone; it can remain there while price keeps rising.",
    "RSI 为 78 属于偏热区，但可能维持高位并继续上涨。",
  ],
  [
    "Reference: ≥70 hot, ≤30 cold, otherwise middle range. These conventional zones do not automatically mean sell or buy.",
    "参考：≥70 偏热，≤30 偏冷，中间为中性区。这些常用区间不等于卖出或买入信号。",
  ],
);
add(
  "atr",
  [
    "Measures the typical daily price range, including gaps, as a share of price. Useful when judging whether a move is unusually large.",
    "把包含跳空的每日振幅换算成价格百分比，用来判断某次波动是否超出平常。",
  ],
  [
    "14-session Wilder average of max(high−low, |high−previous close|, |low−previous close|) / latest close × 100%.",
    "max（最高−最低、|最高−前收|、|最低−前收|）的 14 日 Wilder 均值 ÷ 最新收盘价 × 100%。",
  ],
  [
    "ATR 2% at $100 corresponds to about $2 of average true range.",
    "价格 100 美元时 ATR 为 2%，相当于平均真实振幅约 2 美元。",
  ],
  [
    "It measures movement size, not direction. Compare its own history and similar assets; no universal high/low cutoff.",
    "它看波动大小，不看涨跌方向。要对比自身历史和同类资产，没有通用高低线。",
  ],
);
add(
  "macd macdSignal macdHistogram",
  [
    "MACD compares fast and slow trends. The signal line smooths MACD; the histogram shows whether MACD is above or below that signal.",
    "MACD 比较快慢趋势；信号线对 MACD 再平滑；柱体显示 MACD 高于还是低于信号线。",
  ],
  [
    "MACD = EMA12 − EMA26; signal = EMA9(MACD); histogram = MACD − signal.",
    "MACD = 12 日 EMA − 26 日 EMA；信号线 = MACD 的 9 日 EMA；柱体 = MACD − 信号线。",
  ],
  [
    "MACD 2 and signal 1.5 give a +0.5 histogram.",
    "MACD 为 2、信号线为 1.5，则柱体为 +0.5。",
  ],
  [
    "Values are in dollars and cannot be compared directly across differently priced stocks. One reading cannot identify a crossover or predict a reversal.",
    "数值单位为美元，不宜直接跨不同股价比较；单个读数无法判断刚发生交叉，也不能预测反转。",
  ],
);
add(
  "bbWidth",
  [
    "Measures the width of Bollinger Bands relative to the average price, helping spot quiet versus active periods.",
    "看布林带相对均价有多宽，用来观察行情处于收缩还是扩张阶段。",
  ],
  [
    "4 × population SD of 20 closes / SMA20 × 100%.",
    "20 日收盘价总体标准差 × 4 ÷ 20 日均线 × 100%。",
  ],
  [
    "Bands at 90 and 110 around 100 give a width of 20%.",
    "均线为 100，上下轨为 110 和 90，带宽为 20%。",
  ],
  [
    "Compare with its own history. Narrow bands do not tell you the direction or timing of a breakout.",
    "需对比自身历史；带子很窄也不能告诉你会向哪边、何时突破。",
  ],
);
add(
  "bbPosition",
  [
    "Locates the price inside or outside its Bollinger Bands.",
    "看价格位于布林带的什么位置，帮助识别是否偏离近期常见波动区间。",
  ],
  [
    "(Close − lower band) / (upper − lower band) × 100%.",
    "（收盘价 − 下轨）÷（上轨 − 下轨）× 100%。",
  ],
  [
    "0% is the lower band, 50% the center, 100% the upper band; 120% is above it.",
    "0% 在下轨，50% 在中间，100% 在上轨；120% 已在上轨之外。",
  ],
  [
    "Outside 0–100% is highlighted, not a reversal signal. Prices can follow a band for a long time.",
    "超出 0–100% 会高亮，但不是反转信号；价格可能沿着轨道持续运行。",
  ],
);
add(
  "highDistance",
  [
    "Shows the gap to the highest closing price in the latest 252 sessions.",
    "看现价距离最近 252 个交易日的最高收盘价有多远。",
  ],
  [
    "(Latest close / highest close in 252 sessions − 1) × 100%.",
    "（最新收盘价 ÷ 近 252 日最高收盘价 − 1）× 100%。",
  ],
  [
    "Current 80 versus a high of 100 gives −20%.",
    "现价 80、区间最高为 100，距离为 −20%。",
  ],
  [
    "Uses closing highs, not intraday highs. Reference drawdown bands apply; a large gap does not mean a bargain.",
    "使用最高收盘价，而非盘中最高价。沿用回撤参考区间；离高点远不等于便宜。",
  ],
);
add(
  "rvol",
  [
    "Compares the latest completed session’s trading volume with its recent norm. Helps spot unusual activity.",
    "把最近完整交易日的成交量与近期常态相比，帮助发现异常活跃。",
  ],
  [
    "Latest volume / average volume of the preceding 20 sessions, excluding the latest session.",
    "最近一日成交量 ÷ 此前 20 日平均成交量；分母不包含当日。",
  ],
  [
    "2 means twice the recent average; 0.5 means half.",
    "2 表示平常的两倍，0.5 表示只有平常的一半。",
  ],
  [
    "Site reference: ≥2 notably active, ≤0.5 quiet. Volume does not reveal net inflows or the next price direction.",
    "本站参考：≥2 明显放量，≤0.5 明显缩量。成交量不能说明资金净流入，也不能预告涨跌。",
  ],
);
add(
  "dollarVolume",
  [
    "Approximates how much money changes hands daily. Useful for comparing trading liquidity with your order size.",
    "估计每天成交多少金额，帮助把市场流动性与自己的下单规模作比较。",
  ],
  [
    "Mean of daily close × volume over 20 sessions.",
    "最近 20 日的“收盘价 × 成交量”取平均。",
  ],
  [
    "One million shares at $50 approximates $50 million of turnover.",
    "100 万股、收盘价 50 美元，近似成交额为 5000 万美元。",
  ],
  [
    "This is an approximation, not executable depth. Spreads and order size matter; there is no universal sufficient amount.",
    "只是近似值，不代表挂单深度；还要看价差与订单大小，没有通用的足够流动性门槛。",
  ],
);
add(
  "marketCap aum",
  [
    "Market cap measures a company’s equity size; AUM measures the assets managed by a fund. Useful for comparing scale.",
    "市值看公司股权规模；资产管理规模（AUM）看基金管理多少资产。用于比较体量。",
  ],
  [
    "Market cap = price × shares; AUM = reported fund assets.",
    "市值 = 股价 × 股数；AUM 使用基金披露的资产规模。",
  ],
  [
    "100 million shares at $20 give a $2 billion market cap.",
    "1 亿股、每股 20 美元，市值为 20 亿美元。",
  ],
  [
    "Bigger does not automatically mean safer or cheaper. Check the reporting date; fund size is not trading volume.",
    "规模大不自动代表安全或便宜；注意披露时间，基金规模也不等于成交量。",
  ],
);
add(
  "price_to_earnings price_to_sales ev_to_ebitda",
  [
    "Shows how much investors pay per unit of earnings, sales or operating earnings before interest, tax, depreciation and amortization.",
    "看投资者为每一元利润、收入，或息税折旧摊销前利润支付多少价格，用来辅助估值比较。",
  ],
  [
    "P/E = price / TTM EPS; P/S = market cap / TTM sales; EV/EBITDA = enterprise value / TTM EBITDA.",
    "市盈率 = 股价 ÷ 过去 12 月每股盈利；市销率 = 市值 ÷ 过去 12 月收入；EV/EBITDA = 企业价值 ÷ 过去 12 月 EBITDA。",
  ],
  [
    "P/E 20 means paying $20 for each $1 of annual earnings.",
    "市盈率 20，意味着为每年 1 元盈利支付 20 元价格。",
  ],
  [
    "Compare peers, growth and accounting quality. Low can reflect trouble; high can reflect growth. Negative/zero EPS makes P/E unavailable here. No universal cheap/expensive threshold.",
    "应比较同行、增长和会计质量。低可能因为经营困难，高可能因为增长预期。本站非正 EPS 不展示市盈率，没有通用便宜/昂贵线。",
  ],
);
add(
  "debt_to_equity",
  [
    "Compares borrowing with shareholder equity to understand financial leverage.",
    "看债务相对股东权益有多大，帮助了解财务杠杆。",
  ],
  ["Provider-reported debt / equity.", "数据源披露的债务 ÷ 股东权益。"],
  [
    "Debt 200 and equity 100 give a ratio of 2.",
    "债务 200、股东权益 100，比率为 2。",
  ],
  [
    "Industry and debt definitions matter. Negative equity can create a negative ratio; that is not low leverage. Check the balance sheet.",
    "行业和债务定义很重要。负股东权益可能产生负比率，并不是杠杆低，要回看资产负债表。",
  ],
);
add(
  "current",
  [
    "Checks whether short-term assets cover short-term liabilities, a rough liquidity check.",
    "粗略看短期资产能否覆盖短期负债，辅助判断短期偿债压力。",
  ],
  ["Current assets / current liabilities.", "流动资产 ÷ 流动负债。"],
  [
    "Assets 80 and liabilities 100 give 0.8.",
    "流动资产 80、流动负债 100，比率为 0.8。",
  ],
  [
    "Below 1 flags a coverage gap, not certain distress. Inventory quality, cash cycles and industry matter; very high is not always better.",
    "<1 提醒账面覆盖不足，但不等于一定有危机。还要看存货质量、现金周转和行业，过高也不一定更好。",
  ],
);
add(
  "fcfYield",
  [
    "Compares annual free cash flow with market value, showing cash generation relative to the price paid.",
    "把年度自由现金流与市值比较，观察相对于价格的现金创造能力。",
  ],
  [
    "TTM free cash flow / market cap × 100%.",
    "过去 12 月自由现金流 ÷ 市值 × 100%。",
  ],
  [
    "Free cash flow 5 and market cap 100 give a 5% yield.",
    "自由现金流 5、市值 100，自由现金流收益率为 5%。",
  ],
  [
    "This is not a cash payout or guaranteed yield. One-off cash flows and investment cycles distort it; compare peers.",
    "这不是实际分红或保本收益率；一次性现金流和投资周期会扭曲数值，应对比同行。",
  ],
);
add(
  "return_on_equity return_on_assets",
  [
    "Measures how much profit is produced from equity (ROE) or assets (ROA). Helps compare business profitability.",
    "看股东权益（ROE）或全部资产（ROA）创造利润的效率，辅助比较经营盈利能力。",
  ],
  [
    "Provider return ratio × 100%; typically net income / equity or assets.",
    "数据源回报比率 × 100%；通常为净利润 ÷ 权益或资产。",
  ],
  [
    "Profit 10 on equity 100 gives ROE 10%.",
    "净利润 10、权益 100，对应 ROE 10%。",
  ],
  [
    "Compare the same accounting period and industry. Debt or a tiny/negative equity base can make ROE misleading.",
    "比较时应匹配会计期间和行业；高负债、很小或负的权益基数会使 ROE 失真。",
  ],
);
add(
  "dividend_yield",
  [
    "Shows dividends relative to share price, useful for understanding the income component.",
    "看股息相对于股价的比例，帮助了解现金分红部分。",
  ],
  ["Provider dividend yield ratio × 100%.", "数据源股息收益率比率 × 100%。"],
  [
    "$3 of annual dividends at $100 implies 3%.",
    "每年股息 3 美元、股价 100 美元，对应 3%。",
  ],
  [
    "High yield can result from a falling price. Dividends can be cut; check payout coverage and provider timing.",
    "高股息率可能来自股价下跌；分红可能被削减，要看支付能力和数据时点。",
  ],
);
add(
  "revenue",
  [
    "Shows sales in the latest reported quarter, a starting point for business size and growth analysis.",
    "看最新披露季度卖出了多少收入，是观察业务规模与增长的起点。",
  ],
  ["Reported quarterly revenue in USD.", "财报披露的季度营业收入，美元计价。"],
  [
    "Revenue of $1 billion means quarterly sales, not $1 billion of profit.",
    "10 亿美元收入表示季度销售额，不是赚了 10 亿利润。",
  ],
  [
    "Revenue is not cash flow or profit. Compare matching quarters and account for acquisitions and seasonality.",
    "收入不等于现金流或利润；要匹配季度比较，并留意并购和季节性。",
  ],
);
add(
  "grossMargin operatingMargin",
  [
    "Shows what share of sales remains after production costs (gross) or after operating expenses (operating).",
    "看收入扣除生产成本后剩多少（毛利率），或再扣经营费用后剩多少（营业利润率）。",
  ],
  [
    "Quarterly gross profit or operating income / revenue × 100%.",
    "季度毛利润或营业利润 ÷ 营业收入 × 100%。",
  ],
  [
    "Sales 100 and gross profit 30 give a 30% gross margin.",
    "收入 100、毛利润 30，毛利率就是 30%。",
  ],
  [
    "Compare peers and trends, not a universal cutoff. Operating margin excludes interest and tax; accounting changes can distort comparisons.",
    "要比较同行和自身趋势，没有统一好坏线。营业利润率不含利息与税费，会计变化会影响可比性。",
  ],
);
add(
  "revenueGrowth epsGrowth",
  [
    "Compares revenue or diluted earnings per share with the same quarter last year, helping track business growth.",
    "与去年同季度比较收入或稀释每股盈利，帮助观察业务是否增长。",
  ],
  [
    "(Current quarter / year-ago quarter − 1) × 100%, requiring a positive prior-year base.",
    "（本季度 ÷ 去年同季度 − 1）× 100%；要求去年基数为正。",
  ],
  ["From 100 to 120 is 20% growth.", "从 100 增至 120，就是增长 20%。"],
  [
    "Small bases exaggerate percentages. Buybacks can lift EPS without revenue growth; a negative prior base is unavailable here.",
    "低基数会放大百分比；回购可能提升 EPS 而收入没增长。本站去年基数为负时不计算。",
  ],
);
add(
  "expense",
  [
    "Measures annual fund operating costs relative to assets, helping compare ongoing fees.",
    "看基金每年运营费用占资产的比例，帮助比较长期持有成本。",
  ],
  [
    "Annual fund operating expenses / average net assets × 100%.",
    "年度基金运营费用 ÷ 平均净资产 × 100%。",
  ],
  [
    "0.2% costs roughly $20 a year per $10,000 at a constant balance.",
    "余额不变时，1 万美元、费率 0.2%，一年约 20 美元。",
  ],
  [
    "Lower fees help all else equal, but compare similar strategies. Excludes trading spreads, commissions and some other costs; unavailable without a reliable feed.",
    "其他相同时费用低更省钱，但应比较同类策略。不含交易价差、佣金等费用；无可靠来源时不显示。",
  ],
);
add(
  "premium",
  [
    "Compares an ETF’s market price with its net asset value (NAV).",
    "看 ETF 交易价格与每份净资产价值（NAV）之间的差异。",
  ],
  ["(Market price / NAV − 1) × 100%.", "（市价 ÷ NAV − 1）× 100%。"],
  [
    "Price 101 and NAV 100 mean a 1% premium; price 99 means a 1% discount.",
    "市价 101、净值 100，溢价 1%；市价 99 则折价 1%。",
  ],
  [
    "Premium means paying above NAV, not a sell signal; discount is not free profit. Match timestamps and market hours.",
    "溢价表示买得比净值贵，不是卖出信号；折价也不是无风险利润。必须匹配报价时点和交易时段。",
  ],
);
add(
  "tracking",
  [
    "Measures how inconsistently a fund’s returns differ from its benchmark. Useful for assessing index tracking.",
    "看基金收益偏离基准的程度是否稳定，用来评估指数跟踪效果。",
  ],
  [
    "Annualized standard deviation of fund-minus-benchmark returns; provider methodology governs.",
    "基金与基准收益差的标准差再年化，具体以数据源口径为准。",
  ],
  [
    "A constant −0.2% yearly gap can have low tracking error despite persistent underperformance.",
    "即使每年稳定落后 0.2%，跟踪误差仍可能很低。",
  ],
  [
    "Different from tracking difference. Lower matters for index replication; leveraged or active strategies have different objectives.",
    "它不等于跟踪差异。复制指数时低更贴近目标，杠杆或主动策略目标可能不同。",
  ],
);
add(
  "concentration",
  [
    "Shows how much of the fund sits in its ten largest holdings, useful for spotting concentration.",
    "看前十大持仓占基金多大比例，帮助识别是否过于依赖少数资产。",
  ],
  [
    "Sum of the ten largest holding weights × 100%.",
    "前十大持仓权重之和 × 100%。",
  ],
  [
    "60% means $60 of each $100 is in those ten holdings.",
    "60% 表示每 100 元中有 60 元集中在前十大持仓。",
  ],
  [
    "Higher means less spread across holdings, not necessarily poor quality. Sector overlap and derivatives also matter; no universal safe cutoff.",
    "越高表示持仓越集中，不一定质量差；还需看行业重叠和衍生品，没有通用安全线。",
  ],
);

export type MetricTone = "neutral" | "positive" | "negative" | "caution";
export function metricAssessment(m: Pick<ResearchMetric, "id" | "value">): {
  tone: MetricTone;
  label: Pair;
} {
  const v = m.value,
    id = m.id;
  const result = (tone: MetricTone, en: string, zh: string) => ({
    tone,
    label: [en, zh] as Pair,
  });
  if (v === null || !Number.isFinite(v))
    return result("neutral", "No data", "暂无数据");
  if (id === "rsi")
    return v >= 70
      ? result("caution", "Hot · ≥70", "偏热 · ≥70")
      : v <= 30
        ? result("caution", "Cold · ≤30", "偏冷 · ≤30")
        : result("neutral", "Middle range", "中性区");
  if (/^vol(20|60|252)$/.test(id))
    return v >= 50
      ? result("negative", "High volatility", "高波动")
      : v >= 30
        ? result("caution", "Elevated volatility", "较高波动")
        : result(
            "neutral",
            v < 15 ? "Lower volatility" : "Medium volatility",
            v < 15 ? "较低波动" : "中等波动",
          );
  if (["drawdown", "maxDrawdown", "highDistance"].includes(id))
    return v <= -20
      ? result("negative", "Deep drawdown", "深度回撤")
      : v <= -10
        ? result("caution", "Notable drawdown", "明显回撤")
        : result(
            "neutral",
            v === 0 ? "At closing high" : "Below closing high",
            v === 0 ? "处于收盘高点" : "低于收盘高点",
          );
  if (id === "rvol")
    return v >= 2
      ? result("caution", "Unusually active · ≥2×", "明显放量 · ≥2倍")
      : result(
          "neutral",
          v <= 0.5 ? "Quiet · ≤0.5×" : "Near recent volume",
          v <= 0.5 ? "明显缩量 · ≤0.5倍" : "常态附近",
        );
  if (id === "bbPosition")
    return v > 100
      ? result("caution", "Above upper band", "高于上轨")
      : v < 0
        ? result("caution", "Below lower band", "低于下轨")
        : result("neutral", "Inside bands", "轨道内");
  if (id === "current")
    return v < 1
      ? result("caution", "Coverage below 1×", "短期覆盖不足 1 倍")
      : result("neutral", "Coverage ≥1×", "短期覆盖 ≥1 倍");
  if (id === "beta")
    return v > 1
      ? result("caution", "More benchmark sensitivity", "对基准更敏感")
      : result(
          "neutral",
          v < 0 ? "Inverse association" : "Sensitivity ≤1×",
          v < 0 ? "反向关联" : "敏感度 ≤1倍",
        );
  if (id === "debt_to_equity" && v < 0)
    return result("caution", "Check equity base", "需核对权益基数");
  if (id === "premium")
    return result(
      v > 0 ? "caution" : "neutral",
      v > 0 ? "Premium to NAV" : v < 0 ? "Discount to NAV" : "At NAV",
      v > 0 ? "溢价" : v < 0 ? "折价" : "平价",
    );
  const sign = (
    enPositive: string,
    zhPositive: string,
    enNegative: string,
    zhNegative: string,
  ) =>
    result(
      v > 0 ? "positive" : v < 0 ? "negative" : "neutral",
      v > 0 ? enPositive : v < 0 ? enNegative : "Zero",
      v > 0 ? zhPositive : v < 0 ? zhNegative : "零值",
    );
  if (/^distance(20|50|200)$/.test(id))
    return sign("Above average", "均线上方", "Below average", "均线下方");
  if (id === "macdHistogram")
    return sign("Above signal", "高于信号线", "Below signal", "低于信号线");
  if (["macd", "macdSignal"].includes(id))
    return sign(
      "Positive trend reading",
      "趋势读数为正",
      "Negative trend reading",
      "趋势读数为负",
    );
  if (id === "excess")
    return sign(
      "Ahead of benchmark",
      "跑赢基准",
      "Behind benchmark",
      "跑输基准",
    );
  if (/^return(21|63|126|252)$/.test(id) || id === "cagr")
    return sign("Price gain", "价格上涨", "Price loss", "价格下跌");
  if (
    [
      "alpha",
      "sharpe",
      "sortino",
      "calmar",
      "fcfYield",
      "return_on_equity",
      "return_on_assets",
      "grossMargin",
      "operatingMargin",
      "revenueGrowth",
      "epsGrowth",
    ].includes(id)
  )
    return sign("Positive reading", "正值", "Negative reading", "负值");
  return result("neutral", "Context matters", "需结合背景比较");
}
export function researchMetricGuide(
  m: ResearchMetric,
  locale: "en" | "zh",
): MetricExplanation {
  const i = locale === "zh" ? 1 : 0;
  const guide = guides[m.id];
  const assessment = metricAssessment(m);
  return {
    title: m[locale],
    meaning:
      guide?.meaning[i] ??
      (i
        ? "此指标需结合数据口径与同类资产比较。"
        : "Compare this metric with similar assets and check its methodology."),
    formula: guide?.formula[i] ?? m.note,
    example:
      guide?.example[i] ?? (i ? "暂无适用示例。" : "No example available."),
    caveat:
      (guide?.caveat[i] ?? "") +
      (i ? "\n数据口径（原文）：" : "\nData methodology: ") +
      m.note,
    reading:
      (i ? "当前标签：" : "Current label: ") +
      assessment.label[i] +
      (i
        ? "。颜色表达方向或需关注的情况，不是买卖建议；未着色不代表没有风险。"
        : ". Colors indicate direction or something to review, not a trading recommendation. Uncolored does not mean risk-free."),
  };
}
export const researchGuideIds = Object.keys(guides);
