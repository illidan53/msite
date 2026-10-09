import type {
  BenchmarkId,
  Bilingual,
  FamilyAdmission,
  IneligibleReason,
  OverlayLimit,
  RuleFamily,
  RuleId,
  RunId,
  SignalAction,
  StrategyJob,
  WarningCode,
} from "../../../shared/strategy";
import { ruleCatalog, type RuleSpec } from "../../../shared/strategyRules";

export const bookCitation: Bilingual = {
  en: "Robert Carver, Advanced Futures Trading Strategies (Harriman House, 2023), ISBN 9780857199683",
  zh: "Robert Carver，《Advanced Futures Trading Strategies》（Harriman House，2023），ISBN 9780857199683",
};

export interface RuleText {
  formula: string;
  intuition: Bilingual;
}

const p = (rule: RuleSpec, key: string) => rule.params[key];
/** One formula line and one plain-language intuition per catalog rule. */
function describeRule(rule: RuleSpec): RuleText {
  const id = rule.id;
  if (id.startsWith("ewmac")) {
    const [fast, slow] = [p(rule, "fast"), p(rule, "slow")];
    return {
      formula: `raw = (EWMA${fast}(C) − EWMA${slow}(C)) ÷ σp`,
      intuition: {
        en: `Fast minus slow exponential average of the close, measured in daily price volatility. Positive while the ${fast}/${slow}-session trend is up; faster pairs react sooner and trade more.`,
        zh: `收盘价快慢指数均线之差，以日价格波动为单位。${fast}/${slow} 日趋势向上时为正；越快的组合反应越早、交易越多。`,
      },
    };
  }
  if (id.startsWith("breakout")) {
    const n = p(rule, "horizon");
    return {
      formula: `H, L = ${n}-session max/min close; raw = EWMA${p(rule, "smooth")}(40 × (C − (H + L)/2) ÷ (H − L))`,
      intuition: {
        en: `Where today's close sits inside its ${n}-session range: near the top is bullish, near the bottom bearish. Smoothing over ${p(rule, "smooth")} sessions keeps it from flipping daily.`,
        zh: `今日收盘价位于近 ${n} 日区间的什么位置：靠近上沿偏多，靠近下沿偏空。用 ${p(rule, "smooth")} 日平滑，避免逐日反复。`,
      },
    };
  }
  if (id.startsWith("accel")) {
    const fast = p(rule, "fast");
    return {
      formula: `F̃ = scalar × raw EWMAC${fast} (uncapped); raw = F̃(t) − F̃(t − ${fast})`,
      intuition: {
        en: `How much the EWMAC ${fast}/${p(rule, "slow")} forecast changed over the last ${fast} sessions: rewards trends that are strengthening, fades ones that are fading.`,
        zh: `EWMAC ${fast}/${p(rule, "slow")} 预测值在最近 ${fast} 日内的变化：趋势在加强时加分，在减弱时减分。`,
      },
    };
  }
  if (id.startsWith("assettrend")) {
    const [fast, slow] = [p(rule, "fast"), p(rule, "slow")];
    return {
      formula: `A = Σ median class z; raw = (EWMA${fast}(A) − EWMA${slow}(A)) ÷ vol(ΔA)`,
      intuition: {
        en: "The trend of the symbol's whole class (sector list), built from the median volatility-normalised return of its members and shared by every member. Stocks tend to move with their sector.",
        zh: "整个类别（板块列表）的趋势：由成员波动归一化收益的中位数累加而成，并广播给每个成员。个股往往随板块一起波动。",
      },
    };
  }
  if (id.startsWith("relmom")) {
    const n = p(rule, "horizon");
    return {
      formula: `O = Σ z − A(class); raw = EWMA${p(rule, "smooth")}((O(t) − O(t − ${n})) ÷ ${n})`,
      intuition: {
        en: `Out- or under-performance against the symbol's own class over ${n} sessions, after normalising for volatility. Favours sector leaders; the 20-session version is dropped because short-term winners tend to reverse.`,
        zh: `经波动归一化后，标的相对所属类别在 ${n} 日内的超额或落后表现。偏好板块内领涨者；20 日版本因短期反转效应而不用。`,
      },
    };
  }
  if (id === "mr5")
    return {
      formula:
        "E = EWMA(com 5)(C); raw = (E − C) ÷ σp, set to 0 when its sign differs from EWMAC16",
      intuition: {
        en: "Buys short dips below a fast average, but only in the direction of the EWMAC 16/64 trend, so it never fights the trend.",
        zh: "在价格短暂跌破快速均线时买入，但只顺着 EWMAC 16/64 趋势方向操作，从不逆势。",
      },
    };
  return {
    formula:
      "E = SMA20(C); raw = (E − C) ÷ σp, trend-gated by EWMAC16; pooled scalar",
    intuition: {
      en: "The successor to the Bollinger lower-band study: distance below the 20-session average in volatility units, gated by the trend and scaled by a pooled expanding scalar because the book publishes none.",
      zh: "布林下轨研究的继任者：以波动为单位衡量低于 20 日均线的距离，同样受趋势门控；书中没有公布该变换的缩放系数，因此用跨标的汇总、只用当时已有数据的扩展估计。",
    },
  };
}
export const ruleText = Object.fromEntries(
  ruleCatalog.map((rule) => [rule.id, describeRule(rule)]),
) as Record<RuleId, RuleText>;

