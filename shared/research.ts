export type ResearchModule = "all" | "quant" | "fundamentals" | "news" | "ai";
export type ResearchPhase =
  "pending" | "running" | "complete" | "unavailable" | "failed";
export interface ResearchMetric {
  id: string;
  en: string;
  zh: string;
  value: number | null;
  unit: "percent" | "number" | "usd" | "days";
  group: "performance" | "risk" | "trend" | "liquidity" | "fundamentals";
  note: string;
}
export interface ResearchNews {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  description: string;
}
export interface ResearchSection {
  status: ResearchPhase;
  fetchedAt?: string;
  asOf?: string;
  message?: string;
}
export interface ResearchMetricHistory {
  dates: string[];
  values: Record<string, (number | null)[]>;
  dataStart: string;
  asOf: string;
  fetchedAt: string;
  basis: "snapshot" | "reconstructed";
}
export interface ResearchReport {
  id: string;
  baseId?: string;
  symbol: string;
  benchmark: string;
  locale: "en" | "zh";
  module: ResearchModule;
  createdAt: string;
  completedAt?: string;
  status: "running" | "complete" | "partial" | "failed";
  kind: "stock" | "etf" | "unknown";
  name?: string;
  description?: string;
  homepage?: string;
  sections: Record<Exclude<ResearchModule, "all">, ResearchSection>;
  metrics: ResearchMetric[];
  prices: { date: string; close: number; drawdown: number }[];
  news: ResearchNews[];
  metricHistory?: ResearchMetricHistory;
  narrative?: string;
  model?: string;
  financialPeriod?: string;
  filingDate?: string;
}
