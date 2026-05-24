export type PolygonPlan = "free" | "paid" | "custom";

export interface SettingsConfig {
  polygon: {
    plan: PolygonPlan;
    paidPlanName?: string;
    customCallsPerMinute?: number;
    warningThreshold: number;
    hardThreshold: number;
  };
}

export interface WatchlistRow {
  id: string;
  name: string;
  expandedByDefault: boolean;
  symbols: string[];
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
  theme?: string;
  pinnedSymbols: string[];
  rows: WatchlistRow[];
}

export interface WatchlistsConfig {
  watchlists: Watchlist[];
}

export interface MarketSnapshot {
  symbol: string;
  name?: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  updatedAt: string | null;
  timeframe: "DELAYED" | "PREVIOUS_CLOSE" | "REAL-TIME" | "UNKNOWN";
}

export interface PriceBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceSeries {
  symbol: string;
  range: "1h" | "1d" | "5d" | "30d" | "3month" | "1y" | "5y";
  bars: PriceBar[];
}

export interface RatePlanEvaluation {
  status: "ok" | "warning" | "blocked";
  plan: PolygonPlan;
  intervalSeconds: number;
  estimatedCallsPerMinute: number;
  message: string;
  disabledIntervals: number[];
}
