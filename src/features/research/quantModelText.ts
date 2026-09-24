import type { PullbackModelId } from "../../../shared/research";

export type Pair = readonly [string, string];
export interface ModelNotes {
  spec: { term: Pair; value: Pair }[];
  notes: { title: Pair; body: Pair }[];
  sources: { label: Pair; href: string }[];
}
export type QuantModelId = "ema200" | PullbackModelId;
export const quantModelIds: QuantModelId[] = [
  "ema200",
  "sma50",
  "rsi2",
  "bollinger",
];

const entry = {
  term: ["Entry", "入场"],
  value: [
    "Next session's open after the signal; no same-bar fills",
    "信号后下一交易日开盘；不假设同一根 K 线成交",
  ],
} as const;
const bootstrapSource = {
  label: ["FPP3 · bootstrap", "FPP3 · 重采样"],
  href: "https://otexts.com/fpp3/bootstrap.html",
} as const;
const lookAheadSource = {
  label: ["CFA Institute · look-ahead bias", "CFA Institute · 前视偏差"],
  href: "https://www.cfainstitute.org/insights/articles/good-bad-and-ugly-of-bias-in-ai",
} as const;

export const ema200Notes: ModelNotes = {
  spec: [
    {
      term: ["Question", "研究问题"],
      value: [
        "Does a pullback toward EMA200 from above precede stronger returns than comparable background days?",
        "价格从上方回踩 EMA200 后，收益是否强于可比的背景交易日？",
      ],
    },
    {
      term: ["Trigger", "触发条件"],
      value: [
        "Prior close > prior EMA200 × 1.03 and today's low ≤ that boundary; undercuts and gaps below count",
        "前日收盘 > 前日 EMA200 × 1.03，且当日最低价 ≤ 该上边界；下穿、跳空到下方均计入",
      ],
    },
    entry,
    {
      term: ["Background", "背景样本"],
      value: [
        "Days with the same prior-close condition, no touch, outside the episode exclusion",
        "满足相同前日收盘条件、当日未触碰、且不在事件排除期内的交易日",
      ],
    },
    {
      term: ["Episode", "事件合并"],
      value: [
        "20-session cooldown plus 3 closes above the band before a new event",
        "20 个交易日冷却，并需连续 3 日收盘站上接触带才重新计入",
      ],
    },
    {
      term: ["Primary test", "主检验"],
      value: [
        "±3% band · 20-session endpoint advantage · 42-session block bootstrap",
        "±3% 接触带 · 20 日终点收益优势 · 42 日分块重采样",
      ],
    },
    {
      term: ["Descriptive only", "仅作描述"],
      value: [
        "5/10 sessions, path measures, +5% target, confirmation entry, ±1% / ±5% bands",
        "5／10 日、路径指标、+5% 目标、确认入场、±1%／±5% 接触带",
      ],
    },
  ],
  notes: [
    {
      title: ["What this model asks", "这个模型在研究什么"],
      body: [
        "Does a pullback toward EMA200 tend to be followed by a rebound? Separate the existence and persistence of a rebound from the outcome of holding for a fixed period. These are historical observations, not live trades or a buy signal.",
        "价格回落到 EMA200 附近后，是否更容易反弹？把“有没有反弹、反弹能维持多久”与“固定持有期赚亏多少”分开看。这里是历史观察，不是实盘交易记录，也不直接构成买入信号。",
      ],
    },
    {
      title: ["A zone, not an exact price", "用接触区域，而非精确碰线"],
      body: [
        "The primary band is ±3%. A candidate requires the previous close above previous EMA ×1.03 and today's low at or below that upper boundary. Price may enter the band, undercut it, or gap entirely below it: failures stay in the sample. The previous EMA is known before the session. ±3% is a preset convention, not an optimized threshold. The ±1% / ±3% / ±5% comparison changes the whole event and background definition; samples therefore differ. Do not pick whichever band looks best after observing its returns.",
        "主模型使用 ±3% 区域：前日收盘必须高于前日 EMA ×1.03，当日最低价进入上边界或更低，即识别为回踩候选。允许下穿甚至直接跳空到区域下方，失败案例不能被筛掉。参考前日 EMA，避免使用盘中尚未知的均线。±3% 是预先指定的参数，不是验证过的最优值。±1%／±3%／±5% 会同时改变事件和背景样本定义，因此样本不同；不要看完收益后只挑表现最好的区间。",
      ],
    },
    {
      title: ["One pullback episode", "连续下探合并为一次"],
      body: [
        "After a candidate, no event or background observation is collected for 20 sessions. A new observation also requires three consecutive completed closes above the upper band. A prolonged decline without recovery remains one episode, not repeated buying opportunities.",
        "首次候选出现后，20 个交易日内不再采集事件或背景观察；重新采样还要求连续三个已完成交易日收盘站上接触带上沿。持续下跌、尚未恢复的同一段走势不会被重复记为多个买入机会。",
      ],
    },
    {
      title: [
        "Describe the outcome without selecting winners",
        "保留失败，事后描述形态",
      ],
      body: [
        "Each event gets a label only after its 20-session window matures. Sustained weakness: the last three closes are below their prior EMA lower band; this takes priority. Reclaimed: at some point a low crossed below its prior EMA and a close subsequently (or that day) recovered to that EMA. Near: no low crossed below EMA. Other undercuts are mixed. These labels describe the observed path; they are not information available at the entry and never filter the primary test.",
        "事件的 20 日窗口完成后才标注形态。持续走弱：最后三日收盘均低于各自前日 EMA 的下边界，优先归为此类。曾跌破收回：期间最低价跌破当日前日 EMA，并曾在同日或随后收盘收回该日参考 EMA。仅附近回踩：窗口内未跌破 EMA。其余下穿归为反复／未收回。标签是事后描述，入场时并不知道；主检验不会只挑成功的形态。",
      ],
    },
    {
      title: ["Touch versus confirmed bottom", "首次回踩与底部确认分开"],
      body: [
        "The main study enters at the next open after the first candidate. Separately, track the lowest low from that candidate; a lower low restarts the clock. The first three subsequent sessions without a new low, within 20 sessions of the candidate, form a confirmation. Confirmation-based returns start at the next open after confirmation, never at the earlier low. This can still be a false bottom. Confirmation samples are a different, selected cohort, so their returns do not prove that waiting improves the same trade.",
        "主模型从首次回踩后的次日开盘开始计算。另设确认口径：从候选日跟踪最低价，创新低则重新计时；候选后 20 日内首次连续三个后续交易日未创新低，视为一次确认。确认收益从确认日之后的次日开盘计算，绝不倒回最低点假设买入。确认仍可能是假底；确认样本与首次回踩样本不同，不能仅凭两者均值高低就证明等待确认更优。",
      ],
    },
    {
      title: [
        "Endpoint return and average floating return",
        "终点收益与区间平均浮盈",
      ],
      body: [
        "Endpoint return at h sessions = close at t+h / entry open at t+1 −1. Average floating return = the arithmetic mean of each daily close / that same entry open −1 over sessions 1…h. It describes persistence above or below entry, not the average daily change, an annualized return, or a realized exit. Show 5/10/20 sessions for both. For evaluating a fixed holding rule, endpoint return is primary; average floating return supplements it.",
        "h 日终点收益 = t+h 日收盘 ÷ t+1 日入场开盘 −1。区间平均浮盈 = 第 1 至 h 日各自收盘相对同一个入场价的收益，再取算术平均。它描述这段时间整体位于入场价上方还是下方，不是平均每日涨跌幅、年化收益或实际卖出收益。两者均展示 5／10／20 日窗口；评价固定持有规则时以终点收益为主，平均浮盈为辅。",
      ],
    },
    {
      title: ["Rebound opportunity and downside", "反弹机会与过程风险"],
      body: [
        "Maximum gain uses the highest daily high after entry; maximum loss uses the lowest daily low, both relative to entry, bounded by zero. They are maximum favorable/adverse excursions, not peak-to-trough drawdown or achievable trading profits. Tables show their means across events. The preset +5% target is hit when a daily high reaches entry ×1.05. Hit rate uses all fully observed windows; median time uses hit events only. Daily bars cannot tell whether a high or low occurred first, so there is no implied stop-loss or take-profit strategy.",
        "最大上涨用入场后区间最高价相对入场价计算，最低为 0；最大下跌用区间最低价相对入场价计算，最高为 0。它们是相对入场价的最大有利／不利波动，不是峰谷回撤，也不是可实现的交易利润。表格展示各事件这些数值的平均值。预设 +5% 目标：某日最高价达到入场价 ×1.05 即为命中。发生率以所有完整窗口为分母，到达用时的中位数只统计命中事件。日线无法判断当天最高价和最低价的先后，不能据此假设止盈止损成交。",
      ],
    },
    {
      title: [
        "Why both matter · hypothetical example",
        "为什么两者都要看 · 假设例子",
      ],
      body: [
        "Two trades can both finish day 20 at +5%. One may stay profitable throughout; the other may fall 15% and recover only at the end. The endpoint is identical but the path and risk are different. To judge rebound tendency, read average floating return, +5% hit rate, time to hit and maximum loss together. A high hit rate alone may conceal large losses in the failures.",
        "两笔交易第 20 天都涨 5%：一种可能全程保持盈利，另一种可能先跌 15%，最后才反弹。终点相同，过程与风险却不同。判断反弹倾向时，将平均浮盈、+5% 发生率、用时和最大下跌一起看；高命中率也可能掩盖少数失败事件的大额亏损。",
      ],
    },
    {
      title: ["Evidence, comparators and uncertainty", "证据、对照与不确定性"],
      body: [
        "Only ±3% and the 20-session endpoint are the primary test. Background days have the same prior-close-above-band condition, no touch, and are outside the episode exclusion. r is point-biserial Pearson correlation of event (1/0) with endpoint return; advantage is the difference of group means. We use 1,000 moving-block bootstrap resamples of 42 calendar-session slots, including ineligible slots, for an approximate 95% interval. At least 12 mature events, 252 background days, nonzero variation and 950 valid resamples are required. Positive evidence also requires positive mean event return and positive advantage. Other windows, path measures, labels, confirmations and bands are descriptive, without separate significance claims.",
        "仅 ±3% 下的 20 日终点收益作为主检验。背景日同样要求前收盘在接触带上方、当日未触碰且不在事件排除期。r 为事件标记（1／0）与终点收益的点二列 Pearson 相关系数；优势为两组均值差。用 1000 次、每块 42 个交易日的移动分块重采样（包含不合格日空位）估计近似 95% 区间。至少需要 12 次成熟事件、252 个背景日、非零变异及 950 次有效重采样。正向证据还要求事件平均收益和收益优势均为正。其他窗口、路径指标、形态、确认及区间对比均为描述性结果，不单独宣称显著。",
      ],
    },
    {
      title: ["Limits and missing data", "限制与缺失数据"],
      body: [
        "EMA200 starts with the first 200 closes' simple mean, then updates with 2/201 weighting. Current split-adjusted history can be revised; finite history affects initialization. Incomplete windows and invalid entry prices are missing, never zero or failure. Returns exclude costs and reinvested dividends. Market drift, overlapping observations, regime changes, rare events and repeated testing can mislead; a block bootstrap does not make observations independent. No causality or out-of-sample validation is established. This model is not included in the buy/sell score. Saved reports automatically prepare the current model when opened from an allowed IP; this uses market history, not an LLM. Results are then shared with all readers.",
        "EMA200 先以 200 个收盘价的均值初始化，再按 2/201 权重递推。当前拆股调整历史可能被修订，有限历史影响初始化。未完成窗口和无效入场价留空，绝不当作零收益或失败。收益不含费用和分红再投资。市场漂移、重叠观察、环境变化、稀少事件和反复检验都可能误导；分块重采样不保证观察独立。尚未证明因果或完成样本外验证，此模型不加入买卖决策分数。白名单 IP 打开旧报告时，会自动准备当前模型结果；只用历史行情，不调用 LLM，保存后所有访客均可阅读。",
      ],
    },
  ],
  sources: [
    {
      label: ["StockCharts · moving averages", "StockCharts · 移动平均"],
      href: "https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential",
    },
    {
      label: ["SciPy · point-biserial r", "SciPy · 点二列相关 r"],
      href: "https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pointbiserialr.html",
    },
    bootstrapSource,
    lookAheadSource,
  ],
};