export const familyIntuition: Record<RuleFamily, Bilingual> = {
  trend: {
    en: "Absolute trend in the symbol's own price: EWMAC crossovers, range breakouts and trend acceleration.",
    zh: "标的自身价格的绝对趋势：EWMAC 均线交叉、区间突破与趋势加速。",
  },
  sector_trend: {
    en: "The trend of the symbol's class as a whole, shared by all members.",
    zh: "所属类别整体的趋势，由全部成员共享。",
  },
  relative_momentum: {
    en: "Performance relative to the symbol's own class.",
    zh: "相对于所属类别的表现。",
  },
  mean_reversion: {
    en: "Short dips bought only in the direction of the trend.",
    zh: "只顺着趋势方向买入短期回调。",
  },
};

export interface FrameworkItem {
  id: string;
  title: Bilingual;
  body: Bilingual;
  source: string;
}
export const frameworkItems: FrameworkItem[] = [
  {
    id: "volatility",
    title: { en: "Volatility", zh: "波动率" },
    body: {
      en: "One estimator everywhere: an exponentially weighted standard deviation of daily returns (span 32), annualised × 16 and blended 70% with 30% of its own long-run average, floored at 5%. A symbol needs 256 valid estimates before it may hold a position.",
      zh: "全系统只用一个估计：日收益的指数加权标准差（span 32），×16 年化，再以 70% 当前值 + 30% 长期均值混合，下限 5%。标的需有 256 个有效估计后才能持仓。",
    },
    source: "AFTS Strategy 3",
  },
  {
    id: "scaling",
    title: { en: "Forecast scaling & caps", zh: "预测缩放与上限" },
    body: {
      en: "Every rule's raw value is multiplied by a scalar so its average absolute forecast is 10, then capped at ±20. Scalars are the book's published values; a pooled, expanding estimate is used only where none is published. A rule votes only after its warm-up.",
      zh: "每条规则的原始值乘以缩放系数，使平均绝对预测值为 10，再截断在 ±20。缩放系数采用书中公布值；只有在未公布时才使用跨标的汇总、只用当时已有数据的扩展估计。规则需度过预热期才参与投票。",
    },
    source: "AFTS Strategy 7",
  },
  {
    id: "combination",
    title: { en: "Combination & FDM", zh: "组合与预测分散乘数（FDM）" },
    body: {
      en: "Capped forecasts are averaged with fixed, handcrafted weights. Weight of an unavailable rule moves first to its own family, then to other families. The weighted average is multiplied by the forecast diversification multiplier 1/√(wᵀHw), from pooled weekly forecast correlations, capped at 2.5 and smoothed, then capped again at ±20.",
      zh: "截断后的预测值按固定的手工权重加权平均。不可用规则的权重先分给同族规则，再分给其他族。加权结果乘以预测分散乘数 1/√(wᵀHw)（来自跨标的汇总的周度预测相关性，每月只用此前数据重估，上限 2.5 并平滑），再截断在 ±20。",
    },
    source: "AFTS Strategies 9 and 11",
  },
  {
    id: "sizing",
    title: { en: "IDM & position sizing", zh: "IDM 与仓位计算" },
    body: {
      en: "Instrument weights are equal across classes, then rows, then symbols, over eligible symbols only. The instrument diversification multiplier 1/√(wᵀHw) comes from weekly return correlations (span 25 weeks), capped at 2.5. Target weight = IDM × weight × risk target ÷ σ × forecast ÷ 10, capped per position.",
      zh: "标的权重先在类别间、再在行间、最后在标的间平均分配，只计入合格标的。标的分散乘数 1/√(wᵀHw) 来自周收益相关性（span 25 周），上限 2.5。目标权重 = IDM × 权重 × 风险目标 ÷ σ × 预测值 ÷ 10，并受单票上限约束。",
    },
    source: "AFTS Strategies 4 and 7",
  },
  {
    id: "buffering",
    title: { en: "Buffering & execution", zh: "缓冲与执行" },
    body: {
      en: "Orders are decided after the close and filled at the next open. No trade happens while the holding is within ±10% of the average position around the target; outside the band the order trades only to the band edge. Trades under $25 are skipped and fractional shares (0.0001) are used.",
      zh: "收盘后决策，次日开盘成交。持仓位于目标 ± 平均仓位 10% 的缓冲带内时不交易；越界时只交易到缓冲带边缘。低于 25 美元的交易跳过，使用 0.0001 股的碎股。",
    },
    source: "AFTS Strategy 8",
  },
  {
    id: "costs",
    title: { en: "Costs & speed limits", zh: "成本与速度限制" },
    body: {
      en: "Each trade pays a one-way cost of 3–30 bps by dollar-volume tier, plus the SEC fee on sells. Costs are measured in Sharpe-ratio units: a rule is dropped for a symbol when cost × turnover exceeds 0.15 SR a year, and a symbol is ineligible when one trade costs more than 0.01 SR.",
      zh: "每笔交易按成交额档位支付 3–30 个基点的单边成本，卖出另加 SEC 费用。成本以夏普比率单位衡量：若某规则在某标的上的成本 × 换手率每年超过 0.15 SR，则剔除该规则；单笔成本超过 0.01 SR 的标的不合格。",
    },
    source: "AFTS Strategy 9",
  },
  {
    id: "overlay",
    title: { en: "Risk overlay", zh: "风险叠加层" },
    body: {
      en: "Positions are scaled down together when any of four portfolio measures breaches its limit: gross exposure (100%), normal risk (1.75 × risk target), a correlation shock (4 ×) or a jump-risk estimate (4 ×). The binding limit is shown with the multiplier.",
      zh: "当四项组合风险指标任一超限时，所有仓位同比例缩小：总敞口（100%）、正常风险（1.75 × 风险目标）、相关性冲击（4 ×）和跳空风险（4 ×）。页面同时显示乘数和触发的限制。",
    },
    source: "AFTS Part Six",
  },
  {
    id: "long-only",
    title: { en: "Long-only floor", zh: "只做多下限" },
    body: {
      en: "Forecasts are combined signed, so bearish rules still offset bullish ones. Only at sizing does the system hold max(0, forecast); a negative combined forecast means no position, never a short. The long/short variant shows what the floor costs.",
      zh: "预测值带正负号组合，看空规则仍会抵消看多规则。只有在计算仓位时才取 max(0, 预测值)；组合预测为负意味着空仓，绝不做空。多空变体用于衡量这个下限的代价。",
    },
    source: "AFTS Strategy 5",
  },
  {
    id: "evaluation",
    title: { en: "Evaluation & tests", zh: "评估与检验" },
    body: {
      en: "Every report re-runs the live system and its variants against three buy-and-hold benchmarks. Sharpe differences use a paired 42-session block bootstrap and the Jobson–Korkie/Memmel test; each rule family is judged by removing it. The deflated Sharpe ratio and the probability of backtest overfitting (not from AFTS) count every configuration ever tried.",
      zh: "每份报告都会重跑实盘系统及其变体，并与三种买入持有基准比较。夏普差异使用 42 日配对分块重采样和 Jobson–Korkie/Memmel 检验；每个规则族通过“剔除后比较”评估。通缩夏普比率与回测过拟合概率（非 AFTS 内容）会计入所有尝试过的配置。",
    },
    source: "AFTS Part One; Bailey & López de Prado",
  },
  {
    id: "survivorship",
    title: { en: "Survivorship bias", zh: "幸存者偏差" },
    body: {
      en: "The universe is today's curated watchlist, so the past is filled with companies known to have survived and grown. Absolute returns are flattered; judge the system against the equal-weight and risk-parity buy-and-hold of the same symbols, not against zero.",
      zh: "标的池是今天精选的自选列表，历史中自然只包含幸存并成长的公司，绝对收益因此被高估。请以同一批标的的等权和风险平价买入持有为基准评估系统，而不是与零比较。",
    },
    source: "msite",
  },
  {
    id: "price-only",
    title: { en: "Price-only data", zh: "仅价格数据" },
    body: {
      en: "Bars are split-adjusted closes without dividends, and idle cash earns nothing. Returns of every run and benchmark are price returns, so all of them understate total return by roughly the dividend yield.",
      zh: "日线为拆股调整后的价格，不含分红，闲置现金不计利息。所有运行与基准的收益均为价格收益，大致低估了相当于股息率的总回报。",
    },
    source: "msite",
  },
];

