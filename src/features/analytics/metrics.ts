import type { MetricExplanation } from "../../shared/MetricHelp";

export function netFlowMetric(days: number): MetricExplanation {
  return {
    title: `${days} 日累计净申赎`,
    meaning: `观察最近 ${days} 个完整交易日，这只 ETF 通过新增或赎回份额净增加了多少资产。正数表示净申购，负数表示净赎回。`,
    formula: `${days} 日累计净申赎 = 窗口内每日净申赎额之和。单日常见估算：当日每份净值（NAV）× 流通份额增量；需处理拆股并对齐日期。接入后优先使用供应商核验的净申赎额。`,
    example:
      "某段时间合计申购 3 亿美元、赎回 2 亿美元，累计净申赎就是 +1 亿美元。它不等于这段时间的成交额。",
    caveat:
      "申赎可能以证券实物完成，并非全是现金。单只 ETF 不能代表整个板块；净流入也不等于价格将上涨。缺失数据不能当作 0。",
  };
}

export const flowIntensity: MetricExplanation = {
  title: "20 日流入强度",
  meaning:
    "把净申赎与基金原有规模相比，便于比较大小不同的 ETF。AUM 指基金管理的净资产规模。",
  formula:
    "20 日流入强度 = 最近 20 个完整交易日累计净申赎额 ÷ 窗口开始前一交易日的 AUM × 100%。",
  example:
    "期初规模为 50 亿美元，20 日净流入 1 亿美元，流入强度为 +2%。同样流入 1 亿，规模 500 亿的基金只有 +0.2%。",
  caveat:
    "这不是投资收益率。期初规模缺失或为 0 时无法计算；小基金的比例容易受单笔申赎影响。",
};

export const persistence: MetricExplanation = {
  title: "四周申赎持续性",
  meaning: "观察净流入是否连续出现，区分持续配置和某一周的集中申购。",
  formula:
    "将最近 4 个完整交易周分别汇总：每周净申赎 = 该周每日净申赎之和。正值周数 ÷ 4，可辅助描述持续性。节假日周按实际交易日统计。",
  example:
    "四周依次为 +2,000 万、+1,000 万、−500 万、+3,000 万美元，即 3 / 4 周净流入；累计净流入 5,500 万美元。",
  caveat:
    "本周尚未结束时不纳入四个完整周。0 表示无净变化，不算净流入；任何交易日数据缺失时，该周标记为数据不完整。",
};

export const relativeReturn: MetricExplanation = {
  title: "相对 SPY 总回报",
  meaning:
    "观察板块 ETF 在同一段时间是否跑赢以 SPY 代表的美国大盘。总回报包含分红再投资。",
  formula:
    "N 日相对总回报 = ETF 的 N 日总回报率 − SPY 的 N 日总回报率，单位为百分点。两者使用相同起止交易日及分红再投资口径。",
  example:
    "20 日 ETF 总回报为 +6%，SPY 为 +4%，相对总回报是 +2 个百分点。ETF −2%、SPY −5% 时，也会相对领先 +3 个百分点。",
  caveat:
    "相对领先不代表绝对赚钱，也不是资金流量。当前价格数据未包含分红再投资；补齐前不会把价格涨跌标成总回报。",
};

export const freshness: MetricExplanation = {
  title: "数据时效",
  meaning:
    "区分数据描述的是哪一天，以及我们什么时候取得它，避免把旧数据误认为今天的变化。",
  formula:
    "生效日期 = 数据所对应的日期；供应商处理日期 = 供应商收到并处理数据的日期；获取时间 = 网站取得记录的时间。刷新网页不会改变生效日期。",
  example:
    "9 月 18 日取得一条生效于 9 月 16 日的记录，页面应显示“截至 9 月 16 日”，而不是“9 月 18 日资金流”。",
  caveat:
    "不同 ETF 可能存在不同延迟。横向比较应对齐日期；回测只能使用当时已发布的数据。待接入、缺失和数值 0 是不同状态。",
};

export const dollarVolume: MetricExplanation = {
  title: "估算成交额",
  meaning: "粗略衡量交易活跃程度，即成交股票按当前报价折算的金额。",
  formula:
    "此表估算成交额 = 快照报价 × 快照成交量。成交量属于快照交易时段，不随 Time span 选项变化。",
  example:
    "报价为 50 美元、成交量为 100 万股，估算成交额是 5,000 万美元。每笔交易都有买卖双方。",
  caveat:
    "不是逐笔成交金额的精确合计，也不是资金净流入；无法据此判断买入资金比卖出资金多。",
};

export const spanChange: MetricExplanation = {
  title: "区间涨跌幅",
  meaning: "观察 Time span 所选区间内，当前可用价格历史从头到尾变化了多少。",
  formula:
    "区间涨跌幅 =（最后一根 K 线收盘价 ÷ 第一根 K 线收盘价 − 1）× 100%。",
  example: "第一根 K 线收盘价为 100 美元，最后为 105 美元，区间涨跌幅为 +5%。",
  caveat:
    "实际起止点取决于返回的 K 线；少于两根时无法计算。价格处理拆股，但不含分红再投资；它不是资金流量。",
};