/** Shared statistical notes for the pullback models; the parameters are the model's pre-set values. */
function sharedNotes(
  horizon: number,
  parameter: Pair,
  exitLine: Pair,
): ModelNotes["notes"] {
  return [
    {
      title: ["Evidence, comparators and uncertainty", "证据、对照与不确定性"],
      body: [
        `Only ${parameter[0]} at the ${horizon}-session endpoint is the primary test; that horizon was fixed before looking at results. Background days pass the same regime and "not already in the zone" conditions but do not trigger, and are outside the episode exclusion. r is the point-biserial correlation of event (1/0) with endpoint return; advantage is event mean minus background mean. 1,000 moving-block bootstrap resamples (42-session blocks) give an approximate 95% interval. At least 12 mature events, 252 background days, nonzero variation and 950 valid resamples are required, and positive evidence also needs a positive event mean and advantage. Other horizons, path measures, rule exits and parameter rows are descriptive.`,
        `仅 ${parameter[1]} 下的 ${horizon} 日终点收益作为主检验，该窗口在查看结果前已固定。背景日满足相同的趋势与“尚未进入区域”条件、但当日未触发，且不在事件排除期。r 为事件标记（1／0）与终点收益的点二列相关系数；收益优势 = 事件均值 − 背景均值。用 1000 次、每块 42 个交易日的移动分块重采样估计近似 95% 区间。至少需要 12 次成熟事件、252 个背景日、非零变异与 950 次有效重采样；正向证据还要求事件均值与收益优势均为正。其他窗口、路径、规则退出与参数行均为描述性结果。`,
      ],
    },
    {
      title: ["Rule exit versus fixed horizon", "规则退出与固定持有期"],
      body: [
        `The fixed-horizon tables answer "what if I hold h sessions?". The rule exit answers "what if I sell when price reverts?": buy the next open, sell at the first close that reaches ${exitLine[0]}, otherwise at the close of session 20. Only events whose full 20-session window is complete are counted, so recent fast reverts cannot outnumber recent losers that are still open. Exits use closes; daily bars cannot show intraday order, and costs are excluded.`,
        `固定持有期回答“持有 h 日会怎样”；规则退出回答“价格回归就卖出会怎样”：次日开盘买入，首次收盘达到${exitLine[1]}时卖出，否则在第 20 日收盘退出。只统计 20 日窗口已完整的事件，避免近期快速回归的事件多于仍未结束的亏损事件。退出按收盘价计算；日线无法判断盘中先后，且不含交易成本。`,
      ],
    },
    {
      title: ["Several models, several tests", "多个模型，多次检验"],
      body: [
        "Four pullback models run on the same symbol, each with three parameter rows. Scanning them and trusting whichever looks positive inflates false discoveries. Agreement across models and neighbouring parameters is more informative than any single table. None of these models is part of the buy/sell score.",
        "同一标的同时运行四个回踩模型，每个还有三组参数。逐一浏览后只相信看起来为正的那个，会放大误判。多个模型、相邻参数方向一致，比任何单张表格更有参考价值。这些模型均不计入买卖决策分数。",
      ],
    },
    {
      title: ["Limits and missing data", "限制与缺失数据"],
      body: [
        "Split-adjusted daily history (up to five years) excludes dividends and costs, and can be revised. Averages need warm-up sessions, so the earliest history is not tested. Incomplete windows and invalid entry prices are missing, never zero. Overlapping observations, market drift, regime changes and small samples can mislead; the bootstrap does not make observations independent. Nothing here establishes causality or out-of-sample performance. Allowed IPs prepare these results automatically from market history, without an LLM; saved results are visible to all readers.",
        "使用最多五年的拆股调整日线，不含分红与成本，数据可能被修订。均线需要预热期，最早的一段历史不参与检验。未完成窗口与无效入场价留空，不当作零。重叠观察、市场漂移、环境变化与小样本都可能误导；分块重采样不保证观察独立。这里不证明因果，也未做样本外验证。白名单 IP 会用历史行情自动准备结果，不调用 LLM；保存后所有访客可见。",
      ],
    },
  ];
}