export const runLabels: Record<RunId, Bilingual> = {
  core: { en: "Core (live system)", zh: "核心（实盘系统）" },
  long_short: { en: "Long/short", zh: "多空" },
  trend_filter: { en: "Trend filter only", zh: "仅趋势过滤" },
  vol_attenuation: { en: "Vol attenuation", zh: "波动衰减" },
  whole_shares: { en: "Whole shares", zh: "整股" },
  without_trend: { en: "Without absolute trend", zh: "剔除绝对趋势" },
  without_sector_trend: { en: "Without sector trend", zh: "剔除板块趋势" },
  without_relative_momentum: {
    en: "Without relative momentum",
    zh: "剔除相对动量",
  },
  without_mean_reversion: {
    en: "Without mean reversion",
    zh: "剔除均值回归",
  },
  spy_buy_hold: { en: "SPY buy & hold", zh: "SPY 买入持有" },
  equal_weight_buy_hold: { en: "Equal-weight buy & hold", zh: "等权买入持有" },
  risk_parity_buy_hold: {
    en: "Risk-parity buy & hold",
    zh: "风险平价买入持有",
  },
};
export const benchmarkOrder: BenchmarkId[] = [
  "risk_parity_buy_hold",
  "spy_buy_hold",
  "equal_weight_buy_hold",
];

