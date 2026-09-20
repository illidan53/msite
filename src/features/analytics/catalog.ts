import type { Locale } from "../../shared/locale";
export type EtfGroup = "sector" | "industry" | "theme" | "benchmark";
export const groups: { id: EtfGroup; en: string; zh: string }[] = [
  { id: "sector", en: "Standard sectors", zh: "标准板块" },
  { id: "industry", en: "Industries", zh: "行业细分" },
  { id: "theme", en: "Themes", zh: "主题" },
  { id: "benchmark", en: "Index benchmarks", zh: "指数基准" },
];
export const etfs: {
  symbol: string;
  group: EtfGroup;
  en: string;
  zh: string;
  source: string;
}[] = [
  ...[
    ["XLK", "Technology", "信息技术"],
    ["XLF", "Financials", "金融"],
    ["XLV", "Health Care", "医疗保健"],
    ["XLI", "Industrials", "工业"],
    ["XLY", "Consumer Discretionary", "可选消费"],
    ["XLP", "Consumer Staples", "必需消费"],
    ["XLE", "Energy", "能源"],
    ["XLU", "Utilities", "公用事业"],
    ["XLB", "Materials", "原材料"],
    ["XLRE", "Real Estate", "房地产"],
    ["XLC", "Communication Services", "通信服务"],
  ].map(([symbol, en, zh]) => ({
    symbol,
    en,
    zh,
    group: "sector" as const,
    source: `https://www.ssga.com/mainfund/${symbol}`,
  })),
  {
    symbol: "SOXX",
    group: "industry",
    en: "Semiconductors · iShares",
    zh: "半导体 · iShares",
    source:
      "https://www.ishares.com/us/products/239705/ishares-semiconductor-etf",
  },
  {
    symbol: "SMH",
    group: "industry",
    en: "Semiconductors · VanEck",
    zh: "半导体 · VanEck",
    source: "https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/",
  },
  {
    symbol: "IGV",
    group: "industry",
    en: "Software",
    zh: "软件",
    source:
      "https://www.ishares.com/us/products/239771/ishares-expanded-tech-software-sector-etf",
  },
  {
    symbol: "XBI",
    group: "industry",
    en: "Biotechnology",
    zh: "生物科技",
    source: "https://www.ssga.com/mainfund/XBI",
  },
  {
    symbol: "KRE",
    group: "industry",
    en: "Regional banks",
    zh: "区域银行",
    source: "https://www.ssga.com/mainfund/KRE",
  },
  {
    symbol: "ITA",
    group: "industry",
    en: "Aerospace & defense",
    zh: "航空航天与国防",
    source:
      "https://www.ishares.com/us/products/239502/ishares-us-aerospace-defense-etf",
  },
  {
    symbol: "XHB",
    group: "industry",
    en: "Homebuilders & related industries",
    zh: "住宅建筑及相关行业",
    source: "https://www.ssga.com/mainfund/XHB",
  },
  {
    symbol: "CIBR",
    group: "theme",
    en: "Cybersecurity",
    zh: "网络安全",
    source:
      "https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker=CIBR",
  },
  {
    symbol: "SKYY",
    group: "theme",
    en: "Cloud computing",
    zh: "云计算",
    source:
      "https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker=SKYY",
  },
  {
    symbol: "SPY",
    group: "benchmark",
    en: "S&P 500",
    zh: "标普 500",
    source: "https://www.ssga.com/mainfund/SPY",
  },
  {
    symbol: "QQQ",
    group: "benchmark",
    en: "Nasdaq-100",
    zh: "纳斯达克 100",
    source: "https://www.invesco.com/qqq-etf/en/about.html",
  },
  {
    symbol: "IWM",
    group: "benchmark",
    en: "Russell 2000 · small caps",
    zh: "罗素 2000 · 小盘股",
    source:
      "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf",
  },
];
export function etfName(symbol: string, locale: Locale) {
  return etfs.find((etf) => etf.symbol === symbol)?.[locale] ?? symbol;
}