export const pullbackNotes: Record<PullbackModelId, ModelNotes> = {
  sma50: {
    spec: [
      {
        term: ["Question", "研究问题"],
        value: [
          "Inside an established uptrend (SMA50 above SMA200), does a pullback into the SMA50 zone precede stronger returns than other uptrend days?",
          "在 SMA50 高于 SMA200 的上升趋势中，回踩 50 日均线区域后，收益是否强于其他上升趋势交易日？",
        ],
      },
      {
        term: ["Trigger", "触发条件"],
        value: [
          "Prior SMA50 > prior SMA200; prior close > prior SMA50 × 1.02; today's low ≤ that boundary",
          "前日 SMA50 > 前日 SMA200；前日收盘 > 前日 SMA50 × 1.02；当日最低价 ≤ 该上边界",
        ],
      },
      entry,
      {
        term: ["Background", "背景样本"],
        value: [
          "Days meeting the same trend and prior-close conditions without a touch",
          "满足相同趋势与前日收盘条件、但当日未触碰的交易日",
        ],
      },
      {
        term: ["Episode", "事件合并"],
        value: [
          "10-session cooldown plus 3 closes above the zone before a new event",
          "10 个交易日冷却，并需连续 3 日收盘站上区域上沿才重新计入",
        ],
      },
      {
        term: ["Rule exit", "规则退出"],
        value: [
          "First close ≥ the highest close of the 20 sessions before the touch; otherwise session 20",
          "首次收盘 ≥ 触碰前 20 日最高收盘价；否则第 20 日收盘退出",
        ],
      },
      {
        term: ["Primary test", "主检验"],
        value: [
          "±2% zone · 10-session endpoint advantage · ±1% / ±3% descriptive",
          "±2% 区域 · 10 日终点收益优势 · ±1%／±3% 仅作描述",
        ],
      },
    ],
    notes: [
      {
        title: ["Why SMA50 and a trend filter", "为什么是 50 日线加趋势过滤"],
        body: [
          "The 50-day simple average is a widely watched intermediate trend line (the 10-week line in growth-stock practice). The model only studies pullbacks while SMA50 is above SMA200, so it asks about dips inside an established uptrend rather than catching a falling stock. Both averages come from the previous session and are known before the touch.",
          "50 日简单均线是市场普遍关注的中期趋势线（成长股实践中的 10 周线）。模型只研究 SMA50 高于 SMA200 时的回踩，问的是“已确立上升趋势中的回调”，而不是去接下跌中的股票。两条均线都取前一交易日数值，触碰前即已知。",
        ],
      },
      {
        title: ["A zone, and failures stay in", "用区域判断，失败案例保留"],
        body: [
          "The ±2% zone is preset: price must approach from above (previous close above the upper edge), and any intraday low at or below that edge counts, including deep undercuts and gaps below the line. ±1% and ±3% rows change both the event and background samples; they are sensitivity checks, not a menu for choosing the best backtest.",
          "±2% 区域为预设参数：价格必须从上方接近（前日收盘在区域上沿之上），当日最低价触及上沿或更低即计入，包括大幅下穿和跳空到均线下方。±1% 与 ±3% 会同时改变事件和背景样本，只用于敏感性检查，不是挑选最佳回测的菜单。",
        ],
      },
      {
        title: ["Recovery exit", "修复退出"],
        body: [
          'A pullback is "recovered" when a close regains the highest close of the 20 sessions before the touch. This asks whether the dip was fully bought back within a month, which is stricter than merely closing above the line again.',
          "当收盘价重新达到触碰前 20 个交易日的最高收盘价，视为回撤“修复”。它检验一个月内回调是否被完全买回，比仅仅重新站上均线更严格。",
        ],
      },
      ...sharedNotes(
        10,
        ["the ±2% zone", "±2% 区域"],
        ["the pre-touch 20-session high", "触碰前 20 日最高收盘"],
      ),
    ],
    sources: [
      {
        label: ["StockCharts · moving averages", "StockCharts · 移动平均"],
        href: "https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential",
      },
      bootstrapSource,
      lookAheadSource,
    ],
  },
  rsi2: {
    spec: [
      {
        term: ["Question", "研究问题"],
        value: [
          "When a stock above its SMA200 becomes deeply oversold on RSI(2), do the next sessions beat other uptrend days?",
          "价格位于 SMA200 上方时，RSI(2) 深度超卖后的几日，是否强于其他上升趋势交易日？",
        ],
      },
      {
        term: ["Trigger", "触发条件"],
        value: [
          "Close > SMA200; prior RSI(2) ≥ 10; today's RSI(2) < 10 (Wilder smoothing on closes)",
          "收盘 > SMA200；前日 RSI(2) ≥ 10；当日 RSI(2) < 10（按收盘价、Wilder 平滑）",
        ],
      },
      entry,
      {
        term: ["Background", "背景样本"],
        value: [
          "Uptrend days where RSI(2) stayed at or above 10",
          "位于 SMA200 上方、RSI(2) 保持 ≥ 10 的交易日",
        ],
      },
      {
        term: ["Episode", "事件合并"],
        value: [
          "5-session cooldown plus a close above SMA5 before a new event",
          "5 个交易日冷却，并需一次收盘站上 SMA5 才重新计入",
        ],
      },
      {
        term: ["Rule exit", "规则退出"],
        value: [
          "First close above SMA5 (Connors exit); otherwise session 20",
          "首次收盘高于 SMA5（Connors 退出规则）；否则第 20 日收盘退出",
        ],
      },
      {
        term: ["Primary test", "主检验"],
        value: [
          "RSI(2) < 10 · 5-session endpoint advantage · < 5 / < 15 descriptive",
          "RSI(2) < 10 · 5 日终点收益优势 · < 5／< 15 仅作描述",
        ],
      },
    ],
    notes: [
      {
        title: ["Where the rule comes from", "规则来源"],
        body: [
          "Larry Connors popularized the 2-period RSI pullback: trade only above the 200-day average, buy when RSI(2) drops below 10, and exit on a move above the 5-day average. Because it is a well-known published rule, any historical edge may already be crowded or decayed. This study re-tests it on this symbol only.",
          "Larry Connors 推广了 2 周期 RSI 回调策略：只在 200 日均线上方交易，RSI(2) 跌破 10 时买入，价格站上 5 日均线时退出。它是广为人知的公开规则，历史优势可能已被拥挤交易削弱。本研究只在当前标的上重新检验。",
        ],
      },
      {
        title: ["How RSI(2) is calculated", "RSI(2) 的计算方式"],
        body: [
          "RSI(2) uses two-session Wilder smoothing of up and down closes, seeded with the simple mean of the first two changes; flat prices read 50. It is extremely sensitive: a single sharp down day can push it below 10. The trend filter and signal both use the completed signal-day close; the trade enters the next open, which is more conservative than entering at the signal close and includes the overnight gap.",
          "RSI(2) 对收盘上涨与下跌幅度做 2 日 Wilder 平滑，用前两次变化的均值初始化；价格不变时为 50。它非常敏感，单日急跌就可能跌破 10。趋势过滤与信号都使用已完成的信号日收盘；交易在次日开盘入场，比在信号日收盘入场更保守，并包含隔夜跳空。",
        ],
      },
      {
        title: ["A short primary horizon", "较短的主检验窗口"],
        body: [
          "The mechanism is short-term mean reversion, so 5 sessions is the pre-specified primary horizon and the cooldown. 10 and 20 sessions show whether any bounce persists or fades, but they are descriptive. Thresholds 5 and 15 are sensitivity rows; each changes both samples.",
          "该机制是短线均值回归，因此预先指定 5 个交易日为主检验窗口，并作为冷却期。10 与 20 日用于观察反弹是否延续或回落，仅作描述。阈值 5 和 15 为敏感性检查，会同时改变两组样本。",
        ],
      },
      ...sharedNotes(
        5,
        ["RSI(2) < 10", "RSI(2) < 10"],
        ["a level above SMA5", "高于 SMA5 的位置"],
      ),
    ],
    sources: [
      {
        label: ["StockCharts · RSI(2) strategy", "StockCharts · RSI(2) 策略"],
        href: "https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2",
      },
      {
        label: ["StockCharts · RSI", "StockCharts · RSI"],
        href: "https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi",
      },
      bootstrapSource,
    ],
  },
  bollinger: {
    spec: [
      {
        term: ["Question", "研究问题"],
        value: [
          "In an uptrend, does a close below the lower Bollinger band (20, 2σ) precede reversion and stronger returns?",
          "上升趋势中，收盘跌破布林下轨（20 日，2σ）后，是否更容易回归并取得更强收益？",
        ],
      },
      {
        term: ["Trigger", "触发条件"],
        value: [
          "Close > SMA200; prior close ≥ prior lower band; today's close < lower band (SMA20 − 2 × population SD)",
          "收盘 > SMA200；前日收盘 ≥ 前日下轨；当日收盘 < 下轨（SMA20 − 2 × 总体标准差）",
        ],
      },
      entry,
      {
        term: ["Background", "背景样本"],
        value: [
          "Uptrend days that closed at or above the lower band",
          "位于 SMA200 上方、收盘不低于下轨的交易日",
        ],
      },
      {
        term: ["Episode", "事件合并"],
        value: [
          "10-session cooldown plus a close at or above the middle band before a new event",
          "10 个交易日冷却，并需一次收盘回到中轨及以上才重新计入",
        ],
      },
      {
        term: ["Rule exit", "规则退出"],
        value: [
          "First close ≥ middle band (SMA20); otherwise session 20",
          "首次收盘 ≥ 中轨（SMA20）；否则第 20 日收盘退出",
        ],
      },
      {
        term: ["Primary test", "主检验"],
        value: [
          "2σ band · 10-session endpoint advantage · 1.5σ / 2.5σ descriptive",
          "2σ 下轨 · 10 日终点收益优势 · 1.5σ／2.5σ 仅作描述",
        ],
      },
    ],
    notes: [
      {
        title: ["A volatility-scaled pullback", "按波动率衡量的回调"],
        body: [
          "The lower band is SMA20 minus two population standard deviations of the same 20 closes. A close below it is unusual relative to the last month's own volatility rather than a fixed percentage, so quiet and volatile stocks are measured on the same scale. The band includes the signal-day close, which is known when the signal fires.",
          "下轨 = SMA20 − 同 20 日收盘价总体标准差 × 2。收盘跌破下轨，表示相对最近一个月自身波动而言“异常偏低”，而不是固定百分比，因此低波动与高波动股票可在同一尺度下比较。布林带包含信号日收盘价，信号触发时即已知。",
        ],
      },
      {
        title: [
          "Walking the band is a failure, not an exception",
          "沿下轨下行是失败，不是例外",
        ],
        body: [
          "In a sharp decline, price can keep closing below a falling lower band. Those events stay in the sample; the 20-session path, maximum loss and time exits show them. John Bollinger's own rules say a lower-band tag is not in itself a buy signal, and that closes outside the bands are initially continuation rather than reversal signals. This model tests the opposite hypothesis, inside an SMA200 uptrend evaluated on the signal day, so a negative or inconclusive result is a plausible outcome.",
          "急跌时，价格可能沿不断下移的下轨持续收在其下方。这些事件都保留在样本中，由 20 日路径、最大下跌与超时退出体现。John Bollinger 的使用规则明确指出：触及下轨本身不是买入信号，收在轨道之外最初更常是延续而非反转信号。本模型在信号日位于 SMA200 上方的前提下检验相反的假设，因此结果为负或不明确是合理可能。",
        ],
      },
      {
        title: ["Middle-band exit", "中轨退出"],
        body: [
          "Reversion is measured to the middle band (SMA20), a common mean-reversion target. Reaching it is not the same as a profit: if the entry gap was large or the band fell quickly, the exit return can still be negative.",
          "回归目标为中轨（SMA20），这是常见的均值回归退出位置。回到中轨不等于盈利：若入场跳空较大或中轨快速下移，退出收益仍可能为负。",
        ],
      },
      ...sharedNotes(
        10,
        ["the 2σ band", "2σ 下轨"],
        ["the middle band", "中轨"],
      ),
    ],
    sources: [
      {
        label: ["Bollinger · rules", "Bollinger · 使用规则"],
        href: "https://www.bollingerbands.com/bollinger-band-rules",
      },
      {
        label: ["StockCharts · Bollinger Bands", "StockCharts · 布林带"],
        href: "https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/bollinger-bands",
      },
      bootstrapSource,
    ],
  },
};