export const warningLabels: Record<WarningCode, Bilingual> = {
  forecast_scale: {
    en: "A rule's mean |forecast| is outside 7–13",
    zh: "有规则的平均 |预测值| 超出 7–13",
  },
  cost_budget: {
    en: "Costs exceed one-third of the core Sharpe ratio",
    zh: "成本超过核心夏普比率的三分之一",
  },
  short_window: {
    en: "Evaluation window under two years",
    zh: "评估窗口不足两年",
  },
  data_failures: {
    en: "Some symbols failed to load",
    zh: "部分标的数据加载失败",
  },
  price_jumps: {
    en: "Daily price jumps over 40%",
    zh: "存在超过 40% 的单日价格跳变",
  },
  family_detracts: { en: "A rule family detracts", zh: "有规则族拖累表现" },
};

export const admissionLabels: Record<FamilyAdmission, Bilingual> = {
  adds: { en: "Adds", zh: "有贡献" },
  neutral: { en: "Neutral", zh: "中性" },
  detracts: { en: "Detracts", zh: "拖累" },
  insufficient: { en: "Insufficient", zh: "样本不足" },
};

export const reasonLabels: Record<IneligibleReason, Bilingual> = {
  no_bar: { en: "No bar", zh: "无行情" },
  warmup: { en: "Warming up", zh: "预热中" },
  stale: { en: "Stale prices", zh: "价格停滞" },
  illiquid: { en: "Illiquid", zh: "流动性不足" },
  cost: { en: "Too costly", zh: "成本过高" },
};

export const actionLabels: Record<SignalAction, Bilingual> = {
  entry: { en: "Entry", zh: "建仓" },
  add: { en: "Add", zh: "加仓" },
  trim: { en: "Trim", zh: "减仓" },
  exit: { en: "Exit", zh: "清仓" },
};

export const overlayLabels: Record<OverlayLimit, Bilingual> = {
  gross: { en: "gross exposure", zh: "总敞口" },
  normal_risk: { en: "normal risk", zh: "正常风险" },
  correlation_shock: { en: "correlation shock", zh: "相关性冲击" },
  jump_risk: { en: "jump risk", zh: "跳空风险" },
};

export const stepLabels: Record<StrategyJob["step"], Bilingual> = {
  fetch: { en: "Fetching daily bars", zh: "正在获取日线" },
  compute: { en: "Computing forecasts", zh: "正在计算预测" },
  simulate: { en: "Simulating portfolios", zh: "正在模拟组合" },
  report: { en: "Writing the report", zh: "正在生成报告" },
  email: { en: "Sending email", zh: "正在发送邮件" },
};
